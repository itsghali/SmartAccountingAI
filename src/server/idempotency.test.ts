import { describe, expect, it, vi } from "vitest";
import {
  canonicalJsonStringify,
  computeRequestFingerprint,
  getIdempotencyKey,
  checkIdempotency,
  recordIdempotency,
  createIdempotentReplayResponse,
} from "./idempotency";
import type { Prisma } from "@prisma/client";

describe("Idempotency Engine (src/server/idempotency.ts)", () => {
  describe("canonicalJsonStringify", () => {
    it("handles primitives correctly", () => {
      expect(canonicalJsonStringify(null)).toBe("null");
      expect(canonicalJsonStringify(123)).toBe("123");
      expect(canonicalJsonStringify("hello")).toBe('"hello"');
      expect(canonicalJsonStringify(true)).toBe("true");
    });

    it("handles arrays deterministically", () => {
      expect(canonicalJsonStringify([1, 2, "a"])).toBe('[1,2,"a"]');
    });

    it("recursively sorts object keys regardless of original insertion order", () => {
      const objA = { b: 2, a: 1, c: { z: 26, y: 25 } };
      const objB = { c: { y: 25, z: 26 }, a: 1, b: 2 };
      expect(canonicalJsonStringify(objA)).toBe(canonicalJsonStringify(objB));
      expect(canonicalJsonStringify(objA)).toBe(
        '{"a":1,"b":2,"c":{"y":25,"z":26}}'
      );
    });
  });

  describe("computeRequestFingerprint", () => {
    it("generates the same SHA-256 for equivalent payloads with different key orders", () => {
      const hash1 = computeRequestFingerprint("POST", "/api/entries", {
        description: "Test",
        amount: 100,
      });
      const hash2 = computeRequestFingerprint("POST", "/api/entries", {
        amount: 100,
        description: "Test",
      });
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex string length
    });

    it("generates different hashes for different methods or paths or payloads", () => {
      const hash1 = computeRequestFingerprint("POST", "/api/entries", { a: 1 });
      const hash2 = computeRequestFingerprint("PUT", "/api/entries", { a: 1 });
      const hash3 = computeRequestFingerprint("POST", "/api/entries/2", { a: 1 });
      const hash4 = computeRequestFingerprint("POST", "/api/entries", { a: 2 });

      expect(hash1).not.toBe(hash2);
      expect(hash1).not.toBe(hash3);
      expect(hash1).not.toBe(hash4);
    });
  });

  describe("getIdempotencyKey", () => {
    it("extracts Idempotency-Key header", () => {
      const req = new Request("http://localhost", {
        headers: { "Idempotency-Key": "test-key-123" },
      });
      expect(getIdempotencyKey(req)).toBe("test-key-123");
    });

    it("extracts X-Idempotency-Key fallback header", () => {
      const req = new Request("http://localhost", {
        headers: { "X-Idempotency-Key": "x-test-key-456" },
      });
      expect(getIdempotencyKey(req)).toBe("x-test-key-456");
    });

    it("trims whitespace from the key", () => {
      const req = new Request("http://localhost", {
        headers: { "Idempotency-Key": "   trimmed-key   " },
      });
      expect(getIdempotencyKey(req)).toBe("trimmed-key");
    });

    it("returns null if key is empty or whitespace-only", () => {
      const req = new Request("http://localhost", {
        headers: { "Idempotency-Key": "   " },
      });
      expect(getIdempotencyKey(req)).toBeNull();
    });

    it("returns null if key exceeds 128 characters", () => {
      const longKey = "a".repeat(129);
      const req = new Request("http://localhost", {
        headers: { "Idempotency-Key": longKey },
      });
      expect(getIdempotencyKey(req)).toBeNull();
    });

    it("returns null if header is not present", () => {
      const req = new Request("http://localhost");
      expect(getIdempotencyKey(req)).toBeNull();
    });
  });

  describe("checkIdempotency", () => {
    it("returns isReplay: false when no record exists", async () => {
      const mockClient = {
        idempotencyKey: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      } as unknown as Prisma.TransactionClient;

      const result = await checkIdempotency({
        companyId: "company-1",
        key: "key-1",
        requestHash: "hash-123",
        client: mockClient,
      });

      expect(result).toEqual({ isReplay: false });
      expect(mockClient.idempotencyKey?.findUnique).toHaveBeenCalledWith({
        where: {
          companyId_key: { companyId: "company-1", key: "key-1" },
        },
      });
    });

    it("returns isReplay: false when record has expired", async () => {
      const mockClient = {
        idempotencyKey: {
          findUnique: vi.fn().mockResolvedValue({
            companyId: "company-1",
            key: "key-1",
            requestHash: "hash-123",
            statusCode: 201,
            responseBody: { success: true },
            expiresAt: new Date(Date.now() - 1000), // expired 1s ago
          }),
        },
      } as unknown as Prisma.TransactionClient;

      const result = await checkIdempotency({
        companyId: "company-1",
        key: "key-1",
        requestHash: "hash-123",
        client: mockClient,
      });

      expect(result).toEqual({ isReplay: false });
    });

    it("returns conflictError when key exists with a different requestHash", async () => {
      const mockClient = {
        idempotencyKey: {
          findUnique: vi.fn().mockResolvedValue({
            companyId: "company-1",
            key: "key-1",
            requestHash: "original-hash-123",
            statusCode: 201,
            responseBody: { success: true },
            expiresAt: new Date(Date.now() + 60000),
          }),
        },
      } as unknown as Prisma.TransactionClient;

      const result = await checkIdempotency({
        companyId: "company-1",
        key: "key-1",
        requestHash: "different-hash-456",
        client: mockClient,
      });

      expect(result.isReplay).toBe(false);
      expect(result.conflictError).toBe(
        "Cette clé d'idempotence a déjà été utilisée avec un corps de requête différent."
      );
    });

    it("returns isReplay: true and cachedResponse when key exists and hash matches", async () => {
      const mockBody = { id: "entry-1", entryNumber: 42 };
      const mockClient = {
        idempotencyKey: {
          findUnique: vi.fn().mockResolvedValue({
            companyId: "company-1",
            key: "key-1",
            requestHash: "matching-hash",
            statusCode: 201,
            responseBody: mockBody,
            expiresAt: new Date(Date.now() + 60000),
          }),
        },
      } as unknown as Prisma.TransactionClient;

      const result = await checkIdempotency({
        companyId: "company-1",
        key: "key-1",
        requestHash: "matching-hash",
        client: mockClient,
      });

      expect(result.isReplay).toBe(true);
      expect(result.cachedResponse).toEqual({
        status: 201,
        body: mockBody,
      });
    });

    it("returns unavailableError when idempotencyKey model is missing", async () => {
      const mockClient = {} as Prisma.TransactionClient;
      const result = await checkIdempotency({
        companyId: "company-1",
        key: "key-1",
        requestHash: "hash-123",
        client: mockClient,
      });

      expect(result.isReplay).toBe(false);
      expect(result.unavailableError).toBe("Le service d'idempotence est indisponible.");
    });

    it("returns unavailableError when db lookup throws an exception", async () => {
      const mockClient = {
        idempotencyKey: {
          findUnique: vi.fn().mockRejectedValue(new Error("DB offline")),
        },
      } as unknown as Prisma.TransactionClient;

      const result = await checkIdempotency({
        companyId: "company-1",
        key: "key-1",
        requestHash: "hash-123",
        client: mockClient,
      });

      expect(result.isReplay).toBe(false);
      expect(result.unavailableError).toBe("Le service d'idempotence est indisponible.");
    });
  });

  describe("recordIdempotency", () => {
    it("creates an idempotency record inside the transaction and cleans up expired keys race-safely", async () => {
      const createMock = vi.fn().mockResolvedValue({});
      const deleteManyMock = vi.fn().mockResolvedValue({ count: 1 });
      const mockTx = {
        idempotencyKey: {
          create: createMock,
          deleteMany: deleteManyMock,
        },
      } as unknown as Prisma.TransactionClient;

      await recordIdempotency({
        tx: mockTx,
        companyId: "company-1",
        key: "key-1",
        userId: "user-1",
        endpoint: "/api/entries",
        requestHash: "hash-123",
        statusCode: 201,
        responseBody: { id: "entry-1" },
        retentionHours: 48,
      });

      // Verify expired key cleanup occurred before insertion
      expect(deleteManyMock).toHaveBeenCalledTimes(1);
      expect(deleteManyMock).toHaveBeenCalledWith({
        where: {
          companyId: "company-1",
          key: "key-1",
          expiresAt: { lte: expect.any(Date) },
        },
      });

      expect(createMock).toHaveBeenCalledTimes(1);
      const callData = createMock.mock.calls[0]![0].data;
      expect(callData.companyId).toBe("company-1");
      expect(callData.key).toBe("key-1");
      expect(callData.userId).toBe("user-1");
      expect(callData.endpoint).toBe("/api/entries");
      expect(callData.requestHash).toBe("hash-123");
      expect(callData.statusCode).toBe(201);
      expect(callData.responseBody).toEqual({ id: "entry-1" });
      expect(callData.expiresAt.getTime()).toBeGreaterThan(Date.now() + 47 * 3600 * 1000);
    });

    it("throws an error when idempotencyKey model is missing inside transaction", async () => {
      const mockTx = {} as Prisma.TransactionClient;
      await expect(
        recordIdempotency({
          tx: mockTx,
          companyId: "company-1",
          key: "key-1",
          userId: "user-1",
          endpoint: "/api/entries",
          requestHash: "hash-123",
          statusCode: 201,
          responseBody: {},
        })
      ).rejects.toThrow("Le service d'enregistrement d'idempotence est indisponible.");
    });
  });

  describe("createIdempotentReplayResponse", () => {
    it("constructs a NextResponse with replay headers", async () => {
      const response = createIdempotentReplayResponse(
        { status: 201, body: { data: "cached" } },
        "my-idemp-key"
      );

      expect(response.status).toBe(201);
      expect(response.headers.get("Idempotent-Replay")).toBe("true");
      expect(response.headers.get("X-Idempotency-Key")).toBe("my-idemp-key");

      const json = await response.json();
      expect(json).toEqual({ data: "cached" });
    });
  });
});

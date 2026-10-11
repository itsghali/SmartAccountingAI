import { describe, it, expect } from "vitest";
import { validateEnvValues } from "./env-validator";

describe("Production Environment Validator", () => {
  const validProductionEnv = {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://smartacct_user:strong_password_here@postgres:5432/smartaccountingai?schema=public",
    AUTH_SECRET: "c3VwZXJzZWNyZXRwYXNzd29yZDEyMzQ1Njc4OWFiY2RlZg==", // 48 chars
    NEXTAUTH_URL: "https://accounting.example.com",
    UPSTASH_REDIS_REST_URL: "http://redis-http-proxy:80",
    UPSTASH_REDIS_REST_TOKEN: "valid-production-long-random-redis-token-12345",
  };

  it("passes when all required production values are valid", () => {
    const result = validateEnvValues(validProductionEnv);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails closed when DATABASE_URL is missing in production", () => {
    const env = { ...validProductionEnv, DATABASE_URL: undefined };
    const result = validateEnvValues(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("DATABASE_URL"))).toBe(true);
  });

  it("fails closed when DATABASE_URL is not a PostgreSQL URL", () => {
    const env = { ...validProductionEnv, DATABASE_URL: "mysql://user:pass@localhost/db" };
    const result = validateEnvValues(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("PostgreSQL connection string"))).toBe(true);
  });

  it("fails closed when DATABASE_URL contains placeholder password", () => {
    const env = {
      ...validProductionEnv,
      DATABASE_URL: "postgresql://user:replace-with-url-encoded-password@postgres:5432/db",
    };
    const result = validateEnvValues(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("placeholder"))).toBe(true);
  });

  it("fails closed when AUTH_SECRET is missing in production", () => {
    const env = { ...validProductionEnv, AUTH_SECRET: undefined };
    const result = validateEnvValues(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("AUTH_SECRET"))).toBe(true);
  });

  it("fails closed when AUTH_SECRET is too short (< 32 chars)", () => {
    const env = { ...validProductionEnv, AUTH_SECRET: "short-secret" };
    const result = validateEnvValues(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("at least 32 characters"))).toBe(true);
  });

  it("fails closed when AUTH_SECRET is a known insecure default", () => {
    const env = {
      ...validProductionEnv,
      AUTH_SECRET: "replace-with-a-random-secret-of-at-least-32-characters",
    };
    const result = validateEnvValues(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("insecure default"))).toBe(true);
  });

  it("fails closed when production template placeholders are used", () => {
    const env = {
      ...validProductionEnv,
      DATABASE_URL: "postgresql://<user>:<url_encoded_password>@postgres:5432/<db>?schema=public",
      AUTH_SECRET: "<generate_high_entropy_32_plus_char_secret>",
      UPSTASH_REDIS_REST_TOKEN: "<generate_long_random_hex_token>",
    };
    const result = validateEnvValues(env);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(3);
  });

  it("fails closed when NEXTAUTH_URL is missing or invalid", () => {
    const envMissing = { ...validProductionEnv, NEXTAUTH_URL: undefined };
    expect(validateEnvValues(envMissing).valid).toBe(false);

    const envInvalid = { ...validProductionEnv, NEXTAUTH_URL: "not-a-url" };
    expect(validateEnvValues(envInvalid).valid).toBe(false);
  });

  it("fails closed when Redis token is missing while Redis URL is configured", () => {
    const env = {
      ...validProductionEnv,
      UPSTASH_REDIS_REST_URL: "http://redis-http-proxy:80",
      UPSTASH_REDIS_REST_TOKEN: undefined,
      REDIS_HTTP_TOKEN: undefined,
    };
    const result = validateEnvValues(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("REDIS"))).toBe(true);
  });

  it("fails closed when Redis token uses an insecure default placeholder", () => {
    const env = {
      ...validProductionEnv,
      UPSTASH_REDIS_REST_TOKEN: "supersecret_redis_token",
    };
    const result = validateEnvValues(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("insecure default"))).toBe(true);
  });

  it("does not expose sensitive values in error messages", () => {
    const secretValue = "top-secret-cleartext-value-which-must-not-leak";
    const env = {
      ...validProductionEnv,
      AUTH_SECRET: "short",
      DATABASE_URL: `postgresql://user:${secretValue}@localhost/db`,
    };
    const result = validateEnvValues(env);
    const errorString = result.errors.join(" ");
    expect(errorString).not.toContain(secretValue);
  });

  it("permits local development environment without blocking", () => {
    const devEnv = {
      NODE_ENV: "development",
      DATABASE_URL: undefined,
      AUTH_SECRET: undefined,
    };
    const result = validateEnvValues(devEnv);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

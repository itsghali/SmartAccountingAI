import { Redis } from "@upstash/redis";

let redisClient: Redis | null = null;
let mockRedisClient: Redis | null | undefined = undefined;

export function isRedisConfigured(): boolean {
  if (mockRedisClient !== undefined) {
    return mockRedisClient !== null;
  }
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.REDIS_HTTP_TOKEN)?.trim();
  return Boolean(url && token);
}

export function getRedisClient(): Redis | null {
  if (mockRedisClient !== undefined) {
    return mockRedisClient;
  }

  if (redisClient) {
    return redisClient;
  }

  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.REDIS_HTTP_TOKEN)?.trim();

  if (url && token) {
    try {
      redisClient = new Redis({
        url,
        token,
      });
      return redisClient;
    } catch (error) {
      console.error(
        "[Redis] Failed to initialize Redis client:",
        error instanceof Error ? error.message : "Unknown error"
      );
      return null;
    }
  }

  return null;
}

export function setMockRedisClient(mock: Redis | null | undefined): void {
  mockRedisClient = mock;
}

export function resetRedisClient(): void {
  redisClient = null;
  mockRedisClient = undefined;
}

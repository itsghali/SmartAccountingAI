/**
 * Production Environment Configuration Validator
 *
 * Ensures fail-closed behavior for required production secrets and prevents
 * execution with insecure fallback defaults.
 */

const KNOWN_INSECURE_SECRETS = new Set([
  "supersecretkey",
  "replace-with-a-random-secret-of-at-least-32-characters",
  "your-secret-key-min-32-chars",
  "secret",
  "changeme",
  "password",
  "admin",
]);

const KNOWN_INSECURE_TOKENS = new Set([
  "supersecret_redis_token",
  "replace-with-a-long-random-token",
  "token",
]);

function containsPlaceholder(value: string): boolean {
  return /<[^>]+>|replace[-_ ]with|generate[-_ ]|your[-_ ]|change[-_ ]?me|changeme/i.test(value);
}

export interface EnvValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateEnvValues(env: Record<string, string | undefined>): EnvValidationResult {
  const errors: string[] = [];
  const isProduction = env.NODE_ENV === "production";

  if (!isProduction) {
    return { valid: true, errors: [] };
  }

  // 1. DATABASE_URL validation
  const dbUrl = env.DATABASE_URL?.trim();
  if (!dbUrl) {
    errors.push("DATABASE_URL is required but was not provided");
  } else if (!/^postgres(ql)?:\/\//i.test(dbUrl)) {
    errors.push("DATABASE_URL must be a valid PostgreSQL connection string starting with postgresql:// or postgres://");
  } else if (containsPlaceholder(dbUrl)) {
    errors.push("DATABASE_URL contains an unconfigured placeholder password");
  }

  // 2. AUTH_SECRET validation
  const authSecret = env.AUTH_SECRET?.trim() || env.NEXTAUTH_SECRET?.trim();
  if (!authSecret) {
    errors.push("AUTH_SECRET is required in production but was not provided");
  } else if (authSecret.length < 32) {
    errors.push(`AUTH_SECRET must be at least 32 characters in production (received ${authSecret.length} characters)`);
  } else if (KNOWN_INSECURE_SECRETS.has(authSecret.toLowerCase()) || containsPlaceholder(authSecret)) {
    errors.push("AUTH_SECRET uses an insecure default/example placeholder value");
  }

  // 3. NEXTAUTH_URL validation
  const nextAuthUrl = env.NEXTAUTH_URL?.trim();
  if (!nextAuthUrl) {
    errors.push("NEXTAUTH_URL is required in production but was not provided");
  } else if (!/^https?:\/\//i.test(nextAuthUrl)) {
    errors.push("NEXTAUTH_URL must be a valid HTTP/HTTPS URL");
  }

  // 4. Redis configuration validation (Strictly required in production for distributed rate limiting & revocation)
  const redisUrl = env.UPSTASH_REDIS_REST_URL?.trim();
  const redisToken = (env.UPSTASH_REDIS_REST_TOKEN || env.REDIS_HTTP_TOKEN)?.trim();
  if (!redisUrl) {
    errors.push("UPSTASH_REDIS_REST_URL is required in production for distributed rate limiting and session revocation");
  }
  if (!redisToken) {
    errors.push("UPSTASH_REDIS_REST_TOKEN (or REDIS_HTTP_TOKEN) is required in production for distributed rate limiting and session revocation");
  } else if (KNOWN_INSECURE_TOKENS.has(redisToken.toLowerCase()) || containsPlaceholder(redisToken)) {
    errors.push("Redis authentication token uses an insecure default/example placeholder value");
  }

  // 5. Document processor provider credentials
  const provider = env.DOCUMENT_PROCESSOR_PROVIDER?.trim().toLowerCase();
  if (provider === "groq" && !env.GROQ_API_KEY?.trim()) {
    errors.push("GROQ_API_KEY is required when DOCUMENT_PROCESSOR_PROVIDER is set to 'groq'");
  } else if (provider === "openai" && !env.OPENAI_API_KEY?.trim()) {
    errors.push("OPENAI_API_KEY is required when DOCUMENT_PROCESSOR_PROVIDER is set to 'openai'");
  } else if (provider === "openrouter" && !env.OPENROUTER_API_KEY?.trim()) {
    errors.push("OPENROUTER_API_KEY is required when DOCUMENT_PROCESSOR_PROVIDER is set to 'openrouter'");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateProductionEnv(): void {
  const result = validateEnvValues(process.env as Record<string, string | undefined>);
  if (!result.valid) {
    const message = [
      "[FATAL CONFIGURATION ERROR] Production startup halted due to insecure or missing configuration:",
      ...result.errors.map((err) => `  - ${err}`),
      "Please provide valid, production-grade credentials via your secure secret manager.",
    ].join("\n");
    console.error(message);
    throw new Error(message);
  }
}

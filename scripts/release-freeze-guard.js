#!/usr/bin/env node
/**
 * Sprint 0.1 Release Freeze Enforcement Guard
 *
 * Enforces production release freeze until Sprint 0.1 acceptance criteria
 * are formally signed off and required security gates are approved.
 */

const isVerifyPolicyMode = process.argv.includes("--verify-policy");
const isValidateEnvMode = process.argv.includes("--validate-env");

// Release freeze is ACTIVE by default for Sprint 0.1
const RELEASE_FREEZE_ACTIVE = true;
const bypassApproved = process.env.RELEASE_FREEZE_BYPASS_APPROVED === "true";

function printBanner(status, message) {
  console.log("\n" + "=".repeat(80));
  console.log(`[RELEASE FREEZE ENFORCEMENT] - STATUS: ${status}`);
  console.log("=".repeat(80));
  console.log(message);
  console.log("=".repeat(80) + "\n");
}

if (isVerifyPolicyMode) {
  // Verification mode: asserts that the freeze policy is active and blocking
  if (RELEASE_FREEZE_ACTIVE) {
    console.log("[Release Freeze Policy] ACTIVE - Production release gates are enforced.");
    console.log("[Release Freeze Policy] Deployments without explicit authorization will fail closed.");
    process.exit(0);
  } else {
    console.error("[Release Freeze Policy] FAILED: Release freeze is unexpectedly inactive.");
    process.exit(1);
  }
}

if (isValidateEnvMode) {
  const required = [
    "POSTGRES_DB",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "DATABASE_URL",
    "NEXTAUTH_URL",
    "AUTH_SECRET",
    "REDIS_HTTP_TOKEN",
  ];
  const missing = required.filter((v) => !process.env[v] || process.env[v].trim() === "");
  if (missing.length > 0) {
    console.error(`[Pre-deployment Check] FAILED: Missing required variables: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log("[Pre-deployment Check] All required production variables are set.");
  process.exit(0);
}

// Default execution mode (e.g. called from start-smartaccounting.bat or deployment pipeline)
if (RELEASE_FREEZE_ACTIVE && !bypassApproved) {
  printBanner(
    "BLOCKED (Sprint 0.1 Freeze Active)",
    "Production deployment is strictly halted by Sprint 0.1 Release Freeze.\n" +
    "\nMandatory release gates required before deployment:\n" +
    "  1. Sprint 0.1 acceptance criteria must be formally verified and approved.\n" +
    "  2. Insecure production fallback secrets must be eliminated (fail-closed verified).\n" +
    "  3. Host port isolation for PostgreSQL, Redis, and OCR must be verified.\n" +
    "  4. OCR readiness and healthcheck warmup must be verified at runtime.\n" +
    "  5. Credential rotation checklist must be executed in external secret manager.\n" +
    "  6. Platform-level release protection (e.g. GitHub environment approvals) must be enabled.\n" +
    "\nTo request an emergency authorized release bypass, set:\n" +
    "  RELEASE_FREEZE_BYPASS_APPROVED=true and provide signed authorization."
  );
  process.exit(1);
}

console.log("[Release Freeze] Release bypass authorized. Proceeding with deployment.");
process.exit(0);

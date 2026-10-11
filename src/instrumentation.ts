export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Fail closed immediately on missing or insecure production configuration
    const { validateProductionEnv } = await import("@/server/env-validator");
    validateProductionEnv();

    try {
      const { resetDanglingProcessingOnStartup } = await import("@/server/document-cleanup");
      const count = await resetDanglingProcessingOnStartup();
      if (count > 0) {
        console.log(`[Instrumentation] Recovered ${count} interrupted document(s) from previous container run.`);
      }
    } catch (err) {
      console.error("[Instrumentation] Failed to reset dangling documents on startup:", err);
    }
  }
}

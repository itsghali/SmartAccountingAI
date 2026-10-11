export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
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

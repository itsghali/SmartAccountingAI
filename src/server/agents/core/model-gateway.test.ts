import { afterEach, describe, expect, it, vi } from "vitest";
import { modelGateway } from "./model-gateway";

describe("ModelGateway Groq configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("selects Groq and its configured model when the key is present", () => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    vi.stubEnv("GROQ_MODEL", "openai/gpt-oss-120b");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");

    expect(modelGateway.getDefaultConfig()).toEqual({
      provider: "groq",
      model: "openai/gpt-oss-120b",
      temperature: 0.1,
      maxTokens: 4000,
    });
  });

  it("uses GPT-OSS 120B as the Groq default", () => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    vi.stubEnv("GROQ_MODEL", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");

    expect(modelGateway.getDefaultConfig().model).toBe("openai/gpt-oss-120b");
  });

  it("keeps Groq API keys out of the exposed model version", () => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");

    expect(modelGateway.getModelVersion("llama-3.3-70b")).toBe(
      "llama-3.3-70b-versatile"
    );
  });
});

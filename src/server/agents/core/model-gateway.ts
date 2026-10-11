import { ChatOpenAI } from "@langchain/openai";
import { BaseLanguageModel } from "@langchain/core/language_models/base";
import { ModelConfig } from "../types";

export type SupportedModel =
  | "gpt-4o"
  | "gpt-4o-mini"
  | "gpt-4-turbo"
  | "llama-3.3-70b"
  | "llama-3.1-8b"
  | "mixtral-8x7b"
  | "gemma2-9b"
  | "openai/gpt-oss-120b";

const FALLBACK_CONFIG: ModelConfig = {
  provider: "openrouter",
  model: "openai/gpt-oss-120b",
  temperature: 0.2,
  maxTokens: 16000,
};

const GROQ_MAX_TOKENS = 8192;

const MODEL_VERSIONS: Record<SupportedModel, string> = {
  "gpt-4o": "gpt-4o-2024-08-06",
  "gpt-4o-mini": "gpt-4o-mini-2024-07-18",
  "gpt-4-turbo": "gpt-4-turbo-2024-04-09",
  "llama-3.3-70b": "llama-3.3-70b-versatile",
  "llama-3.1-8b": "llama-3.1-8b-instant",
  "mixtral-8x7b": "mixtral-8x7b-32768",
  "gemma2-9b": "gemma2-9b-it",
  "openai/gpt-oss-120b": "openai/gpt-oss-120b",
};

export class ModelGateway {
  private static instance: ModelGateway;
  private modelCache: Map<string, BaseLanguageModel> = new Map();

  private constructor() {}

  static getInstance(): ModelGateway {
    if (!ModelGateway.instance) {
      ModelGateway.instance = new ModelGateway();
    }
    return ModelGateway.instance;
  }

  getModel(config?: Partial<ModelConfig>): BaseLanguageModel {
    const finalConfig = { ...this.getDefaultConfig(), ...config };
    const cacheKey = `${finalConfig.provider}:${finalConfig.model}:${finalConfig.temperature}:${finalConfig.maxTokens}`;

    if (this.modelCache.has(cacheKey)) {
      return this.modelCache.get(cacheKey)!;
    }

    const model = this.createModel(finalConfig);
    this.modelCache.set(cacheKey, model);
    return model;
  }

  private createModel(config: ModelConfig): BaseLanguageModel {
    if (config.provider === "openai") {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error("OPENAI_API_KEY environment variable is not set");
      }

      return new ChatOpenAI({
        modelName: MODEL_VERSIONS[config.model as SupportedModel] || config.model,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        apiKey,
      });
    }

    if (config.provider === "groq") {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) {
        throw new Error("GROQ_API_KEY environment variable is not set");
      }
      const groqMaxTokens = Math.min(config.maxTokens ?? GROQ_MAX_TOKENS, GROQ_MAX_TOKENS);

      return new ChatOpenAI({
        modelName: MODEL_VERSIONS[config.model as SupportedModel] || config.model,
        temperature: config.temperature,
        maxTokens: groqMaxTokens,
        apiKey,
        modelKwargs: { response_format: { type: "json_object" } },
        configuration: {
          baseURL: "https://api.groq.com/openai/v1",
        },
      });
    }

    if (config.provider === "openrouter") {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error("OPENROUTER_API_KEY environment variable is not set");
      }

      return new ChatOpenAI({
        modelName: MODEL_VERSIONS[config.model as SupportedModel] || config.model,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        apiKey,
        configuration: {
          baseURL: "https://openrouter.ai/api/v1",
          defaultHeaders: {
            "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:3000",
            "X-Title": "SmartAccountingAI",
          },
        },
      });
    }

    if (config.provider === "ollama") {
      return new ChatOpenAI({
        modelName: config.model,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        apiKey: "ollama", // API key is not required for local Ollama but ChatOpenAI needs a string
        configuration: {
          baseURL: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
        },
      });
    }

    throw new Error(`Unsupported provider: ${config.provider}`);
  }

  getModelVersion(model: string): string {
    return MODEL_VERSIONS[model as SupportedModel] || model;
  }

  getDefaultConfig(): ModelConfig {
    if (process.env.GROQ_API_KEY) {
      return {
        provider: "groq",
        model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
        temperature: 0.1,
        maxTokens: 4000,
      };
    }

    if (process.env.OPENROUTER_API_KEY) {
      return { ...FALLBACK_CONFIG };
    }

    if (process.env.OPENAI_API_KEY) {
      return {
        provider: "openai",
        model: "gpt-4o-mini",
        temperature: 0.1,
        maxTokens: 4000,
      };
    }

    return { ...FALLBACK_CONFIG };
  }
}

export const modelGateway = ModelGateway.getInstance();

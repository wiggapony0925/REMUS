// ─────────────────────────────────────────────────────────────
// Remus — Provider Registry & Factory (v2)
// 6 providers + Remus model stub + model router
// Most flexible LLM backend system in any coding assistant
// ─────────────────────────────────────────────────────────────

import type { LLMProvider } from './types.js';
import { OpenAIProvider } from './openai.js';
import { OllamaProvider } from './ollama.js';
import { AnthropicProvider } from './anthropic.js';
import { RemusModelProvider } from './remus.js';

export type ProviderType = 'ollama' | 'openai' | 'anthropic' | 'openrouter' | 'lmstudio' | 'remus' | 'custom';

export interface ProviderConfig {
  type: ProviderType;
  baseUrl?: string;
  apiKey?: string;
  model: string;
  /** Fast model for simple tasks (model router) */
  fastModel?: string;
  /** Smart model for complex tasks (model router) */
  smartModel?: string;
}

const DEFAULT_CONFIGS: Record<ProviderType, Partial<ProviderConfig>> = {
  ollama: { baseUrl: 'http://localhost:11434' },
  openai: { baseUrl: 'https://api.openai.com' },
  anthropic: { baseUrl: 'https://api.anthropic.com' },
  openrouter: { baseUrl: 'https://openrouter.ai/api' },
  lmstudio: { baseUrl: 'http://localhost:1234' },
  remus: { baseUrl: 'https://api.remus.ai' },  // Future Remus API
  custom: {},
};

export function createProvider(config: ProviderConfig): LLMProvider {
  const defaults = DEFAULT_CONFIGS[config.type] ?? {};
  const baseUrl = config.baseUrl ?? defaults.baseUrl ?? '';
  const apiKey = config.apiKey ?? '';

  switch (config.type) {
    case 'ollama':
      return new OllamaProvider({ baseUrl, model: config.model });

    case 'anthropic':
      return new AnthropicProvider({ apiKey, model: config.model, baseUrl });

    case 'remus':
      return new RemusModelProvider({
        baseUrl: baseUrl || 'https://api.remus.ai',
        apiKey,
        model: config.model,
      });

    case 'openai':
    case 'openrouter':
    case 'lmstudio':
    case 'custom':
      return new OpenAIProvider({
        baseUrl,
        apiKey,
        model: config.model,
        name: config.type,
      });

    default:
      throw new Error(`Unknown provider type: ${config.type}`);
  }
}

/**
 * Auto-detect and configure provider from environment variables.
 * Priority order:
 *   1. REMUS_PROVIDER + REMUS_MODEL (explicit)
 *   2. OPENAI_API_KEY (OpenAI)
 *   3. ANTHROPIC_API_KEY (Anthropic)
 *   4. OPENROUTER_API_KEY (OpenRouter)
 *   5. Ollama on localhost (default fallback)
 */
export function autoDetectProvider(): ProviderConfig {
  const env = process.env;

  // Explicit configuration
  if (env.REMUS_PROVIDER) {
    return {
      type: env.REMUS_PROVIDER as ProviderType,
      baseUrl: env.REMUS_BASE_URL,
      apiKey: env.REMUS_API_KEY ?? '',
      model: env.REMUS_MODEL ?? 'default',
      fastModel: env.REMUS_FAST_MODEL,
      smartModel: env.REMUS_SMART_MODEL,
    };
  }

  // Remus native model (when available)
  if (env.REMUS_MODEL_KEY) {
    return {
      type: 'remus',
      apiKey: env.REMUS_MODEL_KEY,
      model: env.REMUS_MODEL ?? 'remus-1',
      baseUrl: env.REMUS_MODEL_URL ?? 'https://api.remus.ai',
    };
  }

  // OpenAI
  if (env.OPENAI_API_KEY) {
    return {
      type: 'openai',
      apiKey: env.OPENAI_API_KEY,
      model: env.REMUS_MODEL ?? 'gpt-4o',
      fastModel: env.REMUS_FAST_MODEL ?? 'gpt-4o-mini',
      smartModel: env.REMUS_SMART_MODEL ?? 'gpt-4o',
    };
  }

  // Anthropic
  if (env.ANTHROPIC_API_KEY) {
    return {
      type: 'anthropic',
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.REMUS_MODEL ?? 'claude-sonnet-4-20250514',
    };
  }

  // OpenRouter
  if (env.OPENROUTER_API_KEY) {
    return {
      type: 'openrouter',
      apiKey: env.OPENROUTER_API_KEY,
      model: env.REMUS_MODEL ?? 'anthropic/claude-sonnet-4',
    };
  }

  // Default: Ollama
  return {
    type: 'ollama',
    model: env.REMUS_MODEL ?? 'qwen2.5-coder:14b',
  };
}

export { type LLMProvider, type Message, type ToolDefinition } from './types.js';

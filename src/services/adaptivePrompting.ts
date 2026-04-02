// ─────────────────────────────────────────────────────────────
// Remus — Adaptive Prompting
// Model-specific optimizations that squeeze maximum performance
// out of every LLM provider. Different models have different
// strengths, weaknesses, and prompt formats — this system
// adapts Remus's behavior to each model automatically.
// ─────────────────────────────────────────────────────────────

import type { ProjectProfile } from './contextEngine.js';

// ─── Types ───

export interface ModelProfile {
  id: string;
  provider: string;
  family: ModelFamily;
  contextWindow: number;         // max tokens
  supportsToolCalling: boolean;
  supportsStreaming: boolean;
  supportsSystemPrompt: boolean;
  supportsParallelTools: boolean;
  optimalTemperature: number;
  maxOutputTokens: number;
  strengths: string[];
  weaknesses: string[];
  promptStyle: PromptStyle;
  costTier: 'free' | 'cheap' | 'mid' | 'premium';
  speedTier: 'instant' | 'fast' | 'normal' | 'slow';
}

export type ModelFamily =
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'gpt-4-turbo'
  | 'gpt-3.5-turbo'
  | 'o1'
  | 'o3'
  | 'claude-opus'
  | 'claude-sonnet'
  | 'claude-haiku'
  | 'llama'
  | 'qwen'
  | 'codellama'
  | 'deepseek'
  | 'deepseek-coder'
  | 'mistral'
  | 'mixtral'
  | 'gemma'
  | 'phi'
  | 'starcoder'
  | 'command-r'
  | 'gemini-pro'
  | 'gemini-flash'
  | 'remus'
  | 'unknown';

export type PromptStyle =
  | 'structured'     // Prefers markdown headers, clear structure
  | 'conversational' // Prefers natural language
  | 'minimal'        // Small models — keep it short
  | 'chain-of-thought'; // Reasoning models — let them think

// ─── Model Database ───

const MODEL_PROFILES: Record<string, Partial<ModelProfile>> = {
  // ─── OpenAI ───
  'gpt-4o': {
    family: 'gpt-4o', contextWindow: 128_000, supportsToolCalling: true,
    supportsStreaming: true, supportsSystemPrompt: true, supportsParallelTools: true,
    optimalTemperature: 0.3, maxOutputTokens: 16_384,
    strengths: ['code generation', 'multi-file refactoring', 'debugging', 'architecture'],
    weaknesses: ['can be verbose', 'sometimes hallucinates file paths'],
    promptStyle: 'structured', costTier: 'premium', speedTier: 'fast',
  },
  'gpt-4o-mini': {
    family: 'gpt-4o-mini', contextWindow: 128_000, supportsToolCalling: true,
    supportsStreaming: true, supportsSystemPrompt: true, supportsParallelTools: true,
    optimalTemperature: 0.2, maxOutputTokens: 16_384,
    strengths: ['fast responses', 'simple edits', 'explanations', 'cost efficient'],
    weaknesses: ['struggles with complex multi-step tasks', 'less creative'],
    promptStyle: 'structured', costTier: 'cheap', speedTier: 'instant',
  },
  'gpt-4-turbo': {
    family: 'gpt-4-turbo', contextWindow: 128_000, supportsToolCalling: true,
    supportsStreaming: true, supportsSystemPrompt: true, supportsParallelTools: true,
    optimalTemperature: 0.3, maxOutputTokens: 4_096,
    strengths: ['reliable tool calling', 'consistent output'],
    weaknesses: ['slower than gpt-4o', 'lower output limit'],
    promptStyle: 'structured', costTier: 'premium', speedTier: 'normal',
  },
  'o1': {
    family: 'o1', contextWindow: 200_000, supportsToolCalling: false,
    supportsStreaming: false, supportsSystemPrompt: false, supportsParallelTools: false,
    optimalTemperature: 1.0, maxOutputTokens: 100_000,
    strengths: ['deep reasoning', 'math', 'complex logic', 'architecture planning'],
    weaknesses: ['no tool calling', 'no streaming', 'slow', 'expensive'],
    promptStyle: 'chain-of-thought', costTier: 'premium', speedTier: 'slow',
  },
  'o3-mini': {
    family: 'o3', contextWindow: 200_000, supportsToolCalling: true,
    supportsStreaming: true, supportsSystemPrompt: true, supportsParallelTools: true,
    optimalTemperature: 1.0, maxOutputTokens: 100_000,
    strengths: ['reasoning with tools', 'code analysis', 'planning'],
    weaknesses: ['slower than gpt-4o', 'more expensive for simple tasks'],
    promptStyle: 'chain-of-thought', costTier: 'premium', speedTier: 'normal',
  },

  // ─── Anthropic ───
  'claude-sonnet': {
    family: 'claude-sonnet', contextWindow: 200_000, supportsToolCalling: true,
    supportsStreaming: true, supportsSystemPrompt: true, supportsParallelTools: true,
    optimalTemperature: 0.3, maxOutputTokens: 8_192,
    strengths: ['code quality', 'following instructions', 'safety', 'long context'],
    weaknesses: ['can be cautious', 'sometimes refuses valid requests'],
    promptStyle: 'structured', costTier: 'mid', speedTier: 'fast',
  },
  'claude-opus': {
    family: 'claude-opus', contextWindow: 200_000, supportsToolCalling: true,
    supportsStreaming: true, supportsSystemPrompt: true, supportsParallelTools: true,
    optimalTemperature: 0.3, maxOutputTokens: 8_192,
    strengths: ['nuanced reasoning', 'long documents', 'complex refactoring'],
    weaknesses: ['slower', 'expensive'],
    promptStyle: 'structured', costTier: 'premium', speedTier: 'normal',
  },
  'claude-haiku': {
    family: 'claude-haiku', contextWindow: 200_000, supportsToolCalling: true,
    supportsStreaming: true, supportsSystemPrompt: true, supportsParallelTools: true,
    optimalTemperature: 0.2, maxOutputTokens: 8_192,
    strengths: ['speed', 'cost efficiency', 'simple tasks'],
    weaknesses: ['less capable for complex code', 'shorter outputs'],
    promptStyle: 'minimal', costTier: 'cheap', speedTier: 'instant',
  },

  // ─── Open Source / Ollama ───
  'qwen2.5-coder': {
    family: 'qwen', contextWindow: 32_768, supportsToolCalling: true,
    supportsStreaming: true, supportsSystemPrompt: true, supportsParallelTools: false,
    optimalTemperature: 0.1, maxOutputTokens: 8_192,
    strengths: ['code generation', 'fast on local hardware', 'free'],
    weaknesses: ['limited context', 'weaker reasoning', 'tool calling unreliable'],
    promptStyle: 'minimal', costTier: 'free', speedTier: 'fast',
  },
  'llama': {
    family: 'llama', contextWindow: 8_192, supportsToolCalling: true,
    supportsStreaming: true, supportsSystemPrompt: true, supportsParallelTools: false,
    optimalTemperature: 0.2, maxOutputTokens: 4_096,
    strengths: ['general coding', 'free', 'local'],
    weaknesses: ['limited context', 'tool calling unreliable', 'inconsistent JSON'],
    promptStyle: 'minimal', costTier: 'free', speedTier: 'fast',
  },
  'deepseek-coder': {
    family: 'deepseek-coder', contextWindow: 16_384, supportsToolCalling: true,
    supportsStreaming: true, supportsSystemPrompt: true, supportsParallelTools: false,
    optimalTemperature: 0.1, maxOutputTokens: 8_192,
    strengths: ['code completion', 'code understanding', 'free'],
    weaknesses: ['limited context', 'tool calling can be shaky'],
    promptStyle: 'minimal', costTier: 'free', speedTier: 'fast',
  },
  'deepseek': {
    family: 'deepseek', contextWindow: 64_000, supportsToolCalling: true,
    supportsStreaming: true, supportsSystemPrompt: true, supportsParallelTools: true,
    optimalTemperature: 0.2, maxOutputTokens: 8_192,
    strengths: ['reasoning', 'code generation', 'cost efficient'],
    weaknesses: ['slower than openai', 'occasionally verbose'],
    promptStyle: 'structured', costTier: 'cheap', speedTier: 'normal',
  },
  'mistral': {
    family: 'mistral', contextWindow: 32_768, supportsToolCalling: true,
    supportsStreaming: true, supportsSystemPrompt: true, supportsParallelTools: false,
    optimalTemperature: 0.2, maxOutputTokens: 8_192,
    strengths: ['balanced performance', 'good tool calling'],
    weaknesses: ['medium context', 'less capable for very complex tasks'],
    promptStyle: 'structured', costTier: 'cheap', speedTier: 'fast',
  },

  // ─── Google ───
  'gemini-pro': {
    family: 'gemini-pro', contextWindow: 1_000_000, supportsToolCalling: true,
    supportsStreaming: true, supportsSystemPrompt: true, supportsParallelTools: true,
    optimalTemperature: 0.3, maxOutputTokens: 8_192,
    strengths: ['massive context window', 'multimodal', 'good at code'],
    weaknesses: ['tool calling format differs', 'can be wordy'],
    promptStyle: 'structured', costTier: 'mid', speedTier: 'fast',
  },
  'gemini-flash': {
    family: 'gemini-flash', contextWindow: 1_000_000, supportsToolCalling: true,
    supportsStreaming: true, supportsSystemPrompt: true, supportsParallelTools: true,
    optimalTemperature: 0.2, maxOutputTokens: 8_192,
    strengths: ['very fast', 'huge context', 'cheap'],
    weaknesses: ['less capable than pro', 'can miss edge cases'],
    promptStyle: 'minimal', costTier: 'cheap', speedTier: 'instant',
  },
};

// ─── Model Identification ───

export function identifyModel(modelName: string): ModelProfile {
  const lower = modelName.toLowerCase();

  // Direct match
  for (const [key, profile] of Object.entries(MODEL_PROFILES)) {
    if (lower.includes(key)) {
      return {
        id: modelName,
        provider: 'auto',
        family: profile.family ?? 'unknown',
        contextWindow: profile.contextWindow ?? 8_192,
        supportsToolCalling: profile.supportsToolCalling ?? true,
        supportsStreaming: profile.supportsStreaming ?? true,
        supportsSystemPrompt: profile.supportsSystemPrompt ?? true,
        supportsParallelTools: profile.supportsParallelTools ?? false,
        optimalTemperature: profile.optimalTemperature ?? 0.3,
        maxOutputTokens: profile.maxOutputTokens ?? 4_096,
        strengths: profile.strengths ?? [],
        weaknesses: profile.weaknesses ?? [],
        promptStyle: profile.promptStyle ?? 'structured',
        costTier: profile.costTier ?? 'mid',
        speedTier: profile.speedTier ?? 'normal',
      };
    }
  }

  // Unknown model — safe defaults
  return {
    id: modelName,
    provider: 'auto',
    family: 'unknown',
    contextWindow: 8_192,
    supportsToolCalling: true,
    supportsStreaming: true,
    supportsSystemPrompt: true,
    supportsParallelTools: false,
    optimalTemperature: 0.3,
    maxOutputTokens: 4_096,
    strengths: [],
    weaknesses: [],
    promptStyle: 'structured',
    costTier: 'mid',
    speedTier: 'normal',
  };
}

// ─── Adaptive Prompt Builder ───

export interface AdaptivePromptOptions {
  modelProfile: ModelProfile;
  projectProfile: ProjectProfile | null;
  queryComplexity: 'simple' | 'moderate' | 'complex';
  taskType: TaskType;
  hasContext: boolean;
}

export type TaskType =
  | 'code-gen'
  | 'debug'
  | 'refactor'
  | 'explain'
  | 'test'
  | 'review'
  | 'general'
  | 'architecture'
  | 'devops';

/**
 * Classify what type of task the user is requesting.
 */
export function classifyTask(query: string): TaskType {
  const lower = query.toLowerCase();

  if (/\b(write|create|implement|build|add|generate|make|scaffold)\b/.test(lower)) return 'code-gen';
  if (/\b(fix|debug|error|bug|crash|broken|wrong|doesn.?t work|issue|failing)\b/.test(lower)) return 'debug';
  if (/\b(refactor|rename|move|extract|reorganize|clean.?up|restructure|split|simplify)\b/.test(lower)) return 'refactor';
  if (/\b(explain|what does|how does|why|tell me about|describe|walk me through|understand)\b/.test(lower)) return 'explain';
  if (/\b(test|spec|coverage|assertion|describe\(|it\(|expect)\b/.test(lower)) return 'test';
  if (/\b(review|audit|check|inspect|analyze|security|vulnerability|performance)\b/.test(lower)) return 'review';
  if (/\b(architect|design|plan|system|diagram|structure|pattern|scale)\b/.test(lower)) return 'architecture';
  if (/\b(deploy|docker|ci|cd|pipeline|kubernetes|terraform|nginx|server|env|config)\b/.test(lower)) return 'devops';

  return 'general';
}

/**
 * Classify query complexity.
 */
export function classifyComplexity(query: string): 'simple' | 'moderate' | 'complex' {
  const lower = query.toLowerCase();
  const wordCount = query.split(/\s+/).length;

  // Complex indicators
  if (wordCount > 50) return 'complex';
  if (/\b(all files|entire|every|across|codebase|whole project|refactor everything)\b/.test(lower)) return 'complex';
  if (/\b(architect|redesign|migrate|rewrite|multi.?step|plan)\b/.test(lower)) return 'complex';
  if ((query.match(/\band\b/gi) || []).length >= 3) return 'complex'; // Multiple requirements

  // Simple indicators
  if (wordCount < 10) return 'simple';
  if (/\b(what is|explain|show|list|print|how to)\b/.test(lower)) return 'simple';

  return 'moderate';
}

/**
 * Build model-specific prompt adaptations.
 * These are injected into the system prompt to optimize
 * how the model uses tools and generates code.
 */
export function buildAdaptivePromptSection(opts: AdaptivePromptOptions): string {
  const { modelProfile, projectProfile, queryComplexity, taskType } = opts;
  const sections: string[] = [];

  // ─── Model-Specific Instructions ───
  switch (modelProfile.promptStyle) {
    case 'minimal':
      sections.push(`# Model Guidance
You are running on a ${modelProfile.family} model. Keep responses focused and concise.
- Prefer shorter code blocks — avoid full file dumps
- Use 1-2 tool calls per turn when possible
- Answer directly, skip preamble
- For multi-file tasks, work one file at a time`);
      break;

    case 'chain-of-thought':
      sections.push(`# Model Guidance
You are a reasoning model. Think through problems step by step.
- Break complex problems into clear reasoning steps
- Consider edge cases and potential issues before writing code
- For tool calls, plan which tools you need first, then execute
- Explain your reasoning when making architectural decisions`);
      break;

    case 'structured':
    default:
      if (queryComplexity === 'complex') {
        sections.push(`# Model Guidance
This is a complex task. Follow this approach:
1. Analyze — Read relevant files and understand the codebase first
2. Plan — Outline your approach before making changes
3. Execute — Make changes incrementally, verifying each step
4. Verify — Run tests or typechecking after changes`);
      }
      break;
  }

  // ─── Parallel Tools ───
  if (modelProfile.supportsParallelTools) {
    sections.push(`**Parallel Tool Optimization:** You can call multiple tools simultaneously. When you need to read multiple files, read_file them all in one turn. When you need to search and read, combine grep + read_file calls.`);
  } else {
    sections.push(`**Tool Calling:** Call tools one at a time and wait for results before making decisions.`);
  }

  // ─── Context Window Management ───
  if (modelProfile.contextWindow < 16_000) {
    sections.push(`**Context Warning:** Your context window is limited (${(modelProfile.contextWindow / 1000).toFixed(0)}K tokens). Be very selective about what files you read. Prefer targeted line ranges with read_file instead of reading whole files. Avoid reading files you don't need.`);
  } else if (modelProfile.contextWindow >= 100_000) {
    sections.push(`**Large Context Available:** You have ${(modelProfile.contextWindow / 1000).toFixed(0)}K tokens. You can read multiple files to understand codebases before making changes.`);
  }

  // ─── Task-Specific Guidance ───
  switch (taskType) {
    case 'debug':
      sections.push(`**Debug Mode Active:** For this debugging task:
1. First understand the error — read the relevant file and surrounding context
2. Look at error messages, stack traces, and related code
3. Identify the ROOT CAUSE, not just symptoms
4. Fix minimally — change only what's needed
5. Verify the fix resolves the issue`);
      break;

    case 'refactor':
      sections.push(`**Refactor Mode Active:** For this refactoring task:
1. Grep for ALL usages of the code being refactored
2. Plan changes across all affected files
3. Make changes incrementally — one file/function at a time
4. Verify nothing breaks after each change`);
      break;

    case 'code-gen':
      sections.push(`**Code Generation Mode:** For this task:
1. Follow existing patterns in the codebase
2. Include all necessary imports
3. Handle errors properly
4. Write complete implementations — no TODOs or placeholders`);
      break;

    case 'test':
      sections.push(`**Test Mode Active:** For this testing task:
1. Match the project's existing test patterns and framework
2. Cover edge cases and error scenarios
3. Use descriptive test names that document behavior
4. Mock external dependencies appropriately`);
      break;

    case 'review':
      sections.push(`**Review Mode Active:** For this code review:
1. Check for bugs, security issues, and performance problems
2. Verify error handling and edge cases
3. Look at code style, naming, and architecture
4. Prioritize issues by severity`);
      break;

    case 'architecture':
      sections.push(`**Architecture Mode Active:** For this design task:
1. Consider scalability, maintainability, and separation of concerns
2. Look at existing patterns in the codebase
3. Propose clear boundaries between components
4. Think about testing strategy`);
      break;
  }

  // ─── Project-Specific Guidance ───
  if (projectProfile) {
    const hints: string[] = [];

    if (projectProfile.hasTypeScript) {
      hints.push('This is a TypeScript project — use proper types, avoid `any`');
    }
    if (projectProfile.testFramework) {
      hints.push(`Tests use ${projectProfile.testFramework} — match existing test patterns`);
    }
    if (projectProfile.framework) {
      hints.push(`Built with ${projectProfile.framework} — follow framework conventions`);
    }
    if (projectProfile.hasESLint) {
      hints.push('ESLint is configured — follow its rules');
    }
    if (projectProfile.packageManager) {
      hints.push(`Package manager: ${projectProfile.packageManager}`);
    }

    if (hints.length > 0) {
      sections.push(`**Project Conventions:**\n${hints.map(h => `- ${h}`).join('\n')}`);
    }
  }

  // ─── Weakness Compensation ───
  if (modelProfile.weaknesses.length > 0) {
    const compensations: string[] = [];

    if (modelProfile.weaknesses.some(w => w.includes('hallucinate'))) {
      compensations.push('IMPORTANT: Always verify file paths exist before editing. Use glob or list_dir to confirm.');
    }
    if (modelProfile.weaknesses.some(w => w.includes('verbose'))) {
      compensations.push('Keep responses concise — no unnecessary explanations or caveats.');
    }
    if (modelProfile.weaknesses.some(w => w.includes('JSON'))) {
      compensations.push('When making tool calls, ensure arguments are valid JSON. Double-check quotes and brackets.');
    }
    if (modelProfile.weaknesses.some(w => w.includes('tool calling'))) {
      compensations.push('For tool calls, use simple argument structures. Prefer string arguments over complex nested objects.');
    }
    if (modelProfile.weaknesses.some(w => w.includes('refuses'))) {
      compensations.push('The user has granted full filesystem access — you are authorized to read/write any file in the working directory.');
    }

    if (compensations.length > 0) {
      sections.push(`**Critical Reminders:**\n${compensations.map(c => `- ${c}`).join('\n')}`);
    }
  }

  return sections.join('\n\n');
}

/**
 * Get the optimal temperature for a given task + model combo.
 */
export function getOptimalTemperature(modelProfile: ModelProfile, taskType: TaskType): number {
  // Task-specific adjustments
  const taskTemp: Record<TaskType, number> = {
    'code-gen': -0.1,     // Be more precise
    'debug': -0.15,       // Very precise for bug fixing
    'refactor': -0.1,     // Precise for refactoring
    'explain': 0.1,       // More creative for explanations
    'test': -0.05,        // Mostly precise
    'review': 0.0,        // Balanced
    'general': 0.0,       // Balanced
    'architecture': 0.1,  // More creative for design
    'devops': -0.05,      // Precise for configs
  };

  const base = modelProfile.optimalTemperature;
  const adjustment = taskTemp[taskType] ?? 0;
  return Math.max(0, Math.min(1, base + adjustment));
}

/**
 * Get the optimal max tokens for a model.
 */
export function getOptimalMaxTokens(modelProfile: ModelProfile, taskType: TaskType): number {
  // Reasoning models and complex tasks need more tokens
  if (modelProfile.promptStyle === 'chain-of-thought') return modelProfile.maxOutputTokens;
  if (taskType === 'architecture' || taskType === 'review') return Math.min(modelProfile.maxOutputTokens, 8_192);
  if (taskType === 'explain') return Math.min(modelProfile.maxOutputTokens, 4_096);
  return Math.min(modelProfile.maxOutputTokens, 8_192);
}

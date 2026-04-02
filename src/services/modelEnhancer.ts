// ─────────────────────────────────────────────────────────────
// Remus — Model Enhancer
// The middleware layer that makes ANY external LLM dramatically
// better. Sits between user queries and the LLM provider,
// enriching every interaction with smart context, adaptive
// prompting, and quality validation.
//
// This is what separates Remus from every other CLI tool —
// it doesn't just forward your prompt to an API.
// It makes the model THINK BETTER.
// ─────────────────────────────────────────────────────────────

import type { LLMProvider, CompletionRequest, CompletionResponse, StreamChunk, Message } from '../providers/types.js';
import { ContextEngine, type ContextChunk } from './contextEngine.js';
import {
  identifyModel,
  classifyTask,
  classifyComplexity,
  buildAdaptivePromptSection,
  getOptimalTemperature,
  getOptimalMaxTokens,
  type ModelProfile,
  type TaskType,
} from './adaptivePrompting.js';
import { QualityPipeline, type ValidationContext, type QualityReport } from './qualityPipeline.js';
import chalk from 'chalk';

// ─── Types ───

export interface ModelEnhancerConfig {
  cwd: string;
  model: string;
  provider: LLMProvider;
  enableContextInjection?: boolean;
  enableAdaptivePrompting?: boolean;
  enableQualityChecks?: boolean;
  enableAutoTemperature?: boolean;
  contextBudget?: number;    // Max tokens for injected context
  maxSelfCorrections?: number;
  verbose?: boolean;
  onEnhancement?: (info: EnhancementInfo) => void;
}

export interface EnhancementInfo {
  contextChunks: number;
  contextTokens: number;
  taskType: TaskType;
  complexity: 'simple' | 'moderate' | 'complex';
  modelFamily: string;
  temperatureAdjusted: boolean;
  qualityScore: number | null;
  selfCorrected: boolean;
  enhancementMs: number;
}

// ─── Model Enhancer ───

export class ModelEnhancer {
  private contextEngine: ContextEngine;
  private qualityPipeline: QualityPipeline;
  private modelProfile: ModelProfile;
  private config: Required<Omit<ModelEnhancerConfig, 'onEnhancement'>> & { onEnhancement?: (info: EnhancementInfo) => void };

  // Stats
  private totalEnhancements = 0;
  private totalContextTokensInjected = 0;
  private totalSelfCorrections = 0;
  private averageQualityScore = 0;

  constructor(config: ModelEnhancerConfig) {
    this.config = {
      cwd: config.cwd,
      model: config.model,
      provider: config.provider,
      enableContextInjection: config.enableContextInjection ?? true,
      enableAdaptivePrompting: config.enableAdaptivePrompting ?? true,
      enableQualityChecks: config.enableQualityChecks ?? true,
      enableAutoTemperature: config.enableAutoTemperature ?? true,
      contextBudget: config.contextBudget ?? 12_000,
      maxSelfCorrections: config.maxSelfCorrections ?? 2,
      verbose: config.verbose ?? false,
      onEnhancement: config.onEnhancement,
    };

    this.contextEngine = new ContextEngine(config.cwd, {
      maxTokens: this.config.contextBudget,
    }, this.config.verbose);

    this.qualityPipeline = new QualityPipeline({
      maxSelfCorrections: this.config.maxSelfCorrections,
      verbose: this.config.verbose,
    });

    this.modelProfile = identifyModel(config.model);

    // Index project on construction
    this.contextEngine.indexProject();
  }

  // ─── Core Enhancement Pipeline ───

  /**
   * Enhance a user query before it goes to the LLM.
   * Returns the enhanced message array with injected context.
   */
  async enhanceQuery(
    userMessage: string,
    messages: Message[],
  ): Promise<{
    messages: Message[];
    temperature: number;
    maxTokens: number;
    taskType: TaskType;
    complexity: 'simple' | 'moderate' | 'complex';
    contextChunks: ContextChunk[];
  }> {
    const start = Date.now();

    // 1. Classify the task and complexity
    const taskType = classifyTask(userMessage);
    const complexity = classifyComplexity(userMessage);

    if (this.config.verbose) {
      console.error(chalk.dim(`  [enhancer] task=${taskType} complexity=${complexity} model=${this.modelProfile.family}`));
    }

    // 2. Get smart context
    let contextChunks: ContextChunk[] = [];
    let contextInjection = '';
    if (this.config.enableContextInjection) {
      contextChunks = await this.contextEngine.getContextForQuery(userMessage);
      if (contextChunks.length > 0) {
        contextInjection = this.contextEngine.buildContextInjection(contextChunks);
        this.totalContextTokensInjected += contextChunks.reduce((sum, c) => sum + c.tokens, 0);
      }
    }

    // 3. Build adaptive prompt section
    let adaptiveSection = '';
    if (this.config.enableAdaptivePrompting) {
      adaptiveSection = buildAdaptivePromptSection({
        modelProfile: this.modelProfile,
        projectProfile: this.contextEngine.getProfile(),
        queryComplexity: complexity,
        taskType,
        hasContext: contextChunks.length > 0,
      });
    }

    // 4. Enhance the message array
    const enhancedMessages = [...messages];

    // Inject adaptive prompt into system message
    if (adaptiveSection && enhancedMessages.length > 0 && enhancedMessages[0]!.role === 'system') {
      const sysContent = typeof enhancedMessages[0]!.content === 'string' ? enhancedMessages[0]!.content : '';
      if (!sysContent.includes('# Model Guidance')) {
        enhancedMessages[0] = {
          ...enhancedMessages[0]!,
          content: sysContent + '\n\n' + adaptiveSection,
        };
      }
    }

    // Inject context into the user message (right before the actual query)
    if (contextInjection) {
      // Find the last user message and prepend context
      const lastUserIdx = enhancedMessages.length - 1;
      if (lastUserIdx >= 0 && enhancedMessages[lastUserIdx]!.role === 'user') {
        const userContent = typeof enhancedMessages[lastUserIdx]!.content === 'string'
          ? enhancedMessages[lastUserIdx]!.content
          : '';
        enhancedMessages[lastUserIdx] = {
          ...enhancedMessages[lastUserIdx]!,
          content: contextInjection + '\n' + userContent,
        };
      }
    }

    // 5. Calculate optimal parameters
    const temperature = this.config.enableAutoTemperature
      ? getOptimalTemperature(this.modelProfile, taskType)
      : 0.3;
    const maxTokens = getOptimalMaxTokens(this.modelProfile, taskType);

    this.totalEnhancements++;
    const enhancementMs = Date.now() - start;

    if (this.config.verbose) {
      console.error(chalk.dim(`  [enhancer] injected ${contextChunks.length} chunks, temp=${temperature.toFixed(2)}, ${enhancementMs}ms`));
    }

    return {
      messages: enhancedMessages,
      temperature,
      maxTokens,
      taskType,
      complexity,
      contextChunks,
    };
  }

  /**
   * Validate a response after the LLM generates it.
   * Returns quality report and optional self-correction instructions.
   */
  validateResponse(
    response: string,
    context: ValidationContext,
  ): QualityReport {
    if (!this.config.enableQualityChecks) {
      return { passed: true, checks: [], autoFixable: false, fixInstructions: null, score: 100 };
    }

    const report = this.qualityPipeline.validateResponse(response, context);

    // Update running average
    this.averageQualityScore = (this.averageQualityScore * (this.totalEnhancements - 1) + report.score) / this.totalEnhancements;

    if (this.config.verbose && !report.passed) {
      const issues = report.checks.filter(c => !c.passed);
      console.error(chalk.dim(`  [quality] score=${report.score} issues=${issues.length} fixable=${report.autoFixable}`));
    }

    return report;
  }

  /**
   * Validate tool call arguments before execution.
   */
  validateToolCall(toolName: string, args: Record<string, unknown>) {
    return this.qualityPipeline.validateToolCall(toolName, args);
  }

  /**
   * Build a self-correction prompt when quality checks fail.
   */
  buildSelfCorrectionPrompt(report: QualityReport, originalResponse: string): string {
    this.totalSelfCorrections++;
    return this.qualityPipeline.buildSelfCorrectionPrompt(report, originalResponse);
  }

  // ─── Info ───

  /**
   * Get the identified model profile.
   */
  getModelProfile(): ModelProfile {
    return this.modelProfile;
  }

  /**
   * Get enhancement statistics.
   */
  getStats() {
    const qualityStats = this.qualityPipeline.getStats();
    return {
      totalEnhancements: this.totalEnhancements,
      totalContextTokensInjected: this.totalContextTokensInjected,
      totalSelfCorrections: this.totalSelfCorrections,
      averageQualityScore: Math.round(this.averageQualityScore),
      modelFamily: this.modelProfile.family,
      modelStrengths: this.modelProfile.strengths,
      modelWeaknesses: this.modelProfile.weaknesses,
      qualityChecks: qualityStats,
    };
  }

  /**
   * Get a short one-line description of enhancements.
   */
  getEnhancementSummary(): string {
    const profile = this.modelProfile;
    const parts = [
      chalk.hex('#FF6B35')(`⬡ ${profile.family}`),
      chalk.dim(`ctx:${profile.contextWindow >= 100_000 ? `${Math.round(profile.contextWindow / 1000)}K` : `${Math.round(profile.contextWindow / 1000)}K`}`),
      profile.supportsParallelTools ? chalk.green('∥tools') : chalk.dim('→tools'),
      chalk.dim(`quality:${this.averageQualityScore || '—'}`),
    ];
    return parts.join(' ');
  }

  /**
   * Update CWD (when user changes directory).
   */
  setCwd(cwd: string): void {
    this.config.cwd = cwd;
    this.contextEngine = new ContextEngine(cwd, { maxTokens: this.config.contextBudget }, this.config.verbose);
    this.contextEngine.indexProject();
  }

  /**
   * Update model (when user switches models).
   */
  setModel(model: string): void {
    this.config.model = model;
    this.modelProfile = identifyModel(model);
  }

  /**
   * Reset correction count (start of new query).
   */
  resetCorrections(): void {
    this.qualityPipeline.resetCorrectionCount();
  }
}

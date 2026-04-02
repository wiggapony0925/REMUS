// ─────────────────────────────────────────────────────────────
// Remus — Context Engine
// Smart context selection: auto-detects relevant files, code,
// and project info from the user's query and injects it into
// the conversation — making any external model dramatically
// more effective by giving it exactly the context it needs.
// ─────────────────────────────────────────────────────────────

import { execSync } from 'child_process';
import { existsSync, readFileSync, statSync, readdirSync } from 'fs';
import { join, extname, relative, resolve, basename } from 'path';
import chalk from 'chalk';

// ─── Types ───

export interface ContextChunk {
  type: 'file' | 'snippet' | 'tree' | 'git' | 'dependency' | 'error' | 'definition';
  source: string;        // file path or source identifier
  content: string;       // the actual content
  relevance: number;     // 0-1 score
  tokens: number;        // estimated token count
  reason: string;        // why this was included
}

export interface ProjectProfile {
  language: string;          // primary language
  framework: string | null;  // react, express, django, etc.
  packageManager: string | null;
  testFramework: string | null;
  buildTool: string | null;
  entryPoint: string | null;
  srcDir: string | null;
  hasTypeScript: boolean;
  hasESLint: boolean;
  hasPrettier: boolean;
  hasDocker: boolean;
  hasCI: boolean;
  monorepo: boolean;
  dependencies: string[];    // top-level deps
}

export interface ContextBudget {
  maxTokens: number;         // total token budget for injected context
  maxFiles: number;          // max files to include
  maxSnippetLines: number;   // max lines per file snippet
}

const DEFAULT_BUDGET: ContextBudget = {
  maxTokens: 12_000,
  maxFiles: 8,
  maxSnippetLines: 150,
};

// ─── File Relevance Keywords ───

const LANG_EXTENSIONS: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java', '.rb': 'ruby',
  '.cpp': 'c++', '.c': 'c', '.cs': 'c#', '.swift': 'swift', '.kt': 'kotlin',
  '.php': 'php', '.vue': 'vue', '.svelte': 'svelte', '.dart': 'dart',
};

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv',
  'venv', 'target', '.idea', '.vscode', 'coverage', '.cache', '.turbo',
  '.output', '.nuxt', 'vendor', 'Pods', '.gradle', 'bin', 'obj',
]);

const CONFIG_FILES = new Set([
  'package.json', 'tsconfig.json', 'pyproject.toml', 'Cargo.toml',
  'go.mod', 'Gemfile', 'pom.xml', 'build.gradle', 'Makefile',
  '.eslintrc', '.eslintrc.json', '.prettierrc', 'jest.config.ts',
  'vite.config.ts', 'webpack.config.js', 'next.config.js',
  'tailwind.config.js', 'docker-compose.yml', 'Dockerfile',
]);

// ─── Context Engine ───

export class ContextEngine {
  private cwd: string;
  private budget: ContextBudget;
  private fileIndex: Map<string, { ext: string; size: number; dir: string }> = new Map();
  private projectProfile: ProjectProfile | null = null;
  private indexedAt = 0;
  private verbose: boolean;

  constructor(cwd: string, budget?: Partial<ContextBudget>, verbose = false) {
    this.cwd = cwd;
    this.budget = { ...DEFAULT_BUDGET, ...budget };
    this.verbose = verbose;
  }

  // ─── Public API ───

  /**
   * Analyze the project and build an index of all files.
   * Call this once at startup or when cwd changes.
   */
  indexProject(): void {
    this.fileIndex.clear();
    this.walkDir(this.cwd, 0, 4); // max 4 levels deep for indexing
    this.projectProfile = this.detectProjectProfile();
    this.indexedAt = Date.now();

    if (this.verbose) {
      console.error(chalk.dim(`  [context-engine] indexed ${this.fileIndex.size} files`));
    }
  }

  /**
   * Get smart context for a user query — the core value prop.
   * Analyzes the query, finds relevant files, and builds context
   * that makes ANY model dramatically more effective.
   */
  async getContextForQuery(query: string): Promise<ContextChunk[]> {
    // Re-index if stale (>60s) or never indexed
    if (Date.now() - this.indexedAt > 60_000 || this.fileIndex.size === 0) {
      this.indexProject();
    }

    const chunks: ContextChunk[] = [];
    let usedTokens = 0;

    // 1. Extract signals from the query
    const signals = this.extractQuerySignals(query);

    // 2. Project profile (always include — tiny but invaluable)
    if (this.projectProfile) {
      const profileChunk = this.buildProfileChunk();
      if (profileChunk.tokens + usedTokens <= this.budget.maxTokens) {
        chunks.push(profileChunk);
        usedTokens += profileChunk.tokens;
      }
    }

    // 3. Recently modified files (git) — most likely relevant
    if (signals.includeGitContext) {
      const gitChunks = this.getGitContext();
      for (const gc of gitChunks) {
        if (usedTokens + gc.tokens > this.budget.maxTokens) break;
        chunks.push(gc);
        usedTokens += gc.tokens;
      }
    }

    // 4. Files mentioned explicitly in the query
    const mentionedFiles = this.findMentionedFiles(query);
    for (const mf of mentionedFiles) {
      if (chunks.length >= this.budget.maxFiles) break;
      if (usedTokens + mf.tokens > this.budget.maxTokens) break;
      chunks.push(mf);
      usedTokens += mf.tokens;
    }

    // 5. Files related to keywords/concepts in the query
    const relatedFiles = this.findRelatedFiles(query, signals);
    for (const rf of relatedFiles) {
      if (chunks.length >= this.budget.maxFiles) break;
      if (usedTokens + rf.tokens > this.budget.maxTokens) break;
      // Don't double-include files
      if (chunks.some(c => c.source === rf.source)) continue;
      chunks.push(rf);
      usedTokens += rf.tokens;
    }

    // 6. Error context (if query mentions errors/bugs)
    if (signals.isErrorRelated) {
      const errorChunks = this.getErrorContext();
      for (const ec of errorChunks) {
        if (usedTokens + ec.tokens > this.budget.maxTokens) break;
        chunks.push(ec);
        usedTokens += ec.tokens;
      }
    }

    // 7. Dependency context (if query mentions packages/imports)
    if (signals.isDependencyRelated) {
      const depChunk = this.getDependencyContext();
      if (depChunk && usedTokens + depChunk.tokens <= this.budget.maxTokens) {
        chunks.push(depChunk);
        usedTokens += depChunk.tokens;
      }
    }

    // Sort by relevance (highest first)
    chunks.sort((a, b) => b.relevance - a.relevance);

    if (this.verbose) {
      console.error(chalk.dim(`  [context-engine] injecting ${chunks.length} chunks (~${usedTokens} tokens)`));
    }

    return chunks;
  }

  /**
   * Build a compact context injection string from chunks.
   * This gets prepended to the user message.
   */
  buildContextInjection(chunks: ContextChunk[]): string {
    if (chunks.length === 0) return '';

    const sections: string[] = [
      '<remus_context>',
      '<!-- Auto-injected project context to help you give better answers -->',
    ];

    for (const chunk of chunks) {
      switch (chunk.type) {
        case 'file':
        case 'snippet':
          sections.push(`\n### ${chunk.source}\n\`\`\`\n${chunk.content}\n\`\`\``);
          break;
        case 'tree':
          sections.push(`\n### Project Structure\n\`\`\`\n${chunk.content}\n\`\`\``);
          break;
        case 'git':
          sections.push(`\n### Recent Changes\n${chunk.content}`);
          break;
        case 'dependency':
          sections.push(`\n### Dependencies\n${chunk.content}`);
          break;
        case 'error':
          sections.push(`\n### Current Errors\n\`\`\`\n${chunk.content}\n\`\`\``);
          break;
        case 'definition':
          sections.push(`\n### Relevant Definitions\n\`\`\`\n${chunk.content}\n\`\`\``);
          break;
      }
    }

    sections.push('\n</remus_context>\n');
    return sections.join('\n');
  }

  /**
   * Get the project profile (cached).
   */
  getProfile(): ProjectProfile | null {
    if (!this.projectProfile) this.projectProfile = this.detectProjectProfile();
    return this.projectProfile;
  }

  // ─── Query Signal Extraction ───

  private extractQuerySignals(query: string): {
    mentionedPaths: string[];
    keywords: string[];
    isErrorRelated: boolean;
    isDependencyRelated: boolean;
    isRefactorRelated: boolean;
    isTestRelated: boolean;
    includeGitContext: boolean;
    isCreating: boolean;
  } {
    const lower = query.toLowerCase();
    const keywords = this.extractKeywords(query);

    return {
      mentionedPaths: this.extractPaths(query),
      keywords,
      isErrorRelated: /\b(error|bug|fix|broken|crash|fail|issue|wrong|doesn.?t work|exception|stack trace|TypeError|SyntaxError)\b/i.test(query),
      isDependencyRelated: /\b(package|dependency|dep|install|import|require|module|library|version|upgrade|npm|pip|cargo)\b/i.test(query),
      isRefactorRelated: /\b(refactor|rename|move|extract|reorganize|clean.?up|restructure|split|merge|combine)\b/i.test(query),
      isTestRelated: /\b(test|spec|coverage|jest|vitest|pytest|mocha|describe|it\(|expect)\b/i.test(query),
      includeGitContext: /\b(recent|change|diff|commit|modified|update|what.?changed|since|yesterday|today|push|pull|branch)\b/i.test(query),
      isCreating: /\b(create|new|add|generate|scaffold|init|build|make|write)\b/i.test(query),
    };
  }

  private extractKeywords(query: string): string[] {
    // Remove common stop words, extract meaningful terms
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those',
      'i', 'me', 'my', 'you', 'your', 'we', 'our', 'it', 'its', 'in',
      'on', 'at', 'to', 'for', 'of', 'with', 'from', 'and', 'or', 'not',
      'but', 'if', 'so', 'all', 'each', 'every', 'how', 'what', 'why',
      'please', 'help', 'want', 'need', 'make', 'like', 'just', 'also',
    ]);

    return query
      .toLowerCase()
      .replace(/[^a-z0-9_.-\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));
  }

  private extractPaths(query: string): string[] {
    const pathPattern = /(?:^|\s|["'`])([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_./-]+)(?=\s|["'`]|$)/g;
    const filePattern = /(?:^|\s|["'`])([a-zA-Z0-9_-]+\.[a-z]{1,5})(?=\s|["'`]|$)/gi;
    const paths: string[] = [];

    let match: RegExpExecArray | null;
    while ((match = pathPattern.exec(query))) paths.push(match[1]!);
    while ((match = filePattern.exec(query))) paths.push(match[1]!);

    return [...new Set(paths)];
  }

  // ─── File Finding ───

  private findMentionedFiles(query: string): ContextChunk[] {
    const paths = this.extractPaths(query);
    const chunks: ContextChunk[] = [];

    for (const p of paths) {
      // Try exact match
      const fullPath = resolve(this.cwd, p);
      if (existsSync(fullPath) && statSync(fullPath).isFile()) {
        const content = this.readFileSafe(fullPath, this.budget.maxSnippetLines);
        if (content) {
          chunks.push({
            type: 'file',
            source: relative(this.cwd, fullPath),
            content,
            relevance: 1.0,
            tokens: this.estimateTokens(content),
            reason: 'Explicitly mentioned in query',
          });
        }
        continue;
      }

      // Try fuzzy match against index
      const fileName = basename(p);
      for (const [indexPath, _info] of this.fileIndex) {
        if (basename(indexPath) === fileName || indexPath.endsWith(p)) {
          const fp = resolve(this.cwd, indexPath);
          const content = this.readFileSafe(fp, this.budget.maxSnippetLines);
          if (content) {
            chunks.push({
              type: 'file',
              source: indexPath,
              content,
              relevance: 0.95,
              tokens: this.estimateTokens(content),
              reason: `Matched filename "${fileName}" from query`,
            });
          }
          break; // Only include first match per path
        }
      }
    }

    return chunks;
  }

  private findRelatedFiles(query: string, signals: ReturnType<ContextEngine['extractQuerySignals']>): ContextChunk[] {
    const keywords = signals.keywords;
    if (keywords.length === 0) return [];

    // Score every indexed file by keyword relevance
    const scored: Array<{ path: string; score: number; reasons: string[] }> = [];

    for (const [filePath, info] of this.fileIndex) {
      let score = 0;
      const reasons: string[] = [];
      const lowerPath = filePath.toLowerCase();
      const fileName = basename(filePath).toLowerCase();

      for (const kw of keywords) {
        // Path match (strong signal)
        if (lowerPath.includes(kw)) {
          score += 0.4;
          reasons.push(`path contains "${kw}"`);
        }
        // Filename match (strongest signal)
        if (fileName.includes(kw)) {
          score += 0.6;
          reasons.push(`filename contains "${kw}"`);
        }
      }

      // Boost config files if the query seems meta
      if (CONFIG_FILES.has(basename(filePath)) && signals.isDependencyRelated) {
        score += 0.3;
        reasons.push('config file relevant to dependency query');
      }

      // Boost test files for test-related queries
      if (signals.isTestRelated && /\.(test|spec)\./i.test(filePath)) {
        score += 0.3;
        reasons.push('test file relevant to test query');
      }

      // Penalize very large files
      if (info.size > 50_000) score *= 0.5;

      if (score > 0.2) {
        scored.push({ path: filePath, score: Math.min(score, 1), reasons });
      }
    }

    // Sort by score, take top N
    scored.sort((a, b) => b.score - a.score);
    const topFiles = scored.slice(0, 5);

    const chunks: ContextChunk[] = [];
    for (const { path, score, reasons } of topFiles) {
      const fullPath = resolve(this.cwd, path);
      const content = this.readFileSafe(fullPath, this.budget.maxSnippetLines);
      if (content) {
        chunks.push({
          type: 'snippet',
          source: path,
          content,
          relevance: score * 0.8, // Slightly lower than explicit mentions
          tokens: this.estimateTokens(content),
          reason: reasons.join('; '),
        });
      }
    }

    return chunks;
  }

  // ─── Git Context ───

  private getGitContext(): ContextChunk[] {
    const chunks: ContextChunk[] = [];

    try {
      // Recent changes (modified files)
      const diff = execSync('git diff --stat HEAD 2>/dev/null || true', {
        cwd: this.cwd,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();

      if (diff) {
        chunks.push({
          type: 'git',
          source: 'git diff --stat',
          content: diff,
          relevance: 0.7,
          tokens: this.estimateTokens(diff),
          reason: 'Current uncommitted changes',
        });
      }

      // Recent commit messages (for context)
      const log = execSync('git log --oneline -10 2>/dev/null || true', {
        cwd: this.cwd,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();

      if (log) {
        chunks.push({
          type: 'git',
          source: 'git log --oneline -10',
          content: log,
          relevance: 0.5,
          tokens: this.estimateTokens(log),
          reason: 'Recent commit history',
        });
      }
    } catch {
      // Not a git repo — that's fine
    }

    return chunks;
  }

  // ─── Error Context ───

  private getErrorContext(): ContextChunk[] {
    const chunks: ContextChunk[] = [];

    // Try to get TypeScript errors
    try {
      const output = execSync('npx tsc --noEmit --pretty false 2>&1 | head -30', {
        cwd: this.cwd,
        encoding: 'utf-8',
        timeout: 15000,
      }).trim();

      if (output && output.includes('error TS')) {
        chunks.push({
          type: 'error',
          source: 'tsc --noEmit',
          content: output,
          relevance: 0.9,
          tokens: this.estimateTokens(output),
          reason: 'Current TypeScript compilation errors',
        });
      }
    } catch (e) {
      const output = (e as { stdout?: string }).stdout ?? '';
      if (output && output.includes('error TS')) {
        chunks.push({
          type: 'error',
          source: 'tsc --noEmit',
          content: output.slice(0, 3000),
          relevance: 0.9,
          tokens: this.estimateTokens(output.slice(0, 3000)),
          reason: 'Current TypeScript compilation errors',
        });
      }
    }

    return chunks;
  }

  // ─── Dependency Context ───

  private getDependencyContext(): ContextChunk | null {
    // package.json
    const pkgPath = join(this.cwd, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const raw = readFileSync(pkgPath, 'utf-8');
        const pkg = JSON.parse(raw);
        const deps = Object.keys(pkg.dependencies ?? {});
        const devDeps = Object.keys(pkg.devDependencies ?? {});
        const scripts = Object.entries(pkg.scripts ?? {});

        const content = [
          `Name: ${pkg.name ?? 'unknown'}`,
          `Version: ${pkg.version ?? '?'}`,
          deps.length > 0 ? `Dependencies: ${deps.join(', ')}` : null,
          devDeps.length > 0 ? `Dev Dependencies: ${devDeps.join(', ')}` : null,
          scripts.length > 0 ? `Scripts:\n${scripts.map(([k, v]) => `  ${k}: ${v}`).join('\n')}` : null,
        ].filter(Boolean).join('\n');

        return {
          type: 'dependency',
          source: 'package.json',
          content,
          relevance: 0.6,
          tokens: this.estimateTokens(content),
          reason: 'Project dependencies and scripts',
        };
      } catch { /* ignore parse errors */ }
    }

    // pyproject.toml / requirements.txt
    const pyproject = join(this.cwd, 'pyproject.toml');
    if (existsSync(pyproject)) {
      const content = this.readFileSafe(pyproject, 50);
      if (content) {
        return {
          type: 'dependency',
          source: 'pyproject.toml',
          content,
          relevance: 0.6,
          tokens: this.estimateTokens(content),
          reason: 'Python project configuration',
        };
      }
    }

    return null;
  }

  // ─── Project Profile Detection ───

  private detectProjectProfile(): ProjectProfile {
    const profile: ProjectProfile = {
      language: 'unknown',
      framework: null,
      packageManager: null,
      testFramework: null,
      buildTool: null,
      entryPoint: null,
      srcDir: null,
      hasTypeScript: false,
      hasESLint: false,
      hasPrettier: false,
      hasDocker: false,
      hasCI: false,
      monorepo: false,
      dependencies: [],
    };

    // Detect primary language by file count
    const langCounts: Record<string, number> = {};
    for (const [, info] of this.fileIndex) {
      const lang = LANG_EXTENSIONS[info.ext];
      if (lang) langCounts[lang] = (langCounts[lang] ?? 0) + 1;
    }
    const sorted = Object.entries(langCounts).sort(([, a], [, b]) => b - a);
    if (sorted.length > 0) profile.language = sorted[0]![0];

    // TypeScript detection
    profile.hasTypeScript = existsSync(join(this.cwd, 'tsconfig.json'));

    // Package manager
    if (existsSync(join(this.cwd, 'pnpm-lock.yaml'))) profile.packageManager = 'pnpm';
    else if (existsSync(join(this.cwd, 'yarn.lock'))) profile.packageManager = 'yarn';
    else if (existsSync(join(this.cwd, 'bun.lockb'))) profile.packageManager = 'bun';
    else if (existsSync(join(this.cwd, 'package-lock.json'))) profile.packageManager = 'npm';
    else if (existsSync(join(this.cwd, 'Pipfile.lock'))) profile.packageManager = 'pipenv';
    else if (existsSync(join(this.cwd, 'poetry.lock'))) profile.packageManager = 'poetry';

    // Parse package.json for framework/deps detection
    try {
      const pkg = JSON.parse(readFileSync(join(this.cwd, 'package.json'), 'utf-8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      profile.dependencies = Object.keys(allDeps).slice(0, 30);

      // Framework detection
      if (allDeps['next']) profile.framework = 'Next.js';
      else if (allDeps['nuxt']) profile.framework = 'Nuxt';
      else if (allDeps['@angular/core']) profile.framework = 'Angular';
      else if (allDeps['svelte'] || allDeps['@sveltejs/kit']) profile.framework = 'Svelte/SvelteKit';
      else if (allDeps['vue']) profile.framework = 'Vue';
      else if (allDeps['react']) profile.framework = allDeps['react-native'] ? 'React Native' : 'React';
      else if (allDeps['express']) profile.framework = 'Express';
      else if (allDeps['fastify']) profile.framework = 'Fastify';
      else if (allDeps['hono']) profile.framework = 'Hono';
      else if (allDeps['@nestjs/core']) profile.framework = 'NestJS';

      // Test framework
      if (allDeps['vitest']) profile.testFramework = 'vitest';
      else if (allDeps['jest']) profile.testFramework = 'jest';
      else if (allDeps['mocha']) profile.testFramework = 'mocha';
      else if (allDeps['playwright'] || allDeps['@playwright/test']) profile.testFramework = 'playwright';

      // Build tool
      if (allDeps['vite']) profile.buildTool = 'vite';
      else if (allDeps['webpack']) profile.buildTool = 'webpack';
      else if (allDeps['esbuild']) profile.buildTool = 'esbuild';
      else if (allDeps['rollup']) profile.buildTool = 'rollup';
      else if (allDeps['turbo']) profile.buildTool = 'turbo';

      // Entry point
      profile.entryPoint = pkg.main ?? pkg.module ?? null;

      // Monorepo
      profile.monorepo = !!(pkg.workspaces || allDeps['lerna'] || allDeps['turborepo']);
    } catch { /* no package.json */ }

    // Src directory
    if (existsSync(join(this.cwd, 'src'))) profile.srcDir = 'src';
    else if (existsSync(join(this.cwd, 'lib'))) profile.srcDir = 'lib';
    else if (existsSync(join(this.cwd, 'app'))) profile.srcDir = 'app';

    // Tooling
    profile.hasESLint = existsSync(join(this.cwd, '.eslintrc')) ||
      existsSync(join(this.cwd, '.eslintrc.json')) ||
      existsSync(join(this.cwd, '.eslintrc.js')) ||
      existsSync(join(this.cwd, 'eslint.config.js'));
    profile.hasPrettier = existsSync(join(this.cwd, '.prettierrc')) ||
      existsSync(join(this.cwd, '.prettierrc.json'));
    profile.hasDocker = existsSync(join(this.cwd, 'Dockerfile')) ||
      existsSync(join(this.cwd, 'docker-compose.yml'));
    profile.hasCI = existsSync(join(this.cwd, '.github/workflows')) ||
      existsSync(join(this.cwd, '.gitlab-ci.yml')) ||
      existsSync(join(this.cwd, '.circleci'));

    return profile;
  }

  private buildProfileChunk(): ContextChunk {
    const p = this.projectProfile!;
    const lines = [
      `Language: ${p.language}${p.hasTypeScript ? ' (TypeScript)' : ''}`,
      p.framework ? `Framework: ${p.framework}` : null,
      p.packageManager ? `Package Manager: ${p.packageManager}` : null,
      p.testFramework ? `Test Framework: ${p.testFramework}` : null,
      p.buildTool ? `Build Tool: ${p.buildTool}` : null,
      p.srcDir ? `Src Dir: ${p.srcDir}/` : null,
      p.entryPoint ? `Entry Point: ${p.entryPoint}` : null,
      p.monorepo ? `Monorepo: yes` : null,
      p.hasESLint ? `Linter: ESLint` : null,
      p.hasPrettier ? `Formatter: Prettier` : null,
      p.hasDocker ? `Docker: yes` : null,
      p.hasCI ? `CI/CD: yes` : null,
      `Files indexed: ${this.fileIndex.size}`,
    ].filter(Boolean);

    const content = lines.join('\n');
    return {
      type: 'tree',
      source: 'project-profile',
      content,
      relevance: 0.6,
      tokens: this.estimateTokens(content),
      reason: 'Project profile for model awareness',
    };
  }

  // ─── Helper Methods ───

  private walkDir(dir: string, depth: number, maxDepth: number): void {
    if (depth > maxDepth) return;

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith('.') && depth > 0) continue;

        const fullPath = join(dir, entry.name);
        const relPath = relative(this.cwd, fullPath);

        if (entry.isDirectory()) {
          this.walkDir(fullPath, depth + 1, maxDepth);
        } else if (entry.isFile()) {
          try {
            const stat = statSync(fullPath);
            if (stat.size > 500_000) continue; // Skip files > 500KB
            this.fileIndex.set(relPath, {
              ext: extname(entry.name).toLowerCase(),
              size: stat.size,
              dir: relative(this.cwd, dir),
            });
          } catch { /* skip unreadable files */ }
        }
      }
    } catch { /* skip unreadable directories */ }
  }

  private readFileSafe(filePath: string, maxLines: number): string | null {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      if (lines.length > maxLines) {
        return lines.slice(0, maxLines).join('\n') + `\n... (${lines.length - maxLines} more lines)`;
      }
      return content;
    } catch {
      return null;
    }
  }

  private estimateTokens(text: string): number {
    // ~4 chars per token (conservative)
    return Math.ceil(text.length / 4);
  }
}

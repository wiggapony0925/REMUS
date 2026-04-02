// ─────────────────────────────────────────────────────────────
// Remus — Test Generator
// Analyzes any source file and generates a full test suite
// matching the project's test framework. One command.
// ─────────────────────────────────────────────────────────────

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join, dirname, basename, extname, relative } from 'path';
import chalk from 'chalk';
import type { LLMProvider, Message } from '../providers/types.js';

export interface TestGenConfig {
  /** Provider to use for generation */
  provider: LLMProvider;
  /** Model name */
  model: string;
  /** Working directory */
  cwd: string;
  /** Override test framework (auto-detected if not set) */
  framework?: TestFramework;
  /** Where to put test files */
  testDir?: string;
  /** Naming convention for test files */
  namingPattern?: 'suffix' | 'dir';  // file.test.ts or __tests__/file.ts
}

export type TestFramework = 'jest' | 'vitest' | 'mocha' | 'pytest' | 'unittest' | 'go-test' | 'cargo-test' | 'unknown';

export interface TestGenResult {
  /** Source file that was analyzed */
  sourceFile: string;
  /** Generated test file path */
  testFilePath: string;
  /** Generated test content */
  testContent: string;
  /** Detected framework */
  framework: TestFramework;
  /** Number of test cases generated */
  testCount: number;
  /** Exports/functions that were tested */
  testedItems: string[];
  /** Whether the file was written to disk */
  written: boolean;
  /** Generation time in ms */
  durationMs: number;
}

/**
 * Generate tests for a source file.
 */
export async function generateTests(
  sourceFilePath: string,
  config: TestGenConfig,
): Promise<TestGenResult> {
  const startTime = Date.now();

  // Resolve paths
  const absPath = sourceFilePath.startsWith('/')
    ? sourceFilePath
    : join(config.cwd, sourceFilePath);

  if (!existsSync(absPath)) {
    throw new Error(`File not found: ${sourceFilePath}`);
  }

  const sourceContent = readFileSync(absPath, 'utf-8');
  const ext = extname(absPath);
  const lang = detectLanguage(ext);

  // Detect test framework
  const framework = config.framework ?? detectTestFramework(config.cwd, lang);

  // Analyze exports
  const exports = analyzeExports(sourceContent, lang);

  // Determine test file path
  const testFilePath = getTestFilePath(absPath, config, framework, lang);

  // Check for existing tests
  const existingTests = existsSync(testFilePath)
    ? readFileSync(testFilePath, 'utf-8')
    : null;

  // Generate tests using LLM
  const testContent = await generateTestContent(
    sourceContent,
    absPath,
    exports,
    framework,
    lang,
    existingTests,
    config,
  );

  // Count test cases
  const testCount = countTestCases(testContent, framework, lang);

  // Write to disk
  writeFileSync(testFilePath, testContent, 'utf-8');

  return {
    sourceFile: relative(config.cwd, absPath),
    testFilePath: relative(config.cwd, testFilePath),
    testContent,
    framework,
    testCount,
    testedItems: exports,
    written: true,
    durationMs: Date.now() - startTime,
  };
}

// ─── Language Detection ───

type Language = 'typescript' | 'javascript' | 'python' | 'go' | 'rust' | 'java' | 'unknown';

function detectLanguage(ext: string): Language {
  switch (ext) {
    case '.ts': case '.tsx': return 'typescript';
    case '.js': case '.jsx': case '.mjs': case '.cjs': return 'javascript';
    case '.py': return 'python';
    case '.go': return 'go';
    case '.rs': return 'rust';
    case '.java': return 'java';
    default: return 'unknown';
  }
}

// ─── Framework Detection ───

function detectTestFramework(cwd: string, lang: Language): TestFramework {
  if (lang === 'python') {
    if (existsSync(join(cwd, 'pytest.ini')) || existsSync(join(cwd, 'conftest.py'))) return 'pytest';
    // Check pyproject.toml for pytest
    try {
      const pyproject = readFileSync(join(cwd, 'pyproject.toml'), 'utf-8');
      if (pyproject.includes('pytest')) return 'pytest';
    } catch { /* no pyproject */ }
    return 'pytest'; // Default for Python
  }

  if (lang === 'go') return 'go-test';
  if (lang === 'rust') return 'cargo-test';

  // JavaScript/TypeScript: check package.json
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (allDeps.vitest) return 'vitest';
    if (allDeps.jest || allDeps['@jest/core'] || allDeps['ts-jest']) return 'jest';
    if (allDeps.mocha) return 'mocha';

    // Check scripts
    const scripts = pkg.scripts ?? {};
    const testScript = scripts.test ?? '';
    if (testScript.includes('vitest')) return 'vitest';
    if (testScript.includes('jest')) return 'jest';
    if (testScript.includes('mocha')) return 'mocha';
  } catch { /* no package.json */ }

  return 'vitest'; // Default for TS/JS
}

// ─── Export Analysis ───

function analyzeExports(content: string, lang: Language): string[] {
  const exports: string[] = [];

  if (lang === 'typescript' || lang === 'javascript') {
    // Named exports
    const namedExport = /export\s+(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+(\w+)/g;
    let m;
    while ((m = namedExport.exec(content)) !== null) {
      exports.push(m[1]!);
    }

    // Default export
    if (/export\s+default/.test(content)) {
      const defaultMatch = content.match(/export\s+default\s+(?:function|class)\s+(\w+)/);
      if (defaultMatch) exports.push(defaultMatch[1]!);
      else exports.push('default');
    }
  }

  if (lang === 'python') {
    // Functions
    const funcRegex = /^def\s+(\w+)\s*\(/gm;
    let m;
    while ((m = funcRegex.exec(content)) !== null) {
      if (!m[1]!.startsWith('_')) exports.push(m[1]!);
    }

    // Classes
    const classRegex = /^class\s+(\w+)/gm;
    while ((m = classRegex.exec(content)) !== null) {
      if (!m[1]!.startsWith('_')) exports.push(m[1]!);
    }
  }

  if (lang === 'go') {
    // Exported functions (capitalized)
    const funcRegex = /^func\s+(?:\(.*?\)\s+)?([A-Z]\w+)/gm;
    let m;
    while ((m = funcRegex.exec(content)) !== null) {
      exports.push(m[1]!);
    }
  }

  return exports;
}

// ─── Test File Path ───

function getTestFilePath(
  sourceFile: string,
  config: TestGenConfig,
  framework: TestFramework,
  lang: Language,
): string {
  const dir = dirname(sourceFile);
  const base = basename(sourceFile, extname(sourceFile));
  const ext = extname(sourceFile);

  if (lang === 'go') {
    return join(dir, `${base}_test.go`);
  }

  if (lang === 'rust') {
    // Rust tests go in the same file or in tests/ dir
    return join(dirname(dir), 'tests', `${base}.rs`);
  }

  if (lang === 'python') {
    const testDir = config.testDir ?? 'tests';
    return join(config.cwd, testDir, `test_${base}.py`);
  }

  // TypeScript/JavaScript
  const pattern = config.namingPattern ?? 'suffix';

  if (pattern === 'dir') {
    return join(dir, '__tests__', `${base}${ext}`);
  }

  // Suffix pattern
  const testExt = ext === '.tsx' ? '.test.tsx' : ext === '.jsx' ? '.test.jsx' : `.test${ext}`;
  return join(dir, `${base}${testExt}`);
}

// ─── LLM Test Generation ───

async function generateTestContent(
  sourceContent: string,
  sourceFile: string,
  exports: string[],
  framework: TestFramework,
  lang: Language,
  existingTests: string | null,
  config: TestGenConfig,
): Promise<string> {
  const relPath = relative(config.cwd, sourceFile);

  const systemPrompt = `You are an expert test engineer. Generate comprehensive, high-quality tests.

Rules:
- Test all exported functions/classes/components
- Include edge cases, error cases, and happy paths
- Use the project's testing framework
- Follow the project's code style
- Tests should be immediately runnable
- Use descriptive test names
- Mock external dependencies appropriately
- Output ONLY the test file content, no explanations or markdown wrapping`;

  const frameworkGuide = getFrameworkGuide(framework, lang);

  let userPrompt = `Generate a complete test file for: ${relPath}

Source code:
\`\`\`${lang}
${sourceContent}
\`\`\`

Exports to test: ${exports.join(', ')}
Test framework: ${framework}
${frameworkGuide}`;

  if (existingTests) {
    userPrompt += `\n\nExisting tests (extend, don't duplicate):\n\`\`\`${lang}\n${existingTests}\n\`\`\``;
  }

  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const response = await config.provider.complete({
    messages,
    temperature: 0.3,
    maxTokens: 4096,
    model: config.model,
  });

  let content = typeof response.message.content === 'string'
    ? response.message.content
    : response.message.content.map(b => b.text ?? '').join('');

  // Strip markdown code fences if the model wrapped them
  content = content.replace(/^```[\w]*\n/, '').replace(/\n```\s*$/, '');

  return content;
}

function getFrameworkGuide(framework: TestFramework, lang: Language): string {
  switch (framework) {
    case 'jest':
      return `
Use Jest patterns:
- import with: import { x } from '../file'
- describe('ModuleName', () => { ... })
- it('should ...', () => { ... })
- expect(x).toBe(y), toEqual, toThrow, etc.
- jest.fn() for mocks, jest.mock() for modules`;

    case 'vitest':
      return `
Use Vitest patterns:
- import with: import { describe, it, expect, vi } from 'vitest'
- import source with: import { x } from '../file'
- describe('ModuleName', () => { ... })
- it('should ...', () => { ... })
- expect(x).toBe(y), toEqual, toThrow, etc.
- vi.fn() for mocks, vi.mock() for modules`;

    case 'mocha':
      return `
Use Mocha + Chai patterns:
- import { expect } from 'chai'
- describe('ModuleName', () => { ... })
- it('should ...', () => { ... })
- expect(x).to.equal(y), to.throw, etc.`;

    case 'pytest':
      return `
Use Pytest patterns:
- import functions directly: from module import func
- def test_function_name():
- assert x == y
- pytest.raises(Exception) for error testing
- @pytest.fixture for fixtures
- @pytest.mark.parametrize for parametric tests`;

    case 'go-test':
      return `
Use Go testing patterns:
- package name_test
- import "testing"
- func TestFunctionName(t *testing.T) { ... }
- t.Errorf, t.Fatal for assertions
- table-driven tests with subtests (t.Run)`;

    case 'cargo-test':
      return `
Use Rust test patterns:
- #[cfg(test)] mod tests { ... }
- #[test] fn test_name() { ... }
- assert!, assert_eq!, assert_ne! macros
- #[should_panic] for error tests`;

    default:
      return '';
  }
}

// ─── Counting ───

function countTestCases(content: string, framework: TestFramework, lang: Language): number {
  switch (framework) {
    case 'jest':
    case 'vitest':
    case 'mocha':
      return (content.match(/\bit\s*\(/g) ?? []).length + (content.match(/\btest\s*\(/g) ?? []).length;

    case 'pytest':
      return (content.match(/^def\s+test_/gm) ?? []).length;

    case 'go-test':
      return (content.match(/^func\s+Test/gm) ?? []).length;

    case 'cargo-test':
      return (content.match(/#\[test\]/g) ?? []).length;

    default:
      return 0;
  }
}

/**
 * Format test generation result.
 */
export function formatTestGenResult(result: TestGenResult): string {
  const lines: string[] = [];

  lines.push(chalk.hex('#FF6B35').bold('⬡ Test Generator'));
  lines.push(chalk.dim('─'.repeat(50)));

  lines.push(`${chalk.bold('Source:')} ${chalk.white(result.sourceFile)}`);
  lines.push(`${chalk.bold('Tests:')}  ${chalk.green(result.testFilePath)}`);
  lines.push(`${chalk.bold('Framework:')} ${chalk.hex('#FF8C42')(result.framework)}`);
  lines.push(`${chalk.bold('Test cases:')} ${chalk.hex('#FF8C42')(String(result.testCount))}`);
  lines.push(`${chalk.bold('Tested:')} ${result.testedItems.join(', ')}`);
  lines.push(`${chalk.bold('Time:')} ${chalk.dim(`${result.durationMs}ms`)}`);

  if (result.written) {
    lines.push(`\n${chalk.green('✓')} Test file written to ${chalk.white(result.testFilePath)}`);
  }

  return lines.join('\n');
}

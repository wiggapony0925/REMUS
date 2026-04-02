// ─────────────────────────────────────────────────────────────
// Remus — Project Indexer Tool
// Fast codebase mapping for project understanding
// ─────────────────────────────────────────────────────────────

import { execSync } from 'child_process';
import { existsSync, readFileSync, statSync, readdirSync } from 'fs';
import { join, relative, extname } from 'path';
import { BaseTool, type ToolInput, type ToolResult, type ToolContext } from './types.js';

export class ProjectIndexTool extends BaseTool {
  name = 'project_index';
  description = 'Map the project structure, key files, dependencies, and tech stack. Use this at the start of a session to understand a codebase.';
  isReadOnly = true;

  prompt = `Scans the project directory and returns a comprehensive overview:
- Project name and type (from package.json, Cargo.toml, etc.)
- Directory tree (top-level + key subdirectories)
- Key configuration files
- Dependencies and dev dependencies
- Tech stack detection (language, framework, bundler, etc.)
- File count by extension
- Git info (branch, recent activity)

Use this tool at the beginning of a session to understand the project structure before making changes.`;

  inputSchema = {
    type: 'object' as const,
    properties: {
      depth: {
        type: 'number',
        description: 'Directory tree depth (default: 3)',
      },
      include_deps: {
        type: 'boolean',
        description: 'Include dependency list (default: true)',
      },
    },
    required: [],
    additionalProperties: false,
  };

  async call(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const depth = (input.depth as number) ?? 3;
    const includeDeps = (input.include_deps as boolean) ?? true;

    const sections: string[] = [];
    const cwd = context.cwd;

    // ─── Project Identity ───
    const identity = this.detectProjectIdentity(cwd);
    if (identity) sections.push(identity);

    // ─── Directory Tree ───
    const tree = this.getDirectoryTree(cwd, depth);
    sections.push(`## Directory Structure\n\n${tree}`);

    // ─── Tech Stack ───
    const stack = this.detectTechStack(cwd);
    if (stack) sections.push(`## Tech Stack\n\n${stack}`);

    // ─── Key Files ───
    const keyFiles = this.findKeyFiles(cwd);
    if (keyFiles) sections.push(`## Key Files\n\n${keyFiles}`);

    // ─── Dependencies ───
    if (includeDeps) {
      const deps = this.getDependencies(cwd);
      if (deps) sections.push(`## Dependencies\n\n${deps}`);
    }

    // ─── File Stats ───
    const stats = this.getFileStats(cwd);
    if (stats) sections.push(`## File Statistics\n\n${stats}`);

    // ─── Git Info ───
    const gitInfo = this.getGitInfo(cwd);
    if (gitInfo) sections.push(`## Git\n\n${gitInfo}`);

    return { output: sections.join('\n\n') };
  }

  private detectProjectIdentity(cwd: string): string | null {
    const parts: string[] = ['## Project'];

    // Node.js
    const pkgPath = join(cwd, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        parts.push(`- Name: ${pkg.name ?? 'unknown'}`);
        if (pkg.version) parts.push(`- Version: ${pkg.version}`);
        if (pkg.description) parts.push(`- Description: ${pkg.description}`);
        if (pkg.scripts) {
          const scripts = Object.entries(pkg.scripts).slice(0, 10)
            .map(([k, v]) => `  - \`${k}\`: \`${v}\``).join('\n');
          parts.push(`- Scripts:\n${scripts}`);
        }
      } catch { /* ignore */ }
    }

    // Rust
    const cargoPath = join(cwd, 'Cargo.toml');
    if (existsSync(cargoPath)) {
      try {
        const content = readFileSync(cargoPath, 'utf-8');
        const nameMatch = content.match(/name\s*=\s*"([^"]+)"/);
        if (nameMatch) parts.push(`- Name: ${nameMatch[1]} (Rust)`);
      } catch { /* ignore */ }
    }

    // Python
    const pyprojectPath = join(cwd, 'pyproject.toml');
    if (existsSync(pyprojectPath)) {
      try {
        const content = readFileSync(pyprojectPath, 'utf-8');
        const nameMatch = content.match(/name\s*=\s*"([^"]+)"/);
        if (nameMatch) parts.push(`- Name: ${nameMatch[1]} (Python)`);
      } catch { /* ignore */ }
    }

    // Go
    const goModPath = join(cwd, 'go.mod');
    if (existsSync(goModPath)) {
      try {
        const content = readFileSync(goModPath, 'utf-8');
        const moduleMatch = content.match(/module\s+(\S+)/);
        if (moduleMatch) parts.push(`- Module: ${moduleMatch[1]} (Go)`);
      } catch { /* ignore */ }
    }

    return parts.length > 1 ? parts.join('\n') : null;
  }

  private getDirectoryTree(cwd: string, maxDepth: number): string {
    try {
      // Try `tree` command first (better formatted)
      const output = execSync(`tree -L ${maxDepth} -I 'node_modules|.git|dist|build|__pycache__|.next|target|.venv|venv' --dirsfirst`, {
        cwd, encoding: 'utf-8', timeout: 10000, maxBuffer: 512 * 1024,
      }).trim();
      // Truncate if too long
      const lines = output.split('\n');
      if (lines.length > 80) {
        return lines.slice(0, 80).join('\n') + `\n... (${lines.length - 80} more entries)`;
      }
      return output;
    } catch {
      // Fallback: manual listing
      return this.manualTree(cwd, maxDepth, 0);
    }
  }

  private manualTree(dir: string, maxDepth: number, currentDepth: number): string {
    if (currentDepth >= maxDepth) return '';

    const IGNORE = new Set([
      'node_modules', '.git', 'dist', 'build', '__pycache__',
      '.next', 'target', '.venv', 'venv', '.cache', '.turbo',
      'coverage', '.nyc_output',
    ]);

    try {
      const entries = readdirSync(dir, { withFileTypes: true })
        .filter(e => !IGNORE.has(e.name) && !e.name.startsWith('.'))
        .sort((a, b) => {
          if (a.isDirectory() === b.isDirectory()) return a.name.localeCompare(b.name);
          return a.isDirectory() ? -1 : 1;
        });

      const lines: string[] = [];
      const indent = '  '.repeat(currentDepth);

      for (const entry of entries.slice(0, 30)) {
        if (entry.isDirectory()) {
          lines.push(`${indent}${entry.name}/`);
          const subtree = this.manualTree(join(dir, entry.name), maxDepth, currentDepth + 1);
          if (subtree) lines.push(subtree);
        } else {
          lines.push(`${indent}${entry.name}`);
        }
      }

      if (entries.length > 30) {
        lines.push(`${indent}... (${entries.length - 30} more)`);
      }

      return lines.join('\n');
    } catch {
      return '';
    }
  }

  private detectTechStack(cwd: string): string | null {
    const stack: string[] = [];

    const checks: Array<[string, string]> = [
      ['package.json', 'Node.js'],
      ['tsconfig.json', 'TypeScript'],
      ['Cargo.toml', 'Rust'],
      ['go.mod', 'Go'],
      ['pyproject.toml', 'Python'],
      ['requirements.txt', 'Python'],
      ['Gemfile', 'Ruby'],
      ['pom.xml', 'Java (Maven)'],
      ['build.gradle', 'Java (Gradle)'],
      ['Makefile', 'Make'],
      ['Dockerfile', 'Docker'],
      ['docker-compose.yml', 'Docker Compose'],
      ['.github/workflows', 'GitHub Actions'],
      ['next.config.js', 'Next.js'],
      ['next.config.mjs', 'Next.js'],
      ['next.config.ts', 'Next.js'],
      ['vite.config.ts', 'Vite'],
      ['webpack.config.js', 'Webpack'],
      ['tailwind.config.js', 'Tailwind CSS'],
      ['tailwind.config.ts', 'Tailwind CSS'],
      ['.eslintrc.json', 'ESLint'],
      ['eslint.config.js', 'ESLint'],
      ['.prettierrc', 'Prettier'],
      ['jest.config.js', 'Jest'],
      ['jest.config.ts', 'Jest'],
      ['vitest.config.ts', 'Vitest'],
      ['prisma/schema.prisma', 'Prisma'],
    ];

    for (const [file, tech] of checks) {
      if (existsSync(join(cwd, file))) {
        stack.push(tech);
      }
    }

    // Check package.json for frameworks
    const pkgPath = join(cwd, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        const frameworkChecks: Array<[string, string]> = [
          ['react', 'React'],
          ['vue', 'Vue.js'],
          ['svelte', 'Svelte'],
          ['angular', 'Angular'],
          ['express', 'Express'],
          ['fastify', 'Fastify'],
          ['hono', 'Hono'],
          ['drizzle-orm', 'Drizzle ORM'],
          ['@trpc/server', 'tRPC'],
          ['zod', 'Zod'],
        ];
        for (const [dep, name] of frameworkChecks) {
          if (allDeps[dep]) stack.push(name);
        }
      } catch { /* ignore */ }
    }

    return stack.length > 0 ? stack.map(s => `- ${s}`).join('\n') : null;
  }

  private findKeyFiles(cwd: string): string | null {
    const KEY_FILES = [
      'README.md', 'README.rst', 'LICENSE',
      'package.json', 'tsconfig.json',
      'Cargo.toml', 'go.mod', 'pyproject.toml',
      '.env.example', '.env.local',
      'Dockerfile', 'docker-compose.yml',
      'Makefile',
      'REMUS.md',
    ];

    const found: string[] = [];
    for (const file of KEY_FILES) {
      const fullPath = join(cwd, file);
      if (existsSync(fullPath)) {
        try {
          const stat = statSync(fullPath);
          const sizeStr = stat.size > 1024 ? `${(stat.size / 1024).toFixed(1)}KB` : `${stat.size}B`;
          found.push(`- ${file} (${sizeStr})`);
        } catch {
          found.push(`- ${file}`);
        }
      }
    }

    return found.length > 0 ? found.join('\n') : null;
  }

  private getDependencies(cwd: string): string | null {
    const pkgPath = join(cwd, 'package.json');
    if (!existsSync(pkgPath)) return null;

    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const parts: string[] = [];

      if (pkg.dependencies) {
        const deps = Object.entries(pkg.dependencies)
          .map(([k, v]) => `  ${k}: ${v}`)
          .slice(0, 25);
        parts.push(`Production (${Object.keys(pkg.dependencies).length}):\n${deps.join('\n')}`);
        if (Object.keys(pkg.dependencies).length > 25) parts.push(`  ... and ${Object.keys(pkg.dependencies).length - 25} more`);
      }

      if (pkg.devDependencies) {
        const deps = Object.entries(pkg.devDependencies)
          .map(([k, v]) => `  ${k}: ${v}`)
          .slice(0, 15);
        parts.push(`Dev (${Object.keys(pkg.devDependencies).length}):\n${deps.join('\n')}`);
        if (Object.keys(pkg.devDependencies).length > 15) parts.push(`  ... and ${Object.keys(pkg.devDependencies).length - 15} more`);
      }

      return parts.length > 0 ? parts.join('\n\n') : null;
    } catch {
      return null;
    }
  }

  private getFileStats(cwd: string): string | null {
    try {
      const output = execSync(
        `find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/build/*' -not -path '*/__pycache__/*' -not -path '*/target/*' | sed 's/.*\\.//' | sort | uniq -c | sort -rn | head -20`,
        { cwd, encoding: 'utf-8', timeout: 10000 }
      ).trim();

      if (!output) return null;

      const lines = output.split('\n').map(l => {
        const match = l.trim().match(/^(\d+)\s+(.+)$/);
        if (match) return `  .${match[2]}: ${match[1]} files`;
        return `  ${l.trim()}`;
      });

      return `File types:\n${lines.join('\n')}`;
    } catch {
      return null;
    }
  }

  private getGitInfo(cwd: string): string | null {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd, encoding: 'utf-8', timeout: 5000,
      }).trim();

      const parts: string[] = [`- Branch: ${branch}`];

      try {
        const commits = execSync('git log --oneline -5', {
          cwd, encoding: 'utf-8', timeout: 5000,
        }).trim();
        if (commits) {
          parts.push(`- Recent commits:\n${commits.split('\n').map(l => `  ${l}`).join('\n')}`);
        }
      } catch { /* ignore */ }

      try {
        const remotes = execSync('git remote -v', {
          cwd, encoding: 'utf-8', timeout: 5000,
        }).trim();
        if (remotes) {
          const firstRemote = remotes.split('\n')[0];
          parts.push(`- Remote: ${firstRemote}`);
        }
      } catch { /* ignore */ }

      return parts.join('\n');
    } catch {
      return null;
    }
  }
}

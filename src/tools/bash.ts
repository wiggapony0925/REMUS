// ─────────────────────────────────────────────────────────────
// Remus — Bash Tool
// Execute shell commands with output capture
// ─────────────────────────────────────────────────────────────

import { spawn } from 'child_process';
import { BaseTool, type ToolInput, type ToolResult, type ToolContext } from './types.js';

export class BashTool extends BaseTool {
  name = 'bash';
  description = 'Execute a shell command and return its output.';
  isReadOnly = false;

  prompt = `Executes a bash command and returns stdout/stderr.

Important guidelines:
- Use dedicated tools instead of shell equivalents when available:
  - File search: Use glob (NOT find or ls)
  - Content search: Use grep (NOT grep or rg)  
  - Read files: Use read_file (NOT cat/head/tail)
  - Edit files: Use edit_file (NOT sed/awk)
  - Write files: Use write_file (NOT echo/cat)
- Always quote file paths with double quotes
- Use absolute paths when possible
- Chain commands with && for sequential execution
- For long-running processes, consider the timeout parameter
- Never skip git hooks (--no-verify)
- Prefer git commits over destructive operations`;

  inputSchema = {
    type: 'object' as const,
    properties: {
      command: {
        type: 'string',
        description: 'The bash command to execute',
      },
      timeout: {
        type: 'number',
        description: 'Optional timeout in milliseconds (default: 120000)',
      },
      description: {
        type: 'string',
        description: 'Brief description of what this command does',
      },
    },
    required: ['command'],
    additionalProperties: false,
  };

  async call(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const command = input.command as string;
    const timeout = (input.timeout as number) ?? 120_000;

    return new Promise<ToolResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let killed = false;

      const proc = spawn('bash', ['-c', command], {
        cwd: context.cwd,
        env: { ...process.env, TERM: 'dumb' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timer = setTimeout(() => {
        killed = true;
        proc.kill('SIGTERM');
        setTimeout(() => proc.kill('SIGKILL'), 2000);
      }, timeout);

      proc.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        stdout += text;
        context.onProgress?.(text);
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timer);

        // Truncate very large output
        const maxOutput = 100_000;
        if (stdout.length > maxOutput) {
          stdout = stdout.slice(0, maxOutput / 2) +
            `\n\n... [${stdout.length - maxOutput} bytes truncated] ...\n\n` +
            stdout.slice(-maxOutput / 2);
        }

        const parts: string[] = [];
        if (stdout.trim()) parts.push(stdout.trim());
        if (stderr.trim()) parts.push(`[stderr]\n${stderr.trim()}`);
        if (killed) parts.push('[Command timed out and was terminated]');
        if (code !== 0 && code !== null) parts.push(`[Exit code: ${code}]`);

        resolve({
          output: parts.join('\n\n') || '(no output)',
          isError: code !== 0 && code !== null,
          error: code !== 0 ? `Command exited with code ${code}` : undefined,
          metadata: { exitCode: code, killed, command },
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          output: `Failed to execute command: ${err.message}`,
          isError: true,
          error: err.message,
        });
      });

      // Handle abort signal
      if (context.abortSignal) {
        context.abortSignal.addEventListener('abort', () => {
          killed = true;
          proc.kill('SIGTERM');
          clearTimeout(timer);
        });
      }
    });
  }
}

// ─────────────────────────────────────────────────────────────
// Remus — File Read Tool
// Read files with line range support, image handling, etc.
// ─────────────────────────────────────────────────────────────

import { readFileSync, statSync, existsSync } from 'fs';
import { resolve, extname, relative } from 'path';
import { BaseTool, type ToolInput, type ToolResult, type ToolContext } from './types.js';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);
const BINARY_EXTENSIONS = new Set([
  '.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.a',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.wasm', '.class', '.pyc',
]);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_LINE_LIMIT = 2000;

export class FileReadTool extends BaseTool {
  name = 'read_file';
  description = 'Read a file from the filesystem. Supports text files, images, and line ranges.';
  isReadOnly = true;

  prompt = `Reads a file from the local filesystem.

Usage:
- file_path must be an absolute path
- By default reads up to ${DEFAULT_LINE_LIMIT} lines from the start
- Use offset and limit for large files
- Results include line numbers (cat -n format)
- Supports images (PNG, JPG, GIF, WEBP) — returns base64
- Cannot read directories — use bash with ls for that
- If a file was already read and hasn't changed, returns a stub to save tokens`;

  inputSchema = {
    type: 'object' as const,
    properties: {
      file_path: {
        type: 'string',
        description: 'Absolute path to the file to read',
      },
      offset: {
        type: 'number',
        description: 'Line number to start reading from (0-indexed). Use for large files.',
      },
      limit: {
        type: 'number',
        description: 'Number of lines to read. Default: 2000.',
      },
    },
    required: ['file_path'],
    additionalProperties: false,
  };

  async call(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const rawPath = input.file_path as string;
    const offset = (input.offset as number) ?? 0;
    const limit = (input.limit as number) ?? DEFAULT_LINE_LIMIT;

    // Resolve to absolute path
    const filePath = resolve(context.cwd, rawPath);

    // Check existence
    if (!existsSync(filePath)) {
      // Try to find similar files
      return {
        output: `File not found: ${filePath}\nVerify the path is correct and the file exists.`,
        isError: true,
        error: 'ENOENT',
      };
    }

    const stat = statSync(filePath);

    if (stat.isDirectory()) {
      return {
        output: `"${filePath}" is a directory, not a file. Use bash with "ls" to list directory contents.`,
        isError: true,
        error: 'EISDIR',
      };
    }

    const ext = extname(filePath).toLowerCase();

    // Binary check
    if (BINARY_EXTENSIONS.has(ext)) {
      return {
        output: `Cannot read binary file: ${filePath} (${ext})`,
        isError: true,
        error: 'BINARY',
      };
    }

    // Image handling
    if (IMAGE_EXTENSIONS.has(ext)) {
      if (stat.size > MAX_FILE_SIZE) {
        return {
          output: `Image too large: ${filePath} (${(stat.size / 1024 / 1024).toFixed(1)}MB, max ${MAX_FILE_SIZE / 1024 / 1024}MB)`,
          isError: true,
          error: 'TOO_LARGE',
        };
      }
      const data = readFileSync(filePath);
      const base64 = data.toString('base64');
      const mimeType = ext === '.png' ? 'image/png'
        : ext === '.svg' ? 'image/svg+xml'
        : ext === '.gif' ? 'image/gif'
        : ext === '.webp' ? 'image/webp'
        : 'image/jpeg';

      return {
        output: `[Image: ${relative(context.cwd, filePath)} (${(stat.size / 1024).toFixed(1)}KB, ${mimeType})]`,
        metadata: {
          type: 'image',
          base64,
          mimeType,
          filePath: relative(context.cwd, filePath),
          size: stat.size,
        },
      };
    }

    // Size guard
    if (stat.size > MAX_FILE_SIZE) {
      return {
        output: `File too large: ${filePath} (${(stat.size / 1024 / 1024).toFixed(1)}MB). Use offset/limit to read portions.`,
        isError: true,
        error: 'TOO_LARGE',
      };
    }

    // Dedup check: if file hasn't changed since last read, return stub
    const cached = context.readFiles.get(filePath);
    if (cached && cached.mtime === stat.mtimeMs && offset === 0 && limit >= DEFAULT_LINE_LIMIT) {
      return {
        output: `[File already read and unchanged: ${relative(context.cwd, filePath)}]`,
        metadata: { type: 'file_unchanged', filePath: relative(context.cwd, filePath) },
      };
    }

    // Read text file
    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const totalLines = lines.length;
      const sliced = lines.slice(offset, offset + limit);

      // Format with line numbers (cat -n style)
      const numbered = sliced.map((line, i) => {
        const lineNum = offset + i + 1;
        return `${String(lineNum).padStart(6, ' ')}\t${line}`;
      }).join('\n');

      // Update read cache
      context.readFiles.set(filePath, { content, mtime: stat.mtimeMs });

      const relPath = relative(context.cwd, filePath);
      let header = `File: ${relPath}`;
      if (offset > 0 || offset + limit < totalLines) {
        header += ` (lines ${offset + 1}-${Math.min(offset + limit, totalLines)} of ${totalLines})`;
      } else {
        header += ` (${totalLines} lines)`;
      }

      const output = `${header}\n${'─'.repeat(60)}\n${numbered}`;

      return {
        output,
        metadata: {
          type: 'text',
          filePath: relPath,
          totalLines,
          startLine: offset + 1,
          endLine: Math.min(offset + limit, totalLines),
        },
      };
    } catch (err) {
      return {
        output: `Error reading file: ${(err as Error).message}`,
        isError: true,
        error: (err as Error).message,
      };
    }
  }
}

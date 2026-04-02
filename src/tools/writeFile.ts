// ─────────────────────────────────────────────────────────────
// Remus — File Write Tool
// Create new files or overwrite existing ones
// ─────────────────────────────────────────────────────────────

import { writeFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'fs';
import { resolve, dirname, relative } from 'path';
import { BaseTool, type ToolInput, type ToolResult, type ToolContext } from './types.js';

export class FileWriteTool extends BaseTool {
  name = 'write_file';
  description = 'Write content to a file, creating it if it doesn\'t exist or overwriting if it does.';
  isReadOnly = false;

  prompt = `Writes a file to the local filesystem.

Usage:
- Overwrites existing files completely
- If the file already exists, you MUST read it first with read_file
- Creates parent directories as needed
- Prefer edit_file for modifying existing files (sends only the diff)
- Only use write_file for new files or complete rewrites
- file_path must be absolute`;

  inputSchema = {
    type: 'object' as const,
    properties: {
      file_path: {
        type: 'string',
        description: 'Absolute path to the file to write',
      },
      content: {
        type: 'string',
        description: 'The complete content to write to the file',
      },
    },
    required: ['file_path', 'content'],
    additionalProperties: false,
  };

  async call(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const rawPath = input.file_path as string;
    const content = input.content as string;

    const filePath = resolve(context.cwd, rawPath);
    const relPath = relative(context.cwd, filePath);
    const fileExists = existsSync(filePath);

    // If file exists, must have been read
    if (fileExists && !context.readFiles.has(filePath)) {
      return {
        output: `File "${relPath}" already exists. You must read it first with read_file before overwriting.`,
        isError: true,
        error: 'NOT_READ',
      };
    }

    try {
      // Ensure directory exists
      mkdirSync(dirname(filePath), { recursive: true });

      // Read old content for diff stats
      let oldLineCount = 0;
      if (fileExists) {
        try {
          const oldContent = readFileSync(filePath, 'utf-8');
          oldLineCount = oldContent.split('\n').length;
        } catch { /* ignore */ }
      }

      writeFileSync(filePath, content, 'utf-8');

      const stat = statSync(filePath);
      context.readFiles.set(filePath, { content, mtime: stat.mtimeMs });

      const newLineCount = content.split('\n').length;
      const type = fileExists ? 'update' : 'create';
      const sizeKB = (Buffer.byteLength(content, 'utf-8') / 1024).toFixed(1);

      let summary: string;
      if (type === 'create') {
        summary = `Created: ${relPath} (${newLineCount} lines, ${sizeKB}KB)`;
      } else {
        summary = `Updated: ${relPath} (${oldLineCount} → ${newLineCount} lines, ${sizeKB}KB)`;
      }

      return {
        output: summary,
        metadata: {
          type,
          filePath: relPath,
          linesAdded: newLineCount,
          linesRemoved: oldLineCount,
          size: Buffer.byteLength(content, 'utf-8'),
        },
      };
    } catch (err) {
      return {
        output: `Error writing file: ${(err as Error).message}`,
        isError: true,
        error: (err as Error).message,
      };
    }
  }
}

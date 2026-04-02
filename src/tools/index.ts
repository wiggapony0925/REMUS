// ─────────────────────────────────────────────────────────────
// Remus — Tool Registry (v2)
// 19 built-in tools + plugin tools — the most powerful tool
// system in any AI coding assistant
// ─────────────────────────────────────────────────────────────

import type { Tool, ToolContext } from './types.js';
import type { ToolDefinition } from '../providers/types.js';
import { BashTool } from './bash.js';
import { FileReadTool } from './readFile.js';
import { FileEditTool } from './editFile.js';
import { FileWriteTool } from './writeFile.js';
import { GrepTool } from './grep.js';
import { GlobTool } from './glob.js';
import { WebFetchTool } from './webFetch.js';
import { ListDirTool } from './listDir.js';
import { GitDiffTool } from './gitDiff.js';
import { GitStatusTool } from './gitStatus.js';
import { GitCommitTool } from './gitCommit.js';
import { GitLogTool } from './gitLog.js';
import { ProjectIndexTool } from './projectIndex.js';
// v2 tools
import { SearchReplaceTool } from './searchReplace.js';
import { RenameSymbolTool } from './renameSymbol.js';
import { NotifyTool, TreeTool, CheckHealthTool } from './advanced.js';

export function createToolPool(): Tool[] {
  return [
    // Core file operations
    new BashTool(),
    new FileReadTool(),
    new FileEditTool(),
    new FileWriteTool(),
    new GrepTool(),
    new GlobTool(),
    new ListDirTool(),
    new TreeTool(),
    // Web
    new WebFetchTool(),
    // Git
    new GitDiffTool(),
    new GitStatusTool(),
    new GitCommitTool(),
    new GitLogTool(),
    // Codebase intelligence
    new ProjectIndexTool(),
    new SearchReplaceTool(),
    new RenameSymbolTool(),
    // Utility
    new NotifyTool(),
    new CheckHealthTool(),
  ];
}

export function getToolDefinitions(tools: Tool[]): ToolDefinition[] {
  return tools.map(t => t.toDefinition());
}

export function findTool(tools: Tool[], name: string): Tool | undefined {
  return tools.find(t => t.name === name);
}

export function createToolContext(cwd: string, readFiles?: Map<string, { content: string; mtime: number }>): ToolContext {
  return {
    cwd,
    readFiles: readFiles ?? new Map(),
  };
}

export { type Tool, type ToolResult, type ToolContext, type ToolInput } from './types.js';

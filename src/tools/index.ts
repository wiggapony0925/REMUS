// ─────────────────────────────────────────────────────────────
// Remus — Tool Registry
// Assembles all tools and exports the pool
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

export function createToolPool(): Tool[] {
  return [
    new BashTool(),
    new FileReadTool(),
    new FileEditTool(),
    new FileWriteTool(),
    new GrepTool(),
    new GlobTool(),
    new WebFetchTool(),
    new ListDirTool(),
    new GitDiffTool(),
    new GitStatusTool(),
    new GitCommitTool(),
    new GitLogTool(),
    new ProjectIndexTool(),
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

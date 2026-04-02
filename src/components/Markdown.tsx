// ─────────────────────────────────────────────────────────────
// Remus — Ink Components: Markdown Renderer v2
// Premium terminal markdown with syntax highlighting
// ─────────────────────────────────────────────────────────────

import React from 'react';
import { Text, Box } from 'ink';
import chalk from 'chalk';

interface MarkdownProps {
  text: string;
}

// ── Color palette ──
const C = {
  orange:  '#FF6B35',
  amber:   '#FF8C42',
  gold:    '#FFA559',
  peach:   '#FFB875',
  cream:   '#FFCF9F',
  white:   '#FFFFFF',
  cyan:    '#67E8F9',
  green:   '#4ADE80',
  yellow:  '#FBBF24',
  red:     '#F87171',
  purple:  '#C084FC',
  border:  '#333333',
  dim:     '#555555',
  muted:   '#777777',
  bg:      '#1A1A1A',
};

/**
 * Render markdown-ish text for the terminal.
 * Handles code blocks, inline code, bold, italic, headers, lists.
 */
export function Markdown({ text }: MarkdownProps): React.ReactElement {
  const lines = text.split('\n');
  const elements: React.ReactElement[] = [];
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeLines: string[] = [];
  let key = 0;

  for (const line of lines) {
    // Code block start/end
    if (line.trimStart().startsWith('```')) {
      if (inCodeBlock) {
        // End code block — render premium code box
        const langDisplay = codeBlockLang || 'code';
        const lineNumWidth = String(codeLines.length).length;
        
        elements.push(
          <Box key={key++} flexDirection="column" marginY={0}>
            {/* Code block header */}
            <Box>
              <Text color={C.dim}>{'  ┌─ '}</Text>
              <Text color={C.amber} bold>{langDisplay}</Text>
              <Text color={C.dim}>{' ' + '─'.repeat(Math.max(1, 40 - langDisplay.length))}</Text>
            </Box>
            {/* Code lines with line numbers */}
            {codeLines.map((cl, i) => (
              <Box key={i}>
                <Text color={C.dim}>{'  │ '}</Text>
                <Text color={C.dim}>{String(i + 1).padStart(lineNumWidth, ' ')}</Text>
                <Text color={C.dim}>{' │ '}</Text>
                <Text>{highlightCode(cl, codeBlockLang)}</Text>
              </Box>
            ))}
            {/* Code block footer */}
            <Box>
              <Text color={C.dim}>{'  └' + '─'.repeat(44)}</Text>
            </Box>
          </Box>
        );
        inCodeBlock = false;
        codeLines = [];
        codeBlockLang = '';
      } else {
        // Start code block
        inCodeBlock = true;
        codeBlockLang = line.trim().slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Headers — clean gradient hierarchy
    if (line.startsWith('### ')) {
      elements.push(
        <Box key={key++} marginTop={0}>
          <Text color={C.peach} bold>{'  ▪ '}</Text>
          <Text color={C.peach} bold>{line.slice(4)}</Text>
        </Box>
      );
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(
        <Box key={key++} marginTop={0}>
          <Text color={C.amber} bold>{'  ◆ '}</Text>
          <Text color={C.amber} bold>{line.slice(3)}</Text>
        </Box>
      );
      continue;
    }
    if (line.startsWith('# ')) {
      elements.push(
        <Box key={key++} marginTop={0}>
          <Text color={C.orange} bold underline>{'  '}{line.slice(2)}</Text>
        </Box>
      );
      continue;
    }

    // Horizontal rule — thin styled line
    if (/^---+$/.test(line.trim())) {
      elements.push(
        <Text key={key++} color={C.border}>{'  ' + '─'.repeat(48)}</Text>
      );
      continue;
    }

    // List items — clean bullets
    if (/^\s*[-*]\s/.test(line)) {
      const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
      const content = line.replace(/^\s*[-*]\s/, '');
      const depth = Math.floor(indent / 2);
      const bullets = ['▸', '◦', '·'];
      const bulletColors = [C.amber, C.gold, C.muted];
      const bullet = bullets[Math.min(depth, bullets.length - 1)];
      const bColor = bulletColors[Math.min(depth, bulletColors.length - 1)];
      
      elements.push(
        <Text key={key++}>
          {'  ' + '  '.repeat(depth)}
          <Text color={bColor}>{bullet} </Text>
          {renderInlineMarkdown(content)}
        </Text>
      );
      continue;
    }

    // Numbered list — bold numbers
    if (/^\s*\d+\.\s/.test(line)) {
      const match = line.match(/^(\s*)(\d+)\.\s(.*)/);
      if (match) {
        const [, indent, num, content] = match;
        const depth = Math.floor((indent?.length ?? 0) / 2);
        elements.push(
          <Text key={key++}>
            {'  ' + '  '.repeat(depth)}
            <Text color={C.amber} bold>{num}</Text>
            <Text color={C.dim}>. </Text>
            {renderInlineMarkdown(content ?? '')}
          </Text>
        );
        continue;
      }
    }

    // Blockquote
    if (line.startsWith('>')) {
      const content = line.replace(/^>\s?/, '');
      elements.push(
        <Box key={key++}>
          <Text color={C.dim}>{'  ┃ '}</Text>
          <Text color={C.muted} italic>{renderInlineMarkdown(content)}</Text>
        </Box>
      );
      continue;
    }

    // Empty line
    if (!line.trim()) {
      elements.push(<Text key={key++}>{' '}</Text>);
      continue;
    }

    // Regular text with inline formatting
    elements.push(<Text key={key++}>{'  '}{renderInlineMarkdown(line)}</Text>);
  }

  // Unclosed code block — render what we have
  if (inCodeBlock && codeLines.length > 0) {
    const lineNumWidth = String(codeLines.length).length;
    elements.push(
      <Box key={key++} flexDirection="column" marginY={0}>
        <Box>
          <Text color={C.dim}>{'  ┌─ '}</Text>
          <Text color={C.amber} bold>{codeBlockLang || 'code'}</Text>
          <Text color={C.dim}>{' ' + '─'.repeat(36)}</Text>
        </Box>
        {codeLines.map((cl, i) => (
          <Box key={i}>
            <Text color={C.dim}>{'  │ '}</Text>
            <Text color={C.dim}>{String(i + 1).padStart(lineNumWidth, ' ')}</Text>
            <Text color={C.dim}>{' │ '}</Text>
            <Text>{highlightCode(cl, codeBlockLang)}</Text>
          </Box>
        ))}
        <Box>
          <Text color={C.dim}>{'  └─ ...'}</Text>
        </Box>
      </Box>
    );
  }

  return <Box flexDirection="column">{elements}</Box>;
}

/**
 * Render inline markdown: `code`, **bold**, *italic*, [links]
 */
function renderInlineMarkdown(text: string): string {
  // Inline code — distinct cyan styling
  text = text.replace(/`([^`]+)`/g, (_m, code) => 
    chalk.hex(C.cyan)(code)
  );
  // Bold
  text = text.replace(/\*\*([^*]+)\*\*/g, (_m, bold) => chalk.bold.hex(C.white)(bold));
  // Italic
  text = text.replace(/\*([^*]+)\*/g, (_m, italic) => chalk.italic.hex(C.muted)(italic));
  // Links — orange with underline
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => 
    `${chalk.hex(C.orange).underline(label)} ${chalk.hex(C.dim)(`(${url})`)}`
  );
  return text;
}

/**
 * Enhanced syntax highlighting for code blocks.
 */
function highlightCode(line: string, _lang: string): string {
  const keywords = new Set([
    'const', 'let', 'var', 'function', 'class', 'return', 'if', 'else',
    'for', 'while', 'import', 'export', 'from', 'async', 'await',
    'try', 'catch', 'throw', 'new', 'this', 'super', 'extends',
    'interface', 'type', 'enum', 'implements', 'public', 'private',
    'protected', 'static', 'readonly', 'abstract', 'override',
    'def', 'self', 'None', 'True', 'False', 'lambda', 'yield',
    'fn', 'pub', 'mut', 'impl', 'struct', 'trait', 'use', 'mod',
    'package', 'func', 'defer', 'go', 'select', 'case', 'switch',
    'break', 'continue', 'default', 'do', 'in', 'of', 'typeof', 'void',
  ]);

  const builtins = new Set([
    'console', 'process', 'require', 'module', 'exports', 'global',
    'window', 'document', 'Math', 'JSON', 'Array', 'Object', 'String',
    'Number', 'Boolean', 'Promise', 'Map', 'Set', 'Date', 'Error',
    'RegExp', 'Symbol', 'Buffer', 'setTimeout', 'setInterval',
    'parseInt', 'parseFloat', 'print', 'len', 'range', 'str', 'int',
  ]);

  const constants = new Set([
    'true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
    'True', 'False', 'None', 'nil',
  ]);

  // Apply highlighting in order: comments first (takes precedence)
  // Check for line comments first
  const commentIdx = findCommentStart(line);
  let codePart = commentIdx >= 0 ? line.slice(0, commentIdx) : line;
  const commentPart = commentIdx >= 0 ? chalk.hex(C.dim).italic(line.slice(commentIdx)) : '';

  // Highlight the code portion
  codePart = codePart
    // String literals — green
    .replace(/(["'`])(?:(?!\1|\\).|\\.)*\1/g, (str) => chalk.hex(C.green)(str))
    // Numbers
    .replace(/\b(\d+\.?\d*)\b/g, (num) => chalk.hex(C.yellow)(num))
    // Keywords
    .replace(/\b(\w+)\b/g, (word) => {
      if (keywords.has(word)) return chalk.hex(C.orange).bold(word);
      if (builtins.has(word)) return chalk.hex(C.cyan)(word);
      if (constants.has(word)) return chalk.hex(C.purple)(word);
      return word;
    });

  return codePart + commentPart;
}

/**
 * Find the start index of a line comment, avoiding strings.
 */
function findCommentStart(line: string): number {
  let inStr: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === inStr) inStr = null;
    } else {
      if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
      if (line.slice(i, i + 2) === '//') return i;
      if (ch === '#' && (i === 0 || /\s/.test(line[i - 1] ?? ''))) return i;
    }
  }
  return -1;
}

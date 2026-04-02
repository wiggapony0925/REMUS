// ─────────────────────────────────────────────────────────────
// Remus — Ink Components: Markdown Renderer
// Premium terminal markdown with syntax highlighting
// ─────────────────────────────────────────────────────────────

import React from 'react';
import { Text, Box } from 'ink';
import chalk from 'chalk';

interface MarkdownProps {
  text: string;
}

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
        // End code block
        elements.push(
          <Box key={key++} flexDirection="column" borderStyle="round" borderColor="#FF6B35" paddingX={1} marginY={0}>
            {codeBlockLang && <Text color="#FF8C42" dimColor>{' ' + codeBlockLang}</Text>}
            {codeLines.map((cl, i) => (
              <Text key={i}>{highlightCode(cl, codeBlockLang)}</Text>
            ))}
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

    // Headers
    if (line.startsWith('### ')) {
      elements.push(<Text key={key++} bold color="#FFB875">{'  ▸ ' + line.slice(4)}</Text>);
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(<Text key={key++} bold color="#FF8C42">{'  ◆ ' + line.slice(3)}</Text>);
      continue;
    }
    if (line.startsWith('# ')) {
      elements.push(<Text key={key++} bold color="#FF6B35">{'  ⬡ ' + line.slice(2)}</Text>);
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push(<Text key={key++} color="gray" dimColor>{'─'.repeat(50)}</Text>);
      continue;
    }

    // List items
    if (/^\s*[-*]\s/.test(line)) {
      const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
      const content = line.replace(/^\s*[-*]\s/, '');
      elements.push(
        <Text key={key++}>
          {'  '.repeat(Math.floor(indent / 2))}
          <Text color="#FF8C42">{'▸ '}</Text>
          {renderInlineMarkdown(content)}
        </Text>
      );
      continue;
    }

    // Numbered list
    if (/^\s*\d+\.\s/.test(line)) {
      const match = line.match(/^(\s*)(\d+)\.\s(.*)/);
      if (match) {
        const [, indent, num, content] = match;
        elements.push(
          <Text key={key++}>
            {'  '.repeat(Math.floor((indent?.length ?? 0) / 2))}
            <Text color="#FF8C42" bold>{num}. </Text>
            {renderInlineMarkdown(content ?? '')}
          </Text>
        );
        continue;
      }
    }

    // Empty line
    if (!line.trim()) {
      elements.push(<Text key={key++}>{' '}</Text>);
      continue;
    }

    // Regular text with inline formatting
    elements.push(<Text key={key++}>{renderInlineMarkdown(line)}</Text>);
  }

  // Unclosed code block
  if (inCodeBlock && codeLines.length > 0) {
    elements.push(
      <Box key={key++} flexDirection="column" borderStyle="round" borderColor="#FF6B35" paddingX={1}>
        {codeLines.map((cl, i) => (
          <Text key={i}>{cl}</Text>
        ))}
      </Box>
    );
  }

  return <Box flexDirection="column">{elements}</Box>;
}

/**
 * Render inline markdown: `code`, **bold**, *italic*, [links]
 */
function renderInlineMarkdown(text: string): string {
  // Inline code
  text = text.replace(/`([^`]+)`/g, (_m, code) => chalk.hex('#FF8C42')(code));
  // Bold
  text = text.replace(/\*\*([^*]+)\*\*/g, (_m, bold) => chalk.bold.white(bold));
  // Italic
  text = text.replace(/\*([^*]+)\*/g, (_m, italic) => chalk.italic(italic));
  // Links
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => 
    `${chalk.hex('#FF6B35').underline(label)} ${chalk.dim(`(${url})`)}`
  );
  return text;
}

/**
 * Basic syntax highlighting for code blocks.
 */
function highlightCode(line: string, lang: string): string {
  // Keywords for common languages
  const keywords = new Set([
    'const', 'let', 'var', 'function', 'class', 'return', 'if', 'else',
    'for', 'while', 'import', 'export', 'from', 'async', 'await',
    'try', 'catch', 'throw', 'new', 'this', 'super', 'extends',
    'interface', 'type', 'enum', 'implements', 'public', 'private',
    'protected', 'static', 'readonly', 'abstract', 'override',
    'def', 'self', 'None', 'True', 'False', 'lambda', 'yield',
    'fn', 'pub', 'mut', 'impl', 'struct', 'trait', 'use', 'mod',
  ]);

  // Simple token-based highlighting
  return line.replace(/\b(\w+)\b/g, (word) => {
    if (keywords.has(word)) return chalk.hex('#FF6B35')(word);
    return word;
  })
  // String literals
  .replace(/(["'`])(?:(?!\1).)*\1/g, (str) => chalk.green(str))
  // Comments
  .replace(/(\/\/.*)$/, (comment) => chalk.gray(comment))
  .replace(/(#.*)$/, (comment) => chalk.gray(comment));
}

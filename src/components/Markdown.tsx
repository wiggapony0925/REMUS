// ─────────────────────────────────────────────────────────────
// Remus — Ink Components: Markdown Renderer v3
// Native Ink color rendering — guaranteed visible syntax highlighting
// ─────────────────────────────────────────────────────────────

import React from 'react';
import { Text, Box } from 'ink';

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
  blue:    '#60A5FA',
  border:  '#333333',
  dim:     '#555555',
  muted:   '#777777',
  lineNum: '#4A4A4A',
};

// ── Keyword sets for syntax highlighting ──
const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'class', 'return', 'if', 'else',
  'for', 'while', 'import', 'export', 'from', 'async', 'await',
  'try', 'catch', 'throw', 'new', 'this', 'super', 'extends',
  'interface', 'type', 'enum', 'implements', 'public', 'private',
  'protected', 'static', 'readonly', 'abstract', 'override',
  'def', 'self', 'lambda', 'yield', 'with', 'as', 'is', 'not', 'and', 'or',
  'fn', 'pub', 'mut', 'impl', 'struct', 'trait', 'use', 'mod', 'where',
  'package', 'func', 'defer', 'go', 'select', 'case', 'switch',
  'break', 'continue', 'default', 'do', 'in', 'of', 'typeof', 'void',
  'elif', 'except', 'finally', 'raise', 'pass', 'del', 'assert',
]);

const BUILTINS = new Set([
  'console', 'process', 'require', 'module', 'exports', 'global',
  'window', 'document', 'Math', 'JSON', 'Array', 'Object', 'String',
  'Number', 'Boolean', 'Promise', 'Map', 'Set', 'Date', 'Error',
  'RegExp', 'Symbol', 'Buffer', 'setTimeout', 'setInterval',
  'parseInt', 'parseFloat', 'print', 'len', 'range', 'str', 'int',
  'list', 'dict', 'tuple', 'set', 'float', 'bool', 'bytes',
  'React', 'useState', 'useEffect', 'useRef', 'useCallback', 'useMemo',
]);

const CONSTANTS = new Set([
  'true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
  'True', 'False', 'None', 'nil', 'NULL',
]);

// ── Token types for syntax highlighting ──
type TokenType = 'keyword' | 'builtin' | 'constant' | 'string' | 'number' | 'comment' | 'punctuation' | 'plain';

interface Token {
  text: string;
  type: TokenType;
}

const TOKEN_COLORS: Record<TokenType, string> = {
  keyword: C.orange,
  builtin: C.cyan,
  constant: C.purple,
  string: C.green,
  number: C.yellow,
  comment: C.dim,
  punctuation: C.muted,
  plain: C.cream,
};

/**
 * Tokenize a code line into typed segments for highlighting.
 */
function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < line.length) {
    const ch = line[i]!;

    // ── Comments ──
    if (line.slice(i, i + 2) === '//') {
      tokens.push({ text: line.slice(i), type: 'comment' });
      return tokens;
    }
    if (ch === '#' && (i === 0 || /\s/.test(line[i - 1] ?? ''))) {
      tokens.push({ text: line.slice(i), type: 'comment' });
      return tokens;
    }

    // ── Strings ──
    if (ch === '"' || ch === "'" || ch === '`') {
      let end = i + 1;
      while (end < line.length) {
        if (line[end] === '\\') { end += 2; continue; }
        if (line[end] === ch) { end++; break; }
        end++;
      }
      tokens.push({ text: line.slice(i, end), type: 'string' });
      i = end;
      continue;
    }

    // ── Numbers ──
    if (/[0-9]/.test(ch) && (i === 0 || /[\s(,=+\-*/<>[\]{}:;!&|^~%]/.test(line[i - 1] ?? ''))) {
      let end = i;
      while (end < line.length && /[0-9.xXa-fA-FeEbBoO_]/.test(line[end]!)) end++;
      tokens.push({ text: line.slice(i, end), type: 'number' });
      i = end;
      continue;
    }

    // ── Words (identifiers/keywords) ──
    if (/[a-zA-Z_$]/.test(ch)) {
      let end = i;
      while (end < line.length && /[a-zA-Z0-9_$]/.test(line[end]!)) end++;
      const word = line.slice(i, end);
      let type: TokenType = 'plain';
      if (KEYWORDS.has(word)) type = 'keyword';
      else if (BUILTINS.has(word)) type = 'builtin';
      else if (CONSTANTS.has(word)) type = 'constant';
      tokens.push({ text: word, type });
      i = end;
      continue;
    }

    // ── Punctuation ──
    if (/[{}()[\];:.,<>+\-*/%=!&|^~?@]/.test(ch)) {
      // Group consecutive punctuation
      let end = i;
      while (end < line.length && /[{}()[\];:.,<>+\-*/%=!&|^~?@]/.test(line[end]!)) {
        // Don't eat into // comments
        if (line.slice(end, end + 2) === '//') break;
        end++;
      }
      tokens.push({ text: line.slice(i, end), type: 'punctuation' });
      i = end;
      continue;
    }

    // ── Whitespace / other ──
    let end = i;
    while (end < line.length && /\s/.test(line[end]!)) end++;
    if (end > i) {
      tokens.push({ text: line.slice(i, end), type: 'plain' });
      i = end;
    } else {
      tokens.push({ text: ch, type: 'plain' });
      i++;
    }
  }

  return tokens;
}

/**
 * Render a tokenized code line as Ink <Text> elements with colors.
 */
function renderCodeLine(line: string): React.ReactElement {
  const tokens = tokenizeLine(line);
  return (
    <Text>
      {tokens.map((tok, i) => (
        <Text
          key={i}
          color={TOKEN_COLORS[tok.type]}
          bold={tok.type === 'keyword'}
          italic={tok.type === 'comment'}
        >
          {tok.text}
        </Text>
      ))}
    </Text>
  );
}

// ── Inline markdown token types ──
type InlineSegment = {
  text: string;
  style: 'plain' | 'code' | 'bold' | 'italic' | 'link-label' | 'link-url';
};

/**
 * Parse inline markdown into styled segments.
 */
function parseInlineMarkdown(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Inline code: `...`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      segments.push({ text: codeMatch[1]!, style: 'code' });
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Bold: **...**
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      segments.push({ text: boldMatch[1]!, style: 'bold' });
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic: *...*
    const italicMatch = remaining.match(/^\*([^*]+)\*/);
    if (italicMatch) {
      segments.push({ text: italicMatch[1]!, style: 'italic' });
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Link: [label](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      segments.push({ text: linkMatch[1]!, style: 'link-label' });
      segments.push({ text: ` (${linkMatch[2]})`, style: 'link-url' });
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Plain text: consume until next special character
    const plainMatch = remaining.match(/^[^`*[\]]+/);
    if (plainMatch) {
      segments.push({ text: plainMatch[0], style: 'plain' });
      remaining = remaining.slice(plainMatch[0].length);
      continue;
    }

    // Single special char that didn't start a pattern
    segments.push({ text: remaining[0]!, style: 'plain' });
    remaining = remaining.slice(1);
  }

  return segments;
}

const INLINE_STYLES: Record<InlineSegment['style'], { color: string; bold?: boolean; italic?: boolean; underline?: boolean; dimColor?: boolean }> = {
  plain:      { color: C.cream },
  code:       { color: C.cyan },
  bold:       { color: C.white, bold: true },
  italic:     { color: C.muted, italic: true },
  'link-label': { color: C.orange, underline: true },
  'link-url':   { color: C.dim, dimColor: true },
};

/**
 * Render inline markdown as Ink elements.
 */
function renderInline(text: string): React.ReactElement {
  const segments = parseInlineMarkdown(text);
  return (
    <Text>
      {segments.map((seg, i) => {
        const s = INLINE_STYLES[seg.style];
        return (
          <Text
            key={i}
            color={s.color}
            bold={s.bold}
            italic={s.italic}
            underline={s.underline}
            dimColor={s.dimColor}
          >
            {seg.text}
          </Text>
        );
      })}
    </Text>
  );
}

/**
 * Main Markdown component — renders rich terminal output.
 */
export function Markdown({ text }: MarkdownProps): React.ReactElement {
  const lines = text.split('\n');
  const elements: React.ReactElement[] = [];
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeLines: string[] = [];
  let key = 0;

  for (const line of lines) {
    // ── Code block toggle ──
    if (line.trimStart().startsWith('```')) {
      if (inCodeBlock) {
        // End code block — render premium code box
        const langLabel = codeBlockLang || 'code';
        const numW = String(codeLines.length).length;
        const headerW = Math.max(1, 44 - langLabel.length);

        elements.push(
          <Box key={key++} flexDirection="column" marginY={0}>
            {/* Header bar */}
            <Box>
              <Text color={C.dim}>{'  ┌─ '}</Text>
              <Text color={C.amber} bold>{langLabel}</Text>
              <Text color={C.dim}>{' ' + '─'.repeat(headerW)}</Text>
            </Box>
            {/* Code lines with line numbers */}
            {codeLines.map((cl, idx) => (
              <Box key={idx}>
                <Text color={C.lineNum}>{'  │ '}</Text>
                <Text color={C.lineNum}>{String(idx + 1).padStart(numW, ' ')}</Text>
                <Text color={C.dim}>{' │ '}</Text>
                {renderCodeLine(cl)}
              </Box>
            ))}
            {/* Footer bar */}
            <Box>
              <Text color={C.dim}>{'  └' + '─'.repeat(48)}</Text>
            </Box>
          </Box>
        );
        inCodeBlock = false;
        codeLines = [];
        codeBlockLang = '';
      } else {
        inCodeBlock = true;
        codeBlockLang = line.trim().slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // ── Headers ──
    if (line.startsWith('### ')) {
      elements.push(
        <Box key={key++}>
          <Text color={C.peach} bold>{'  ▪ '}</Text>
          <Text color={C.peach} bold>{line.slice(4)}</Text>
        </Box>
      );
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(
        <Box key={key++}>
          <Text color={C.amber} bold>{'  ◆ '}</Text>
          <Text color={C.amber} bold>{line.slice(3)}</Text>
        </Box>
      );
      continue;
    }
    if (line.startsWith('# ')) {
      elements.push(
        <Box key={key++}>
          <Text color={C.orange} bold underline>{'  '}{line.slice(2)}</Text>
        </Box>
      );
      continue;
    }

    // ── Horizontal rule ──
    if (/^---+$/.test(line.trim())) {
      elements.push(<Text key={key++} color={C.border}>{'  ' + '─'.repeat(48)}</Text>);
      continue;
    }

    // ── Unordered list ──
    if (/^\s*[-*]\s/.test(line)) {
      const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
      const content = line.replace(/^\s*[-*]\s/, '');
      const depth = Math.floor(indent / 2);
      const bullets = ['▸', '◦', '·'];
      const bColors = [C.amber, C.gold, C.muted];
      const bullet = bullets[Math.min(depth, 2)]!;
      const bColor = bColors[Math.min(depth, 2)]!;

      elements.push(
        <Box key={key++}>
          <Text>{'  ' + '  '.repeat(depth)}</Text>
          <Text color={bColor}>{bullet} </Text>
          {renderInline(content)}
        </Box>
      );
      continue;
    }

    // ── Ordered list ──
    if (/^\s*\d+\.\s/.test(line)) {
      const match = line.match(/^(\s*)(\d+)\.\s(.*)/);
      if (match) {
        const [, indent, num, content] = match;
        const depth = Math.floor((indent?.length ?? 0) / 2);
        elements.push(
          <Box key={key++}>
            <Text>{'  ' + '  '.repeat(depth)}</Text>
            <Text color={C.amber} bold>{num}</Text>
            <Text color={C.dim}>. </Text>
            {renderInline(content ?? '')}
          </Box>
        );
        continue;
      }
    }

    // ── Blockquote ──
    if (line.startsWith('>')) {
      const content = line.replace(/^>\s?/, '');
      elements.push(
        <Box key={key++}>
          <Text color={C.dim}>{'  ┃ '}</Text>
          <Text color={C.muted} italic>{content}</Text>
        </Box>
      );
      continue;
    }

    // ── Empty line ──
    if (!line.trim()) {
      elements.push(<Text key={key++}>{' '}</Text>);
      continue;
    }

    // ── Regular paragraph text ──
    elements.push(
      <Box key={key++}>
        <Text>{'  '}</Text>
        {renderInline(line)}
      </Box>
    );
  }

  // ── Unclosed code block ──
  if (inCodeBlock && codeLines.length > 0) {
    const numW = String(codeLines.length).length;
    elements.push(
      <Box key={key++} flexDirection="column">
        <Box>
          <Text color={C.dim}>{'  ┌─ '}</Text>
          <Text color={C.amber} bold>{codeBlockLang || 'code'}</Text>
          <Text color={C.dim}>{' ' + '─'.repeat(36)}</Text>
        </Box>
        {codeLines.map((cl, idx) => (
          <Box key={idx}>
            <Text color={C.lineNum}>{'  │ '}</Text>
            <Text color={C.lineNum}>{String(idx + 1).padStart(numW, ' ')}</Text>
            <Text color={C.dim}>{' │ '}</Text>
            {renderCodeLine(cl)}
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

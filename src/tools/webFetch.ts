// ─────────────────────────────────────────────────────────────
// Remus — Web Fetch Tool 
// Fetch and extract content from URLs
// ─────────────────────────────────────────────────────────────

import { BaseTool, type ToolInput, type ToolResult, type ToolContext } from './types.js';

export class WebFetchTool extends BaseTool {
  name = 'web_fetch';
  description = 'Fetch content from a URL and extract readable text.';
  isReadOnly = true;

  prompt = `Fetch content from URLs and extract readable text.

Usage:
- Provide a fully-formed URL
- HTTP URLs are upgraded to HTTPS
- Returns the page content converted to plain text/markdown
- Works best with public, non-authenticated URLs
- For authenticated services, use appropriate CLI tools (gh, jira, etc.)
- Large pages are truncated`;

  inputSchema = {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch',
      },
    },
    required: ['url'],
    additionalProperties: false,
  };

  async call(input: ToolInput, _context: ToolContext): Promise<ToolResult> {
    let url = input.url as string;

    // Upgrade HTTP to HTTPS
    if (url.startsWith('http://')) {
      url = 'https://' + url.slice(7);
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      return {
        output: `Invalid URL: ${url}`,
        isError: true,
        error: 'INVALID_URL',
      };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Remus-CLI/1.0 (coding-assistant)',
          'Accept': 'text/html,text/plain,application/json,*/*',
        },
        signal: controller.signal,
        redirect: 'follow',
      });

      clearTimeout(timeout);

      if (!res.ok) {
        return {
          output: `HTTP ${res.status} ${res.statusText} for ${url}`,
          isError: true,
          error: `HTTP_${res.status}`,
        };
      }

      const contentType = res.headers.get('content-type') ?? '';
      const rawText = await res.text();

      let content: string;

      if (contentType.includes('application/json')) {
        // Pretty-print JSON
        try {
          const json = JSON.parse(rawText);
          content = JSON.stringify(json, null, 2);
        } catch {
          content = rawText;
        }
      } else if (contentType.includes('text/html')) {
        // Basic HTML to text conversion
        content = this.htmlToText(rawText);
      } else {
        content = rawText;
      }

      // Truncate large content
      const maxLen = 100_000;
      const truncated = content.length > maxLen;
      if (truncated) {
        content = content.slice(0, maxLen) + '\n\n[... content truncated ...]';
      }

      const sizeKB = (Buffer.byteLength(rawText, 'utf-8') / 1024).toFixed(1);

      return {
        output: `URL: ${url}\nStatus: ${res.status}\nSize: ${sizeKB}KB\nType: ${contentType}\n${'─'.repeat(60)}\n${content}`,
        metadata: {
          url,
          status: res.status,
          contentType,
          size: Buffer.byteLength(rawText, 'utf-8'),
          truncated,
        },
      };
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('abort')) {
        return {
          output: `Request timed out for ${url}`,
          isError: true,
          error: 'TIMEOUT',
        };
      }
      return {
        output: `Fetch error: ${msg}`,
        isError: true,
        error: msg,
      };
    }
  }

  /**
   * Basic HTML to text conversion.
   * Strips tags, decodes entities, cleans up whitespace.
   */
  private htmlToText(html: string): string {
    let text = html;

    // Remove script and style elements
    text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '');
    text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');
    text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');

    // Convert common block elements to newlines
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/?(p|div|h[1-6]|li|tr|blockquote|pre|section|article)[^>]*>/gi, '\n');
    text = text.replace(/<\/?(ul|ol|table|thead|tbody)[^>]*>/gi, '\n');
    text = text.replace(/<hr[^>]*>/gi, '\n---\n');

    // Convert links to markdown-ish format
    text = text.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

    // Convert bold/strong
    text = text.replace(/<\/?(b|strong)[^>]*>/gi, '**');

    // Convert italic/em
    text = text.replace(/<\/?(i|em)[^>]*>/gi, '_');

    // Convert code
    text = text.replace(/<\/?(code)[^>]*>/gi, '`');

    // Strip remaining tags
    text = text.replace(/<[^>]+>/g, '');

    // Decode HTML entities
    text = text
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCharCode(parseInt(code, 16)));

    // Clean up whitespace
    text = text
      .split('\n')
      .map(line => line.trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return text;
  }
}

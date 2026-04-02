// ─────────────────────────────────────────────────────────────
// Remus — Retry Handler
// Exponential backoff for LLM API calls
// ─────────────────────────────────────────────────────────────

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;       // ms
  maxDelay?: number;        // ms
  backoffFactor?: number;
  retryableStatusCodes?: number[];
  onRetry?: (attempt: number, delay: number, error: Error) => void;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 5,
  baseDelay: 1000,
  maxDelay: 60_000,
  backoffFactor: 2,
  retryableStatusCodes: [429, 500, 502, 503, 504, 408],
  onRetry: () => {},
};

export class RetryError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastError: Error,
  ) {
    super(message);
    this.name = 'RetryError';
  }
}

/**
 * Extract retry-after delay from an error message or response.
 */
function extractRetryAfter(error: Error): number | null {
  // Check for "retry-after" in error message
  const match = error.message.match(/retry[- ]?after[:\s]+(\d+)/i);
  if (match) {
    const seconds = parseInt(match[1], 10);
    if (!isNaN(seconds) && seconds > 0 && seconds < 300) {
      return seconds * 1000;
    }
  }
  return null;
}

/**
 * Determine if an error is retryable.
 */
function isRetryable(error: Error, statusCodes: number[]): boolean {
  const msg = error.message.toLowerCase();

  // HTTP status code errors
  for (const code of statusCodes) {
    if (msg.includes(`(${code})`) || msg.includes(`status ${code}`) || msg.includes(`error ${code}`)) {
      return true;
    }
  }

  // Network-level errors
  if (
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('enetunreach') ||
    msg.includes('fetch failed') ||
    msg.includes('socket hang up') ||
    msg.includes('aborted') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('overloaded') ||
    msg.includes('capacity') ||
    msg.includes('insufficient_quota')
  ) {
    return true;
  }

  return false;
}

/**
 * Execute a function with exponential backoff retry logic.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;

      // Don't retry on the last attempt
      if (attempt === opts.maxRetries) break;

      // Check if error is retryable
      if (!isRetryable(lastError, opts.retryableStatusCodes)) {
        throw lastError;
      }

      // Calculate delay
      let delay = opts.baseDelay * Math.pow(opts.backoffFactor, attempt);

      // Check for retry-after header
      const retryAfter = extractRetryAfter(lastError);
      if (retryAfter) delay = Math.max(delay, retryAfter);

      // Cap delay
      delay = Math.min(delay, opts.maxDelay);

      // Add jitter (±25%)
      delay *= 0.75 + Math.random() * 0.5;

      opts.onRetry(attempt + 1, delay, lastError);

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new RetryError(
    `Failed after ${opts.maxRetries + 1} attempts: ${lastError?.message}`,
    opts.maxRetries + 1,
    lastError!,
  );
}

/**
 * Wrap a streaming generator with retry logic.
 * Only retries if the stream fails before yielding any data.
 */
export async function* withStreamRetry<T>(
  fn: () => AsyncGenerator<T>,
  options?: RetryOptions,
): AsyncGenerator<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const stream = fn();
      let hasYielded = false;

      for await (const chunk of stream) {
        hasYielded = true;
        yield chunk;
      }

      return; // Stream completed successfully
    } catch (err) {
      lastError = err as Error;

      if (attempt === opts.maxRetries) break;
      if (!isRetryable(lastError, opts.retryableStatusCodes)) throw lastError;

      let delay = opts.baseDelay * Math.pow(opts.backoffFactor, attempt);
      const retryAfter = extractRetryAfter(lastError);
      if (retryAfter) delay = Math.max(delay, retryAfter);
      delay = Math.min(delay, opts.maxDelay);
      delay *= 0.75 + Math.random() * 0.5;

      opts.onRetry(attempt + 1, delay, lastError);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new RetryError(
    `Stream failed after ${opts.maxRetries + 1} attempts: ${lastError?.message}`,
    opts.maxRetries + 1,
    lastError!,
  );
}

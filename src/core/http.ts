import type { Logger } from "./logger.js";
import { RobotsCache } from "./robots.js";

export class HttpError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** The site actively refuses automated access (robots.txt, bot challenge). Never retried or bypassed. */
export class AccessDeniedError extends HttpError {
  constructor(message: string, url: string, status?: number) {
    super(message, url, status, false);
    this.name = "AccessDeniedError";
  }
}

/** Thrown by adapters when a 200 response carries an error payload the source sometimes returns transiently. */
export class TransientPayloadError extends HttpError {
  constructor(message: string, url: string) {
    super(message, url, 200, true);
    this.name = "TransientPayloadError";
  }
}

export interface HttpClientOptions {
  userAgent: string;
  minDelayMs: number;
  timeoutMs: number;
  maxRetries: number;
  logger: Logger;
  /** Hard cap on response size to protect memory from runaway pages. */
  maxBytes?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface RequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  /** Optional validator that turns a 200-with-error-payload into a retry. */
  validate?: (text: string) => void;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 522, 524]);
const CHALLENGE_MARKERS = [/<title>Just a moment\.\.\.<\/title>/i, /cf-chl-|challenge-platform/i, /Attention Required! \| Cloudflare/i];

/**
 * A deliberately polite HTTP client:
 *  - identifies itself honestly via User-Agent;
 *  - obeys robots.txt (including Crawl-delay) and never bypasses bot challenges;
 *  - serialises requests per host with a minimum delay between them;
 *  - retries transient failures with exponential backoff + jitter, honouring Retry-After.
 */
export class HttpClient {
  private readonly robots: RobotsCache;
  private readonly hostQueues = new Map<string, Promise<void>>();
  private readonly lastRequestAt = new Map<string, number>();
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: HttpClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.robots = new RobotsCache(opts.userAgent, (url) => this.rawFetch(url, {}), opts.logger);
  }

  async text(url: string, options: RequestOptions = {}): Promise<string> {
    return this.request(url, options);
  }

  async json<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
    const headers = { Accept: "application/json", ...options.headers };
    let parsed: T | undefined;
    await this.request(url, {
      ...options,
      headers,
      validate: (text) => {
        try {
          parsed = JSON.parse(text) as T;
        } catch {
          throw new TransientPayloadError(`Response was not valid JSON (${text.slice(0, 80)})`, url);
        }
        options.validate?.(text);
      },
    });
    return parsed as T;
  }

  private async request(url: string, options: RequestOptions): Promise<string> {
    const { allowed, crawlDelayMs } = await this.robots.check(url);
    if (!allowed) throw new AccessDeniedError("Disallowed by robots.txt", url);

    const host = new URL(url).host;
    const minDelay = Math.max(this.opts.minDelayMs, crawlDelayMs ?? 0);

    let attempt = 0;
    for (;;) {
      try {
        const text = await this.throttled(host, minDelay, () => this.rawFetch(url, options));
        options.validate?.(text);
        return text;
      } catch (err) {
        const retryable = err instanceof HttpError ? err.retryable : isNetworkError(err);
        if (!retryable || attempt >= this.opts.maxRetries || options.signal?.aborted) throw err;
        const retryAfter = err instanceof RetryAfterError ? err.retryAfterMs : 0;
        const backoff = Math.max(retryAfter, Math.min(60_000, 1000 * 2 ** attempt) + Math.random() * 500);
        this.opts.logger.warn({ url, attempt: attempt + 1, backoffMs: Math.round(backoff), err: (err as Error).message }, "retrying request");
        await this.sleep(backoff);
        attempt++;
      }
    }
  }

  /** Chains requests per host so concurrency across hosts is free but each host sees a polite cadence. */
  private throttled<T>(host: string, minDelayMs: number, fn: () => Promise<T>): Promise<T> {
    const previous = this.hostQueues.get(host) ?? Promise.resolve();
    const run = previous.then(async () => {
      const wait = (this.lastRequestAt.get(host) ?? 0) + minDelayMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      try {
        return await fn();
      } finally {
        this.lastRequestAt.set(host, Date.now());
      }
    });
    this.hostQueues.set(host, run.then(() => undefined, () => undefined));
    return run;
  }

  private async rawFetch(url: string, options: RequestOptions): Promise<string> {
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(this.opts.timeoutMs)])
      : AbortSignal.timeout(this.opts.timeoutMs);
    const res = await this.fetchImpl(url, {
      method: options.method ?? "GET",
      headers: { "User-Agent": this.opts.userAgent, "Accept-Language": "en", ...options.headers },
      body: options.body,
      signal,
      redirect: "follow",
    });
    const text = await readCapped(res, this.opts.maxBytes ?? 15 * 1024 * 1024, url);

    if (CHALLENGE_MARKERS.some((re) => re.test(text.slice(0, 5000))) && (res.status === 403 || res.status === 503 || res.status === 429)) {
      throw new AccessDeniedError("Blocked by a bot-protection challenge; not bypassing", url, res.status);
    }
    if (!res.ok) {
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      if (RETRYABLE_STATUS.has(res.status)) {
        throw new RetryAfterError(`HTTP ${res.status}`, url, res.status, retryAfter);
      }
      throw new HttpError(`HTTP ${res.status}`, url, res.status, false);
    }
    return text;
  }
}

class RetryAfterError extends HttpError {
  constructor(message: string, url: string, status: number, readonly retryAfterMs: number) {
    super(message, url, status, true);
  }
}

async function readCapped(res: Response, maxBytes: number, url: string): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new HttpError(`Response too large (${declared} bytes)`, url, res.status);
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(`Response exceeded ${maxBytes} bytes`, url, res.status);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseRetryAfter(value: string | null): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (!Number.isNaN(seconds)) return Math.min(seconds * 1000, 120_000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? 0 : Math.min(Math.max(0, at - Date.now()), 120_000);
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "TimeoutError") return true;
  if (err.name === "AbortError") return false; // caller cancelled
  return err instanceof TypeError; // undici surfaces DNS/socket failures as TypeError("fetch failed")
}

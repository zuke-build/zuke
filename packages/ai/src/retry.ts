/**
 * Retry-with-backoff (and a per-attempt timeout) for transient provider
 * failures.
 *
 * Provider APIs (OpenAI, Anthropic, Gemini) routinely return short-lived
 * `503 Service Unavailable` (model overloaded) and `429 Too Many Requests`
 * (rate-limited), and a stuck connection can hang indefinitely because
 * `fetch` has no built-in timeout. {@link retryingFetch} bounds each attempt
 * with a timeout and retries the transient cases on a backoff.
 *
 * The helper retries only on a small allowlist of status codes that providers
 * use to mean "try again in a moment" (`408`, `429`, `500`, `502`, `503`,
 * `504`), on a thrown `fetch` (DNS/TCP/TLS), and on a timeout. It honours a
 * server-provided `Retry-After` header within a sane cap. Anything else (a
 * `4xx` config error, a refusal) surfaces immediately — there's nothing a
 * retry can fix. An `onRetry` callback reports each retry so a slow run reads
 * as progress rather than a hang.
 *
 * @module
 */

import { AiReviewError } from "./errors.ts";

/** HTTP status codes that mean "transient — try again shortly". */
const RETRYABLE: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);

/** Default attempts: the first try, plus two retries. */
const DEFAULT_ATTEMPTS = 3;

/** Default backoff for the *first* retry, in milliseconds. */
const DEFAULT_BASE_DELAY_MS = 1_000;

/** Cap on any single backoff (server-suggested or exponential). */
const MAX_DELAY_MS = 30_000;

/** Default per-attempt timeout — a request that exceeds it is aborted. */
const DEFAULT_TIMEOUT_MS = 60_000;

/** What happened before a retry, for {@link RetryOptions.onRetry}. */
export interface RetryInfo {
  /** The attempt that just failed (1-based). */
  attempt: number;
  /** The total number of attempts that will be made. */
  attempts: number;
  /** How long the helper will wait before the next attempt, in milliseconds. */
  delayMs: number;
  /** Why the attempt failed — e.g. `"HTTP 503"` or `"timed out after 60000ms"`. */
  reason: string;
}

/** Configurable knobs for {@link retryingFetch}. */
export interface RetryOptions {
  /** Total attempts (first try + retries). Defaults to {@link DEFAULT_ATTEMPTS}. */
  attempts?: number;
  /** Backoff for the first retry; doubles each subsequent retry. */
  baseDelayMs?: number;
  /** Per-attempt timeout in milliseconds (default 60s). `0` disables it. */
  timeoutMs?: number;
  /** Invoked before each retry, so a caller can report progress. */
  onRetry?: (info: RetryInfo) => void;
  /** Sleep seam — overridden in tests so retries don't take real time. */
  sleep?: (ms: number) => Promise<void>;
}

/** Default sleep — `setTimeout`-based, used when no seam is given. */
function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse a `Retry-After` header value (seconds or HTTP-date) into a delay in
 * milliseconds, or `undefined` when the header is absent or malformed. The
 * caller is responsible for capping the result.
 */
function parseRetryAfter(header: string | null): number | undefined {
  if (header === null) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const at = Date.parse(header);
  if (!Number.isNaN(at)) {
    const delta = at - Date.now();
    return delta > 0 ? delta : 0;
  }
  return undefined;
}

/**
 * The backoff for the next retry: the server's `Retry-After` if present and
 * shorter than the cap, otherwise the exponential schedule (base, 2x, 4x, …).
 */
function delayFor(
  response: Response,
  retryIndex: number,
  baseMs: number,
): number {
  const suggested = parseRetryAfter(response.headers.get("retry-after"));
  const fallback = baseMs * Math.pow(2, retryIndex);
  return Math.min(suggested ?? fallback, MAX_DELAY_MS);
}

/** Whether a thrown value is an abort (timeout) rather than a transport error. */
function isAbort(error: unknown): boolean {
  return error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError");
}

/** A human reason for a thrown attempt — distinguishing a timeout. */
function reasonForThrow(error: unknown, timeoutMs: number): string {
  if (isAbort(error)) return `timed out after ${timeoutMs}ms`;
  return error instanceof Error ? error.message : String(error);
}

/**
 * `fetch` with a per-attempt timeout and retry on transient failures. Each
 * attempt invokes `doFetch` with an abort signal that fires after `timeoutMs`;
 * a response whose status is in {@link RETRYABLE} is drained and (if attempts
 * remain) retried after a backoff. The final response — successful, retryable
 * but exhausted, or anything non-retryable — is returned to the caller, which
 * is responsible for the usual ok/non-ok handling.
 *
 * A `fetch` that throws (DNS, TCP, TLS) or times out is also retried; if every
 * attempt throws, an {@link AiReviewError} carrying the last reason is raised.
 */
export async function retryingFetch(
  doFetch: typeof fetch,
  url: string,
  init: RequestInit,
  options: RetryOptions = {},
): Promise<Response> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const baseMs = Math.max(0, options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const sleep = options.sleep ?? realSleep;

  let lastReason = "";
  for (let attempt = 0; attempt < attempts; attempt++) {
    const last = attempt === attempts - 1;
    // A manual controller + cleared timer (rather than AbortSignal.timeout) so
    // no timer lingers past the request — Deno's test sanitizer flags those.
    const controller = new AbortController();
    const timer = timeoutMs > 0
      ? setTimeout(
        () =>
          controller.abort(
            new DOMException(`timed out after ${timeoutMs}ms`, "TimeoutError"),
          ),
        timeoutMs,
      )
      : undefined;
    let response: Response;
    try {
      response = await doFetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (timer !== undefined) clearTimeout(timer);
      lastReason = reasonForThrow(error, timeoutMs);
      if (last) break;
      const delayMs = baseMs * Math.pow(2, attempt);
      options.onRetry?.({
        attempt: attempt + 1,
        attempts,
        delayMs,
        reason: lastReason,
      });
      await sleep(delayMs);
      continue;
    }
    if (timer !== undefined) clearTimeout(timer);
    if (!RETRYABLE.has(response.status) || last) return response;
    await response.body?.cancel(); // drain before retrying
    const delayMs = delayFor(response, attempt, baseMs);
    options.onRetry?.({
      attempt: attempt + 1,
      attempts,
      delayMs,
      reason: `HTTP ${response.status}`,
    });
    await sleep(delayMs);
  }
  // Only reachable when every attempt threw (no Response was ever obtained).
  throw new AiReviewError(
    `request failed after ${attempts} attempt(s): ${lastReason}`,
  );
}

/**
 * Retry-with-backoff for transient provider failures.
 *
 * Provider APIs (OpenAI, Anthropic, Gemini) routinely return short-lived
 * `503 Service Unavailable` (model overloaded) and `429 Too Many Requests`
 * (rate-limited). A first attempt that hits one of these will succeed on a
 * second attempt seconds later — exactly what {@link retryingFetch} does.
 *
 * The helper retries only on a small allowlist of status codes that providers
 * use to mean "try again in a moment" (`408`, `429`, `500`, `502`, `503`,
 * `504`), and honours a server-provided `Retry-After` header within a sane
 * cap. Anything else (a `4xx` config error, a network throw, a refusal)
 * surfaces immediately — there's nothing a retry can fix.
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

/** Configurable knobs for {@link retryingFetch}. */
export interface RetryOptions {
  /** Total attempts (first try + retries). Defaults to {@link DEFAULT_ATTEMPTS}. */
  attempts?: number;
  /** Backoff for the first retry; doubles each subsequent retry. */
  baseDelayMs?: number;
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

/**
 * `fetch` with retry on transient failures. Each attempt invokes `doFetch`; a
 * response whose status is in {@link RETRYABLE} is drained and (if attempts
 * remain) retried after a backoff. The final response — successful, retryable
 * but exhausted, or anything non-retryable — is returned to the caller, which
 * is responsible for the usual ok/non-ok handling.
 *
 * A `fetch` that throws (DNS, TCP, TLS) is also retried, because Deno surfaces
 * those as plain `TypeError`/`Deno.errors.*` rather than HTTP statuses.
 */
export async function retryingFetch(
  doFetch: typeof fetch,
  url: string,
  init: RequestInit,
  options: RetryOptions = {},
): Promise<Response> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const baseMs = Math.max(0, options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const sleep = options.sleep ?? realSleep;

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await doFetch(url, init);
      if (!RETRYABLE.has(response.status) || attempt === attempts - 1) {
        return response;
      }
      // Retryable status with attempts left: drain and back off.
      await response.body?.cancel();
      await sleep(delayFor(response, attempt, baseMs));
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) break;
      await sleep(baseMs * Math.pow(2, attempt));
    }
  }
  // Only reachable when every attempt threw (no Response was ever obtained).
  const message = lastError instanceof Error
    ? lastError.message
    : String(lastError);
  throw new AiReviewError(
    `network error after ${attempts} attempt(s): ${message}`,
  );
}

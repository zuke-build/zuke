/**
 * Small utilities shared across core modules. This module is **internal**: it is
 * not re-exported from `mod.ts` (or any entrypoint), so nothing here is public
 * API. It exists to consolidate helpers that were previously copy-pasted per
 * module (env reads, error-message extraction, a delay, a SHA-256 hex digest,
 * and a timeout wrapper) so the copies can't drift out of sync.
 *
 * @module
 */

/**
 * Read an environment variable, tolerating a denied `--allow-env` permission by
 * returning `undefined` rather than throwing. The default env reader every
 * command uses when the caller doesn't inject one.
 */
export function defaultReadEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

/** The message of an `Error`, or the `String(...)` form of any other value. */
export function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

/** Resolve after `ms` milliseconds (a `setTimeout`-backed sleep). */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Shared encoder for {@link sha256Hex} (a `TextEncoder` is stateless and reusable). */
const encoder = new TextEncoder();

/** The SHA-256 digest of `text`, as a lowercase hex string. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return Array.from(
    new Uint8Array(digest),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Run `fn`, rejecting if it takes longer than `timeoutMs` (`undefined` → no
 * bound, so `fn` runs to completion). On a timeout the work keeps running in the
 * background but is orphaned — only the returned promise settles (with a
 * `timed out after <ms>ms` error).
 */
export function runWithTimeout(
  fn: () => void | Promise<void>,
  timeoutMs: number | undefined,
): Promise<void> {
  const result = Promise.resolve().then(fn);
  if (timeoutMs === undefined) return result;
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    result.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Deterministic OpenTelemetry trace and span ids, derived from a run id by
 * hashing. Determinism is the whole point: a run that suspends in one process
 * and resumes in another must land its spans under the **same** trace id, with
 * no handoff — every process recomputes the id from the shared run id. Target
 * span ids are likewise stable per `(runId, target)`, so a resumed run's spans
 * slot into the same trace tree.
 *
 * OTLP/HTTP JSON encodes trace ids as 16-byte and span ids as 8-byte
 * lowercase-hex strings; that is exactly what these helpers produce.
 *
 * @module
 */

/** Lowercase-hex-encode a byte slice (OTLP/JSON ids are hex strings). */
function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** SHA-256 of `input` as a byte array. */
async function sha256(input: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest);
}

/**
 * The 16-byte (32-hex-char) trace id for a run — the first half of
 * `SHA-256("zuke.trace:" + runId)`. Deterministic, so every process that
 * touches this run (a fresh execute, a resume, a cancel) derives the same id
 * and their spans join one trace.
 */
export async function traceIdFor(runId: string): Promise<string> {
  const digest = await sha256(`zuke.trace:${runId}`);
  return toHex(digest.slice(0, 16));
}

/**
 * An 8-byte (16-hex-char) span id, unique per `(runId, key)` and stable across
 * processes. `key` is the sentinel `"run"` for a run's root span, or a target's
 * dotted name for its span — so a resumed run reuses the same ids. The `/`
 * separator never appears in a run id (a UUID) or a target name, so distinct
 * pairs never collide on the hashed input.
 */
export async function spanIdFor(runId: string, key: string): Promise<string> {
  const digest = await sha256(`zuke.span:${runId}/${key}`);
  return toHex(digest.slice(0, 8));
}

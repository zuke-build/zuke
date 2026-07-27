/**
 * Bounded capture of a child process's output.
 *
 * A command's stdout and stderr are captured into memory so
 * {@link "./shell.ts".CommandOutput} can hand them back, which means an
 * unbounded stream — a runaway test reporter, a container build log — would
 * otherwise grow a buffer until the run dies. Capture keeps a bounded **tail**
 * instead: the newest bytes up to the cap, which is the end anyone reads for the
 * failure. Live streaming to the terminal is unaffected; every byte still goes
 * to the sink as it arrives. Internal (not a published entrypoint).
 *
 * @module
 */

/** The default capture cap per stream, in bytes (8 MiB). */
export const DEFAULT_MAX_CAPTURED_BYTES = 8 * 1024 * 1024;

/** The result of a bounded capture: the decoded text and whether bytes were lost. */
export interface Captured {
  /** The captured text — the tail of the stream when {@link Captured.truncated}. */
  readonly text: string;
  /** Whether the cap was reached and leading bytes were discarded. */
  readonly truncated: boolean;
}

/**
 * Render a byte count the way the truncation notice should read: `8 MiB`,
 * `4 KiB`, or a plain byte count when it is not a whole multiple.
 */
export function formatByteCap(bytes: number): string {
  const KiB = 1024;
  const MiB = KiB * KiB;
  if (bytes >= MiB && bytes % MiB === 0) return `${bytes / MiB} MiB`;
  if (bytes >= KiB && bytes % KiB === 0) return `${bytes / KiB} KiB`;
  return `${bytes} bytes`;
}

/**
 * The one-line notice prepended to truncated text, so a caller reading the
 * captured output sees that the beginning is missing rather than silently
 * parsing a fragment.
 */
export function truncationNotice(maxBytes: number): string {
  return `[output truncated to last ${formatByteCap(maxBytes)}]`;
}

/**
 * Reject a capture cap {@link captureStream} cannot honour — anything that is
 * not a positive whole number of bytes — at the setter, before a process is
 * spawned, rather than letting the trim loop fail mid-stream with an opaque
 * internal error.
 *
 * There is deliberately no "unlimited" sentinel: a caller that must keep every
 * byte passes a cap larger than the output it expects (`Number.MAX_SAFE_INTEGER`
 * for "however much there is"), so the ceiling is always visible in the code.
 *
 * @param bytes The requested cap.
 * @throws {RangeError} If `bytes` is not a positive integer.
 */
export function checkMaxCapturedBytes(bytes: number): void {
  if (Number.isInteger(bytes) && bytes > 0) return;
  throw new RangeError(
    `maxCapturedBytes must be a positive whole number of bytes, got ${bytes}. ` +
      `Pass the number of bytes to keep per stream, e.g. 8 * 1024 * 1024. ` +
      `There is no unlimited value: to keep everything, pass a cap larger ` +
      `than the output you expect, such as Number.MAX_SAFE_INTEGER.`,
  );
}

/**
 * Drain `stream`, writing every chunk to `sink` when one is given, and capture
 * at most `maxBytes` of it — dropping from the FRONT so the newest output
 * survives.
 *
 * The cut is made at a byte boundary, so a multi-byte character straddling it
 * decodes to a replacement character; that is the cost of bounding the buffer
 * without decoding incrementally.
 *
 * @param stream The child's stdout or stderr.
 * @param sink Where to tee each chunk live, or `null` to capture silently.
 * @param maxBytes The capture cap for this stream, in bytes.
 * @returns The captured tail and whether anything was dropped.
 */
export async function captureStream(
  stream: ReadableStream<Uint8Array>,
  sink: { writeSync(p: Uint8Array): number } | null,
  maxBytes: number,
): Promise<Captured> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (sink) sink.writeSync(value);
      chunks.push(value);
      total += value.length;
      // Trim from the front until the retained bytes fit the cap: whole chunks
      // first, then a partial slice of the oldest survivor.
      while (total > maxBytes) {
        const oldest = chunks[0];
        if (total - oldest.length >= maxBytes) {
          chunks.shift();
          total -= oldest.length;
        } else {
          const drop = total - maxBytes;
          chunks[0] = oldest.subarray(drop);
          total -= drop;
        }
        truncated = true;
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { text: decodeChunks(chunks, total), truncated };
}

/** Concatenate `total` bytes of `chunks` into one buffer and decode as UTF-8. */
function decodeChunks(chunks: Uint8Array[], total: number): string {
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(merged);
}

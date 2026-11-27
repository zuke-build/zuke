// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Upload a stream in fixed-size parts. A network store cannot send a stream
 * as one request: `fetch` drops a manual `Content-Length` on a streamed body,
 * and S3 and Azure Blob both refuse a body of unknown length. So the stores
 * cut the archive into parts, each a body of known length, held one at a time.
 *
 * @module
 */

/** The size of every part but the last: 8 MiB, above S3's 5 MiB part minimum. */
export const PART_SIZE = 8 * 1024 * 1024;

/** What a yielded part's slot is cleared to. */
const EMPTY = new Uint8Array(0);

/** `stream` cut into parts of exactly `size` bytes, the last one shorter. */
export async function* partsOf(
  stream: ReadableStream<Uint8Array<ArrayBuffer>>,
  size: number = PART_SIZE,
): AsyncGenerator<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  let part = new Uint8Array(size);
  let filled = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      let at = 0;
      while (at < value.length) {
        const n = Math.min(size - filled, value.length - at);
        part.set(value.subarray(at, at + n), filled);
        filled += n;
        at += n;
        if (filled === size) {
          yield part;
          part = new Uint8Array(size);
          filled = 0;
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {}); // already closed is fine
    reader.releaseLock(); // cancel leaves the stream locked to this reader
  }
  if (filled > 0) yield part.slice(0, filled);
}

/** The `held` parts, then `rest`; each slot is cleared as it is yielded. */
async function* chain(
  held: Uint8Array<ArrayBuffer>[],
  rest: AsyncIterable<Uint8Array<ArrayBuffer>>,
): AsyncGenerator<Uint8Array<ArrayBuffer>> {
  for (let i = 0; i < held.length; i++) {
    const part = held[i];
    held[i] = EMPTY;
    yield part;
  }
  yield* rest;
}

/**
 * Upload `stream`: through `whole` when it fits in one part (a single request,
 * as `put` makes), else through `parts`, which is given every part in order.
 * Memory is a few parts, never the archive.
 */
export async function uploadInParts(
  stream: ReadableStream<Uint8Array<ArrayBuffer>>,
  whole: (artifact: Uint8Array<ArrayBuffer>) => Promise<void>,
  parts: (parts: AsyncIterable<Uint8Array<ArrayBuffer>>) => Promise<void>,
): Promise<void> {
  const rest = partsOf(stream);
  try {
    const first = await rest.next();
    if (first.done) return await whole(new Uint8Array(0));
    const second = await rest.next();
    if (second.done) return await whole(first.value);
    await parts(chain([first.value, second.value], rest));
  } finally {
    await rest.return(undefined); // releases the stream if not read to the end
  }
}

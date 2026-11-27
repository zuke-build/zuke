// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Web streams built from iterables, and converted to and from Node streams,
 * in a form TypeScript's own compiler accepts as well as `deno check`.
 * Module-internal.
 *
 * TypeScript's DOM types have no `ReadableStream.from`. They also type
 * `node:stream/web`'s streams apart from the global ones, though on Deno and
 * Node alike the two are the same class at runtime.
 *
 * @module
 */

import { Readable } from "node:stream";
import { ReadableStream as NodeReadableStream } from "node:stream/web";

/**
 * A stream of what `source` yields, as `ReadableStream.from` builds it: an
 * item is read only when the stream is pulled, an error from the iterator
 * errors the stream, and cancelling the stream returns the iterator. Unlike
 * `ReadableStream.from`, a promise a sync iterable yields is enqueued as it
 * is, not awaited; no caller yields one.
 */
export function streamOf<T>(
  source: Iterable<T> | AsyncIterable<T>,
): ReadableStream<T> {
  const iterator = Symbol.asyncIterator in source
    ? source[Symbol.asyncIterator]()
    : source[Symbol.iterator]();
  return new ReadableStream<T>(
    {
      async pull(controller) {
        const next = await iterator.next();
        if (next.done === true) controller.close();
        else controller.enqueue(next.value);
      },
      async cancel(reason) {
        await iterator.return?.(reason);
      },
    },
    { highWaterMark: 0 },
  );
}

/**
 * `readable` as a web stream of its bytes, read through `Readable.toWeb`. A
 * cancel destroys `readable` with no error: `Readable.toWeb`'s own cancel
 * destroys it with an `AbortError`, which Node emits as an `'error'` event,
 * and one that finds no listener ends the process (#1215).
 */
export function toWebStream(readable: Readable): ReadableStream<Uint8Array> {
  const web = Readable.toWeb(readable);
  if (!(web instanceof ReadableStream)) {
    throw new TypeError(
      "zuke: node:stream/web is not the global ReadableStream",
    );
  }
  const reader = web.getReader();
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        const next = await reader.read();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      },
      cancel() {
        reader.releaseLock();
        readable.destroy();
      },
    },
    { highWaterMark: 0 },
  );
}

/** `stream` as a Node readable, by `Readable.fromWeb`. */
export function fromWebStream(stream: ReadableStream<Uint8Array>): Readable {
  if (stream instanceof NodeReadableStream) return Readable.fromWeb(stream);
  throw new TypeError("zuke: node:stream/web is not the global ReadableStream");
}

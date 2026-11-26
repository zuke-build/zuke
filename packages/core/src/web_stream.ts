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

/** `readable` as a web stream of its bytes, by `Readable.toWeb`. */
export function toWebStream(readable: Readable): ReadableStream<Uint8Array> {
  const web = Readable.toWeb(readable);
  if (web instanceof ReadableStream) return web;
  throw new TypeError("zuke: node:stream/web is not the global ReadableStream");
}

/** `stream` as a Node readable, by `Readable.fromWeb`. */
export function fromWebStream(stream: ReadableStream<Uint8Array>): Readable {
  if (stream instanceof NodeReadableStream) return Readable.fromWeb(stream);
  throw new TypeError("zuke: node:stream/web is not the global ReadableStream");
}

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "../../../tests/_testing.ts";
import { Readable } from "node:stream";
import { assertEquals, assertRejects } from "../../../tests/_assert.ts";
import { fromWebStream, streamOf, toWebStream } from "../src/web_stream.ts";

/** Everything `stream` yields, in order. */
async function collect<T>(stream: ReadableStream<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of stream) items.push(item);
  return items;
}

test("streamOf yields a sync iterable's items, then ends", async () => {
  assertEquals(await collect(streamOf([1, 2, 3])), [1, 2, 3]);
  assertEquals(await collect(streamOf<number>([])), []);
});

test("streamOf yields an async iterable's items, then ends", async () => {
  async function* items(): AsyncGenerator<string> {
    yield "a";
    yield "b";
  }
  assertEquals(await collect(streamOf(items())), ["a", "b"]);
});

test("streamOf reads an item only when the stream is pulled", async () => {
  const read: number[] = [];
  function* items(): Generator<number> {
    for (const n of [1, 2, 3]) {
      read.push(n);
      yield n;
    }
  }
  const reader = streamOf(items()).getReader();
  await Promise.resolve();
  assertEquals(read, []);
  assertEquals((await reader.read()).value, 1);
  assertEquals(read, [1]);
  reader.releaseLock();
});

test("streamOf errors the stream when the iterator throws", async () => {
  async function* failing(): AsyncGenerator<number> {
    yield 1;
    throw new Error("source broke");
  }
  await assertRejects(
    () => collect(streamOf(failing())),
    Error,
    "source broke",
  );
});

test("streamOf errors the stream when a sync iterator's next throws", async () => {
  const throwing: Iterable<number> = {
    [Symbol.iterator]: () => ({
      next: (): IteratorResult<number> => {
        throw new Error("next broke");
      },
    }),
  };
  await assertRejects(() => collect(streamOf(throwing)), Error, "next broke");
});

test("cancelling a streamOf stream whose iterator has no return succeeds", async () => {
  const endless: Iterable<number> = {
    [Symbol.iterator]: () => ({ next: () => ({ done: false, value: 1 }) }),
  };
  const reader = streamOf(endless).getReader();
  assertEquals((await reader.read()).value, 1);
  await reader.cancel("done");
});

test("cancelling a streamOf stream returns the iterator", async () => {
  let finished = false;
  function* items(): Generator<number> {
    try {
      yield 1;
      yield 2;
    } finally {
      finished = true;
    }
  }
  const reader = streamOf(items()).getReader();
  await reader.read();
  await reader.cancel("done");
  assertEquals(finished, true);
});

test("toWebStream and fromWebStream carry bytes both ways", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const web = toWebStream(
    Readable.from([bytes.subarray(0, 2), bytes.subarray(2)]),
  );
  const chunks = await collect(web);
  assertEquals(new Uint8Array(chunks.flatMap((chunk) => [...chunk])), bytes);

  const back: number[] = [];
  for await (const chunk of fromWebStream(streamOf([bytes]))) {
    back.push(...new Uint8Array(chunk));
  }
  assertEquals(back, [1, 2, 3, 4]);
});

test("toWebStream's cancel destroys the readable without an error event", async () => {
  // Readable.toWeb's own cancel destroys with an AbortError, which crashed a
  // test process when it found no listener (#1215).
  const errors: unknown[] = [];
  const readable = new Readable({ read() {} });
  readable.on("error", (error) => errors.push(error));
  readable.push(new Uint8Array([1]));
  const web = toWebStream(readable);
  await web.cancel();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assertEquals(readable.destroyed, true);
  assertEquals(errors, []);
});

test("toWebStream errors the web stream when the readable errors", async () => {
  const readable = new Readable({ read() {} });
  const web = toWebStream(readable);
  readable.destroy(new Error("boom"));
  await assertRejects(() => collect(web), Error, "boom");
});

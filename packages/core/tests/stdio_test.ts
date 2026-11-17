// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { PassThrough } from "node:stream";
import { assertEquals } from "./_assert.ts";
import {
  awaitedWriter,
  flushOutput,
  processOutput,
  promptLine,
  queuedWriter,
  readLine,
  stdinBytes,
  stdoutWriter,
} from "../src/stdio.ts";

const bytes = (text: string) => new TextEncoder().encode(text);

/** Everything `stream` has been given so far, as text. */
function drained(stream: PassThrough): string {
  const chunk: unknown = stream.read();
  return chunk instanceof Uint8Array ? new TextDecoder().decode(chunk) : "";
}

Deno.test("a queued writer returns at once and keeps the order", () => {
  const stream = new PassThrough();
  const writer = queuedWriter(stream);
  assertEquals(writer.writeSync(bytes("one ")), 4);
  assertEquals(writer.writeSync(bytes("two")), 3);
  assertEquals(drained(stream), "one two");
});

Deno.test("a writer copies what it is given, so the caller may reuse it", async () => {
  const stream = new PassThrough();
  const reused = bytes("first");
  queuedWriter(stream).writeSync(reused);
  reused.set(bytes("again"));
  const awaited = awaitedWriter(stream).write(reused);
  reused.set(bytes("third"));
  assertEquals(await awaited, 5);
  assertEquals(drained(stream), "first" + "again");
});

Deno.test("an awaited write resolves only once the bytes before it have gone", async () => {
  const stream = new PassThrough({ highWaterMark: 1 });
  const writer = awaitedWriter(stream);
  let done = false;
  const first = writer.write(bytes("held back")).then(() => done = true);
  const last = writer.write(new Uint8Array());
  await new Promise((resolve) => setTimeout(resolve, 10));
  // Nothing reads the stream yet, so nothing has left it.
  assertEquals(done, false);
  stream.resume();
  await Promise.all([first, last]);
  assertEquals(done, true);
});

Deno.test("an awaited write to a stream that has gone still resolves", async () => {
  const stream = new PassThrough();
  stream.destroy();
  assertEquals(await awaitedWriter(stream).write(bytes("lost")), 4);
});

Deno.test("on Deno the process's streams are Deno's own, and a flush is immediate", async () => {
  assertEquals(processOutput(), { stdout: Deno.stdout, stderr: Deno.stderr });
  assertEquals(stdoutWriter(), Deno.stdout);
  assertEquals(stdinBytes(), Deno.stdin.readable);
  await flushOutput();
});

/** A reader handing out `text` a byte per call, then the end of the input. */
function reader(text: string): (buffer: Uint8Array) => number {
  const source = bytes(text);
  let at = 0;
  return (buffer) => {
    if (at === source.length) return 0;
    buffer[0] = source[at++];
    return 1;
  };
}

Deno.test("a line is read up to its line break, which is dropped", () => {
  assertEquals(readLine(reader("staging\n")), "staging");
  assertEquals(readLine(reader("staging\r\n")), "staging");
  assertEquals(readLine(reader("\n")), "");
});

Deno.test("a line read takes nothing after the line break", () => {
  const read = reader("one\ntwo\n");
  assertEquals(readLine(read), "one");
  assertEquals(readLine(read), "two");
  assertEquals(readLine(read), null);
});

Deno.test("input that ends without a line break is still a line, and none at all is not", () => {
  assertEquals(readLine(reader("unfinished")), "unfinished");
  assertEquals(readLine(reader("")), null);
});

Deno.test("a character whose bytes arrive in separate reads is one character", () => {
  assertEquals(readLine(reader("café → 東京\n")), "café → 東京");
});

Deno.test("on Deno the prompt is Deno's own", () => {
  const original = globalThis.prompt;
  const asked: (string | undefined)[] = [];
  globalThis.prompt = (message) => {
    asked.push(message);
    return "typed";
  };
  try {
    assertEquals(promptLine("--env:"), "typed");
  } finally {
    globalThis.prompt = original;
  }
  assertEquals(asked, ["--env:"]);
});

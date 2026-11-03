// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "./_assert.ts";
import {
  signedKey,
  signingStream,
  verifySigned,
  withoutTrailer,
} from "../src/cache_signing.ts";
import { byteStream } from "../src/compression.ts";

/** `bytes` as a stream delivered in pieces of `size`, unlike the chunk size. */
function pieces(
  bytes: Uint8Array,
  size = 70_001,
): ReadableStream<Uint8Array<ArrayBuffer>> {
  let at = 0;
  return new ReadableStream({
    pull(controller) {
      if (at >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(at, at + size));
      at += size;
    },
  });
}

/** `artifact` with its MAC trailer under `key`, as a signing upload stores it. */
async function sign(
  secret: string,
  key: string,
  artifact: Uint8Array,
): Promise<Uint8Array> {
  return new Uint8Array(
    await new Response(
      byteStream(artifact).pipeThrough(signingStream(secret, key)),
    ).arrayBuffer(),
  );
}

/** All of `stream`'s bytes. */
async function drain(
  stream: ReadableStream<Uint8Array<ArrayBuffer>>,
): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

Deno.test("a MAC trailer binds every byte of a multi-chunk artifact", async () => {
  const artifact = new Uint8Array(2.5 * 1024 * 1024).map((_, i) => i % 251);
  const stored = await sign("s", "k", artifact);
  assertEquals(stored.length, artifact.length + 32);
  assertEquals(stored.slice(0, artifact.length), artifact);
  // However the stream is split, even into pieces smaller than the MAC, the
  // same bytes verify and the trailer comes off cleanly.
  assertEquals(await verifySigned("s", "k", pieces(stored)), true);
  assertEquals(await drain(withoutTrailer(pieces(stored))), artifact);
  const small = artifact.slice(0, 1000);
  const smallStored = await sign("s", "k", small);
  assertEquals(await verifySigned("s", "k", pieces(smallStored, 7)), true);
  assertEquals(await drain(withoutTrailer(pieces(smallStored, 7))), small);
  const mac = stored.slice(artifact.length);
  // A byte flipped in a later chunk, one byte dropped, or one appended: refused.
  const flipped = artifact.slice();
  flipped[2 * 1024 * 1024 + 5] ^= 1;
  for (
    const other of [
      flipped,
      artifact.slice(0, -1),
      new Uint8Array([...artifact, 0]),
    ]
  ) {
    const forged = new Uint8Array([...other, ...mac]);
    assertEquals(await verifySigned("s", "k", byteStream(forged)), false);
  }
  // Another key or another store key does not verify.
  assertEquals(await verifySigned("t", "k", byteStream(stored)), false);
  assertEquals(await verifySigned("s", "k2", byteStream(stored)), false);
});

Deno.test("an empty artifact signs; a blob shorter than a MAC is refused", async () => {
  const stored = await sign("s", "k", new Uint8Array());
  assertEquals(stored.length, 32);
  assertEquals(await verifySigned("s", "k", byteStream(stored)), true);
  assertEquals((await drain(withoutTrailer(byteStream(stored)))).length, 0);
  for (const short of [new Uint8Array(), stored.slice(1)]) {
    assertEquals(await verifySigned("s", "k", byteStream(short)), false);
  }
  assertEquals(signedKey("v2-build-abc"), "v2-build-abc.signed");
});

// The signer used to read one branch of a tee while the upload read the other:
// a slow upload left the tee buffering the whole archive for it.
Deno.test("signing advances only as fast as the upload reads", async () => {
  let produced = 0;
  const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      if (produced === 256) return controller.close();
      produced++;
      controller.enqueue(new Uint8Array(64 * 1024));
    },
  }, { highWaterMark: 0 });
  const reader = source.pipeThrough(signingStream("s", "k")).getReader();
  await reader.read();
  await new Promise((resolve) => setTimeout(resolve, 50)); // a stalled upload
  assertEquals(produced <= 4, true, `produced ${produced} chunks`);
  await reader.cancel();
});

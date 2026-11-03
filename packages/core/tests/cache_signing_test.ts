// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "./_assert.ts";
import {
  signArtifact,
  signatureKey,
  verifyArtifact,
} from "../src/cache_signing.ts";
import { byteStream } from "../src/compression.ts";

/** `bytes` as a stream delivered in uneven pieces, unlike the chunk size. */
function pieces(bytes: Uint8Array): ReadableStream<Uint8Array<ArrayBuffer>> {
  let at = 0;
  return new ReadableStream({
    pull(controller) {
      if (at >= bytes.length) return controller.close();
      const take = 70_001;
      controller.enqueue(bytes.slice(at, at + take));
      at += take;
    },
  });
}

Deno.test("a signature binds every byte of a multi-chunk artifact", async () => {
  const artifact = new Uint8Array(2.5 * 1024 * 1024).map((_, i) => i % 251);
  const sig = await signArtifact("s", "k", byteStream(artifact));
  assertEquals(sig.length, 32);
  // However the stream is split, the same bytes verify.
  assertEquals(await verifyArtifact("s", "k", pieces(artifact), sig), true);
  // A byte flipped in a later chunk, one byte dropped, or one appended: refused.
  const flipped = artifact.slice();
  flipped[2 * 1024 * 1024 + 5] ^= 1;
  const shorter = artifact.slice(0, -1);
  const longer = new Uint8Array([...artifact, 0]);
  for (const other of [flipped, shorter, longer]) {
    assertEquals(await verifyArtifact("s", "k", byteStream(other), sig), false);
  }
  // Another key or another store key does not verify.
  assertEquals(
    await verifyArtifact("t", "k", byteStream(artifact), sig),
    false,
  );
  assertEquals(
    await verifyArtifact("s", "k2", byteStream(artifact), sig),
    false,
  );
});

Deno.test("an empty artifact signs, and the signature lives beside its key", async () => {
  const sig = await signArtifact("s", "k", byteStream(new Uint8Array()));
  assertEquals(
    await verifyArtifact("s", "k", byteStream(new Uint8Array()), sig),
    true,
  );
  assertEquals(signatureKey("v2-build-abc"), "v2-build-abc.sig");
});

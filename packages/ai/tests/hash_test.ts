// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import { sha256Hex, stableHash } from "../src/hash.ts";

Deno.test("stableHash is deterministic for the same input", () => {
  assertEquals(stableHash("hello world"), stableHash("hello world"));
});

Deno.test("stableHash distinguishes different inputs", () => {
  assertEquals(stableHash("a") === stableHash("b"), false);
  // A single-character change must change the token.
  assertEquals(
    stableHash("definitions.js") === stableHash("definitions.ts"),
    false,
  );
});

Deno.test("stableHash emits a lowercase base-36 token", () => {
  const token = stableHash("some cache key\0with a nul");
  assertEquals(token.length > 0, true);
  assertEquals(/^[0-9a-z]+$/.test(token), true);
});

Deno.test("stableHash handles the empty string and unicode without throwing", () => {
  assertEquals(stableHash(""), stableHash(""));
  assertEquals(stableHash("café — ☕") === stableHash("cafe — ☕"), false);
});

Deno.test("stableHash uses the full 64-bit space (tokens exceed 32-bit width)", () => {
  // A 32-bit FNV-1a token is at most 7 base-36 chars (2^32 < 36^7). Across a
  // spread of inputs, a 64-bit hash must produce tokens longer than that,
  // proving the widened space is actually in use.
  let sawWide = false;
  for (let i = 0; i < 200; i++) {
    if (stableHash(`input-${i}-payload`).length > 7) {
      sawWide = true;
      break;
    }
  }
  assertEquals(sawWide, true);
});

Deno.test("sha256Hex digests UTF-8 text to the known lowercase hex", async () => {
  assertEquals(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assertEquals(
    await sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  // One changed byte changes the digest; the same text never does.
  assertEquals(await sha256Hex("abd") === await sha256Hex("abc"), false);
  assertEquals(await sha256Hex("caf\u00e9"), await sha256Hex("caf\u00e9"));
});

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the one base64 encoder the SARIF upload and the contents API
 * share (finding 7 of the homebrew adversarial review: there were two copies).
 *
 * @module
 */

import { assertEquals } from "../../core/tests/_assert.ts";
import { base64 } from "../src/base64.ts";

Deno.test("base64: bytes of every range encode as the standard alphabet", () => {
  assertEquals(base64(new Uint8Array()), "");
  assertEquals(base64(new TextEncoder().encode("hello\n")), "aGVsbG8K");
  // High bytes are bytes, not UTF-16 units: é is two bytes in UTF-8.
  assertEquals(base64(new TextEncoder().encode("é\n")), "w6kK");
  assertEquals(base64(new Uint8Array([0, 255, 254, 128])), "AP/+gA==");
});

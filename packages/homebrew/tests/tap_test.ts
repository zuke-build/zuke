// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for tap-name normalisation: both spellings resolve to the same
 * GitHub repository, and nothing else resolves at all.
 *
 * @module
 */

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import { tapRepository } from "../src/tap.ts";

Deno.test("tap: the short and the repository spelling name the same repository", () => {
  // Finding 5 of the adversarial review: only the repository is ever used,
  // so only the repository is returned.
  assertEquals(tapRepository("acme/tap"), "acme/homebrew-tap");
  assertEquals(tapRepository("acme/homebrew-tap"), "acme/homebrew-tap");
  assertEquals(
    tapRepository("zuke-build/homebrew-tap"),
    "zuke-build/homebrew-tap",
  );
  assertEquals(tapRepository("a_b/x.y"), "a_b/homebrew-x.y");
});

Deno.test("tap: anything that could address another repository is refused", () => {
  for (
    const value of [
      "",
      "acme",
      "acme/tap/extra",
      "../tap",
      "acme/..",
      "acme/x..y",
      "acme/homebrew-",
      "acme/homebrew-/x",
      "/tap",
      "acme/",
      "acme/-tap",
      "acme/tap?x=1",
      "acme/t ap",
      "acme/%2e%2e",
    ]
  ) {
    assertThrows(() => tapRepository(value), Error, "invalid tap");
  }
});

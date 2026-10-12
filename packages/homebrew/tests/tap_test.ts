// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for tap-name normalisation: both spellings resolve to the same
 * GitHub repository, and nothing else resolves at all.
 *
 * @module
 */

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import { tapName } from "../src/tap.ts";

Deno.test("tap: the short and the repository spelling name the same repository", () => {
  const expected = { repo: "acme/homebrew-tap", short: "acme/tap" };
  assertEquals(tapName("acme/tap"), expected);
  assertEquals(tapName("acme/homebrew-tap"), expected);
  assertEquals(tapName("zuke-build/homebrew-tap"), {
    repo: "zuke-build/homebrew-tap",
    short: "zuke-build/tap",
  });
  assertEquals(tapName("a_b/x.y"), {
    repo: "a_b/homebrew-x.y",
    short: "a_b/x.y",
  });
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
    assertThrows(() => tapName(value), Error, "invalid tap");
  }
});

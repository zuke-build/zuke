// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the build's version ordering.
 *
 * The property worth pinning is the one a string comparison gets wrong:
 * `1.10.0` is newer than `1.9.0`, not older. Everything else here is about
 * refusing what cannot be ordered rather than guessing at it.
 *
 * @module
 */

import { assertEquals } from "../packages/core/tests/_assert.ts";
import { compareSemver, isNewerSemver, parseSemver } from "../build/semver.ts";

Deno.test("a plain triple parses, and anything else does not", () => {
  assertEquals(parseSemver("1.2.3"), { major: 1, minor: 2, patch: 3 });
  assertEquals(parseSemver(" 0.33.0 "), { major: 0, minor: 33, patch: 0 });
  // A leading `v` belongs to the caller's input shape, not to this parser.
  assertEquals(parseSemver("v1.2.3"), undefined);
  assertEquals(parseSemver("1.2"), undefined);
  assertEquals(parseSemver("1.2.3-rc.1"), undefined);
  assertEquals(parseSemver("latest"), undefined);
  assertEquals(parseSemver(""), undefined);
});

Deno.test("versions order numerically, not lexically", () => {
  const of = (text: string) => {
    const parsed = parseSemver(text);
    if (parsed === undefined) throw new Error(`unparsable: ${text}`);
    return parsed;
  };
  // The mistake a string sort makes, once the tenth release lands.
  assertEquals(compareSemver(of("1.10.0"), of("1.9.0")) > 0, true);
  assertEquals(compareSemver(of("1.9.0"), of("1.10.0")) < 0, true);
  assertEquals(compareSemver(of("1.2.3"), of("1.2.3")), 0);
  assertEquals(compareSemver(of("2.0.0"), of("1.99.99")) > 0, true);
  assertEquals(compareSemver(of("1.2.4"), of("1.2.3")) > 0, true);
});

Deno.test("isNewerSemver is strict, and refuses what it cannot order", () => {
  assertEquals(isNewerSemver("0.33.0", "0.32.0"), true);
  assertEquals(isNewerSemver("0.32.0", "0.32.0"), false);
  assertEquals(isNewerSemver("0.32.0", "0.33.0"), false);
  // Neither side is ordered against a value this cannot parse: false is the
  // safe answer for a caller using it as a gate.
  assertEquals(isNewerSemver("0.33", "0.32.0"), false);
  assertEquals(isNewerSemver("0.33.0", "nightly"), false);
});

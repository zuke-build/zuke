// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `npmVerify`'s questions to git: whether a package has moved since its release
 * tag, and which commit its provenance must name.
 *
 * @module
 */

import { assertEquals } from "../packages/core/tests/_assert.ts";
import {
  builtCommit,
  changedSinceRelease,
  type GitProbe,
} from "../build/npm_release.ts";

/** A git that knows `tags` (tag to commit) and says `changed` differs since. */
function git(tags: Record<string, string>, changed: string[]): GitProbe {
  return {
    tagCommit: (tag) => Promise.resolve(tags[tag] ?? null),
    changed: () => Promise.resolve(changed),
    head: () => Promise.resolve("headsha"),
  };
}

Deno.test("changedSinceRelease: no tag compares, an unchanged tag compares, a changed one skips", async () => {
  assertEquals(await changedSinceRelease("x", "1.0.0", git({}, ["a"])), null);
  const tagged = { "x-v1.0.0": "tag-commit" };
  assertEquals(await changedSinceRelease("x", "1.0.0", git(tagged, [])), null);
  assertEquals(
    await changedSinceRelease("x", "1.0.0", git(tagged, ["packages/x/a.ts"])),
    "packages/x has changed since x-v1.0.0; check out the tag to verify it.",
  );
  // The provenance must name the tag's commit, else the checkout's.
  assertEquals(await builtCommit("x", "1.0.0", git(tagged, [])), "tag-commit");
  assertEquals(await builtCommit("x", "1.0.0", git({}, [])), "headsha");
});

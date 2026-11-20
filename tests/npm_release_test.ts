// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `npm`'s questions to git: whether a package is still its release tag's
 * source (what `publishNpm` requires) and whether a provenance commit is on
 * master (what `npmVerify` requires), against a fake git.
 *
 * @module
 */

import { assertEquals } from "../packages/core/tests/_assert.ts";
import {
  type AncestryProbe,
  masterCheck,
  type ReleaseProbe,
  releaseSource,
  releaseTag,
} from "../build/npm_release.ts";

const SHA = "a".repeat(40);

/** A git that knows `tags` (tag to commit) and says `changed` differs since. */
function git(
  over: Partial<ReleaseProbe & AncestryProbe> = {},
): ReleaseProbe & AncestryProbe {
  return {
    hasTag: () => Promise.resolve(false),
    changed: () => Promise.resolve([]),
    hasCommit: () => Promise.resolve(true),
    fetchCommit: () => Promise.resolve(),
    hasRef: () => Promise.resolve(true),
    isAncestor: () => Promise.resolve(true),
    ...over,
  };
}

Deno.test("releaseSource: same, changed since the tag, or no tag", async () => {
  const tagged = (changed: string[]) =>
    git({
      hasTag: (tag) => Promise.resolve(tag === releaseTag("x", "1.0.0")),
      changed: (tag, path) => {
        assertEquals([tag, path], ["x-v1.0.0", "packages/x"]);
        return Promise.resolve(changed);
      },
    });
  assertEquals(await releaseSource("x", "1.0.0", tagged([])), "same");
  assertEquals(
    await releaseSource("x", "1.0.0", tagged(["packages/x/a.ts"])),
    "changed",
  );
  assertEquals(await releaseSource("x", "1.0.0", git()), "untagged");
});

Deno.test("masterCheck: an ancestor of origin/master passes, any other commit fails", async () => {
  const asked: string[] = [];
  const check = masterCheck(git({
    isAncestor: (commit, ref) => {
      asked.push(`${commit}..${ref}`);
      return Promise.resolve(commit === SHA);
    },
  }));
  assertEquals(await check(SHA), null);
  assertEquals(await check(SHA), null);
  const other = "b".repeat(40);
  assertEquals(
    await check(other),
    `provenance: commit ${other} is not on origin/master; fetch origin and retry if master is newer than this clone.`,
  );
  // Memoised per commit.
  assertEquals(asked, [`${SHA}..origin/master`, `${other}..origin/master`]);
});

Deno.test("masterCheck: without origin/master it asks HEAD", async () => {
  const asked: string[] = [];
  const check = masterCheck(git({
    hasRef: () => Promise.resolve(false),
    isAncestor: (_c, ref) => {
      asked.push(ref);
      return Promise.resolve(true);
    },
  }));
  assertEquals(await check(SHA), null);
  assertEquals(asked, ["HEAD"]);
});

Deno.test("masterCheck: a missing commit is fetched, and reported when it stays missing", async () => {
  const fetched: string[] = [];
  let present = false;
  const fetching = masterCheck(git({
    hasCommit: () => Promise.resolve(present),
    fetchCommit: (commit) => {
      fetched.push(commit);
      present = true;
      return Promise.resolve();
    },
  }));
  assertEquals(await fetching(SHA), null);
  assertEquals(fetched, [SHA]);
  for (
    const fetchCommit of [
      () => Promise.resolve(),
      () => Promise.reject(new Error("no")),
    ]
  ) {
    const gone = masterCheck(
      git({ hasCommit: () => Promise.resolve(false), fetchCommit }),
    );
    assertEquals(
      await gone(SHA),
      `provenance: commit ${SHA} is not in this clone and could not be fetched; clone the repository with its full history.`,
    );
  }
});

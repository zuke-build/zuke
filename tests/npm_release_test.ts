// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `npm`'s questions to git: whether a package is still its release tag's
 * source (what `publishNpm` requires) and whether a provenance commit is on
 * master (what `npmVerify` requires), against a fake git.
 *
 * @module
 */

import { test } from "./_testing.ts";
import { assertEquals } from "./_assert.ts";
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
    versionAt: () => Promise.resolve(null),
    hasCommit: () => Promise.resolve(true),
    fetchCommit: () => Promise.resolve(),
    hasRef: () => Promise.resolve(true),
    isAncestor: () => Promise.resolve(true),
    ...over,
  };
}

test("releaseSource: same, changed since the tag, or no tag", async () => {
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

test("releaseSource: with no tag yet, HEAD stands in when it is the commit that set the version", async () => {
  const asked: string[] = [];
  const at = (
    versions: Record<string, string | null>,
    changed: string[] = [],
  ) =>
    git({
      versionAt: (rev, pkg) => {
        assertEquals(pkg, "cli");
        return Promise.resolve(versions[rev] ?? null);
      },
      changed: (base) => {
        asked.push(base);
        return Promise.resolve(changed);
      },
    });
  // A draft release: HEAD bumped 2.5.0 to 2.6.0, and is not tagged yet.
  const release = { HEAD: "2.6.0", "HEAD^": "2.5.0" };
  assertEquals(await releaseSource("cli", "2.6.0", at(release)), "same");
  assertEquals(asked, ["HEAD"]);
  assertEquals(
    await releaseSource("cli", "2.6.0", at(release, ["packages/cli/x.ts"])),
    "changed",
  );
  // HEAD^ already had it, HEAD declares another, nothing is readable, or
  // HEAD^ cannot be read at all (a shallow clone): none proves the release.
  const others: Array<Record<string, string>> = [
    { HEAD: "2.6.0", "HEAD^": "2.6.0" },
    { HEAD: "2.7.0", "HEAD^": "2.6.0" },
    {},
    { HEAD: "2.6.0" },
  ];
  for (const versions of others) {
    assertEquals(await releaseSource("cli", "2.6.0", at(versions)), "untagged");
  }
});

test("masterCheck: an ancestor of origin/master passes, any other commit fails", async () => {
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

test("masterCheck: without origin/master it asks HEAD", async () => {
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

test("masterCheck: a missing commit is fetched, and reported when it stays missing", async () => {
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

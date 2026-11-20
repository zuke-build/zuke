// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What git says about a release, for npm: whether a package's source is still
 * the source of its release tag (the condition for `publishNpm` to publish it),
 * and whether a commit named by a provenance statement is on master (a
 * condition for `npmVerify` to rebuild from it).
 */

import { GitTasks } from "@zuke/git";
import { dig } from "./npm_json.ts";

/** What {@link releaseSource} asks git. */
export interface ReleaseProbe {
  /** Whether `tag` is in this clone and points at a commit. */
  hasTag(tag: string): Promise<boolean>;
  /**
   * The paths under `path` whose checkout differs from `tag` (a tag or any
   * revision): committed,
   * staged, unstaged or untracked, since the build reads the working tree.
   */
  changed(tag: string, path: string): Promise<string[]>;
  /**
   * The version `packages/<pkg>/deno.json` declares at `rev`, or `null` when
   * that file or its version is not there.
   */
  versionAt(rev: string, pkg: string): Promise<string | null>;
}

/** What {@link masterCheck} asks git. */
export interface AncestryProbe {
  /** Whether `commit` is an object of this clone. */
  hasCommit(commit: string): Promise<boolean>;
  /** Fetch `commit` from `origin`; rejects when that is not possible. */
  fetchCommit(commit: string): Promise<void>;
  /** Whether `ref` resolves in this clone. */
  hasRef(ref: string): Promise<boolean>;
  /** Whether `commit` is reachable from `ref`. */
  isAncestor(commit: string, ref: string): Promise<boolean>;
}

/** Whether a quiet `git rev-parse --verify <rev>^{commit}` finds `rev`. */
async function resolves(rev: string): Promise<boolean> {
  const found = await GitTasks.revParse((s) =>
    s.verify().rev(`${rev}^{commit}`).noThrow().quiet()
  );
  return found.code === 0;
}

const GIT: ReleaseProbe & AncestryProbe = {
  hasTag: (tag) => resolves(`refs/tags/${tag}`),
  async versionAt(rev, pkg) {
    try {
      const text = await GitTasks.blobText((s) =>
        s.object(`${rev}:packages/${pkg}/deno.json`).quiet()
      );
      const version: unknown = dig(JSON.parse(text), "version");
      return typeof version === "string" ? version : null;
    } catch {
      return null;
    }
  },
  // One rev diffs the tag against the working tree, so staged and unstaged
  // edits count; status adds the untracked files a diff never lists.
  changed: async (tag, path) => [
    ...await GitTasks.diffNames((s) => s.commits(tag).paths(path).quiet()),
    ...(await GitTasks.statusEntries((s) =>
      s.paths(path).untrackedFiles("all").quiet()
    )).filter((e) => e.index === "?").map((e) => e.path),
  ],
  hasCommit: resolves,
  async fetchCommit(commit) {
    await GitTasks.fetch((s) => s.remote("origin").refspec(commit).noTags());
  },
  hasRef: resolves,
  isAncestor: (commit, ref) =>
    GitTasks.isAncestor((s) => s.commits(commit, ref)),
};

/**
 * Where `pkg`@`version`'s release source stands, for npm. JSR carries what its
 * release tag (`<pkg>-v<version>`) holds, and `publishNpm` builds from the
 * checkout, so npm gets the same source only when the tag exists in this clone
 * and the checkout of `packages/<pkg>`, working tree included, has not changed
 * since:
 * - `same`: it may be published;
 * - `changed`: the package changed after its release, so this version waits
 *   for the package's next release, which tags this source;
 * - `untagged`: the tag is missing, which a released version never is.
 */
export type ReleaseSource = "same" | "changed" | "untagged";

/**
 * The {@link ReleaseSource} of `pkg`@`version` in this clone. The source is
 * compared with the release tag, or, while the tag is not there yet, with
 * `HEAD` when `HEAD` is the release commit that set this version: a draft
 * release (the CLI's, until its binaries are attached) is tagged only when it
 * is published, after the npm job has run.
 */
export async function releaseSource(
  pkg: string,
  version: string,
  git: ReleaseProbe = GIT,
): Promise<ReleaseSource> {
  const tag = releaseTag(pkg, version);
  let base: string;
  if (await git.hasTag(tag)) base = tag;
  else if (
    await git.versionAt("HEAD", pkg) === version &&
    await git.versionAt("HEAD^", pkg) !== version
  ) base = "HEAD";
  else return "untagged";
  return (await git.changed(base, `packages/${pkg}`)).length === 0
    ? "same"
    : "changed";
}

/** The tag release-please gives `pkg`@`version`. */
export function releaseTag(pkg: string, version: string): string {
  return `${pkg}-v${version}`;
}

/**
 * A check, memoised per commit, of why a commit is not on master, or `null`
 * when it is. A commit missing from the clone is fetched from `origin` first,
 * and failing that is reported. It is on master when it is an ancestor of
 * `origin/master`, the authoritative branch; a clone without that ref (the
 * release job's checkout of master has only `HEAD`) falls back to `HEAD`. The
 * fallback cannot admit a commit that is not on master: the signed certificate
 * already pins the workflow's ref to `refs/heads/master`, so this is the second
 * line of that check, and a `HEAD` on a branch only makes it stricter.
 */
export function masterCheck(
  git: AncestryProbe = GIT,
): (commit: string) => Promise<string | null> {
  const seen = new Map<string, Promise<string | null>>();
  const check = async (commit: string): Promise<string | null> => {
    if (!await git.hasCommit(commit)) {
      try {
        await git.fetchCommit(commit);
      } catch {
        // Reported below, with the clone's state.
      }
      if (!await git.hasCommit(commit)) {
        return `provenance: commit ${commit} is not in this clone and could ` +
          "not be fetched; clone the repository with its full history.";
      }
    }
    const ref = await git.hasRef("origin/master") ? "origin/master" : "HEAD";
    return await git.isAncestor(commit, ref)
      ? null
      : `provenance: commit ${commit} is not on ${ref}; ` +
        "fetch origin and retry if master is newer than this clone.";
  };
  return (commit) => {
    let answer = seen.get(commit);
    if (answer === undefined) {
      answer = check(commit);
      seen.set(commit, answer);
    }
    return answer;
  };
}

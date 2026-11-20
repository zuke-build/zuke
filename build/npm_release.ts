// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What git says about a release, for npm: whether a package's source is still
 * the source of its release tag (the condition for `publishNpm` to publish it),
 * and whether a commit named by a provenance statement is on master (a
 * condition for `npmVerify` to rebuild from it).
 */

import { GitTasks } from "@zuke/git";

/** The questions {@link releaseSourceProblem} and {@link masterCheck} ask git. */
export interface GitProbe {
  /** Whether `tag` is in this clone and points at a commit. */
  hasTag(tag: string): Promise<boolean>;
  /** The paths under `path` that differ between `tag` and `HEAD`. */
  changed(tag: string, path: string): Promise<string[]>;
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

const GIT: GitProbe = {
  hasTag: (tag) => resolves(`refs/tags/${tag}`),
  changed: (tag, path) =>
    GitTasks.diffNames((s) => s.commits(tag, "HEAD").paths(path)),
  hasCommit: resolves,
  async fetchCommit(commit) {
    await GitTasks.fetch((s) => s.remote("origin").refspec(commit).noTags());
  },
  hasRef: resolves,
  isAncestor: (commit, ref) =>
    GitTasks.isAncestor((s) => s.commits(commit, ref)),
};

/**
 * Why `pkg`@`version` may not go to npm, or `null` when it may: JSR carries
 * what its release tag (`<pkg>-v<version>`) holds, and `publishNpm` builds from
 * the checkout, so npm gets the same source only when the tag exists in this
 * clone and `packages/<pkg>` has not changed since.
 */
export async function releaseSourceProblem(
  pkg: string,
  version: string,
  git: GitProbe = GIT,
): Promise<string | null> {
  const tag = `${pkg}-v${version}`;
  const same = await git.hasTag(tag) &&
    (await git.changed(tag, `packages/${pkg}`)).length === 0;
  return same ? null : `packages/${pkg} changed since ${tag}, or there is no ` +
    `such tag; npm would get different source than JSR's @zuke/${pkg}@${version}.`;
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
  git: GitProbe = GIT,
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

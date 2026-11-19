// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What git says about a package's release: whether its source has moved since
 * its tag, and which commit its provenance must name.
 */

import { GitTasks } from "@zuke/git";

/** The two questions {@link changedSinceRelease} asks git. */
export interface GitProbe {
  /** The commit `tag` points to, or `null` when the tag is not in this clone. */
  tagCommit(tag: string): Promise<string | null>;
  /** The commit this checkout is at. */
  head(): Promise<string>;
  /** The paths under `path` that differ between `tag` and `HEAD`. */
  changed(tag: string, path: string): Promise<string[]>;
}

const GIT: GitProbe = {
  async tagCommit(tag) {
    const found = await GitTasks.revParse((s) =>
      s.verify().rev(`refs/tags/${tag}^{commit}`).noThrow().quiet()
    );
    return found.code === 0 ? found.stdout.trim() : null;
  },
  head: () => GitTasks.revision((s) => s.rev("HEAD")),
  changed: (tag, path) =>
    GitTasks.diffNames((s) => s.commits(tag, "HEAD").paths(path)),
};

/**
 * Why `pkg`'s source cannot be compared at `version`, or `null` when it can:
 * its release tag (`<pkg>-v<version>`) exists in this clone and `packages/<pkg>`
 * has changed since. The published bytes are what the *tag* compiles to, so a
 * checkout with unreleased changes to the package would "mismatch" by design.
 * A clone without the tag is compared anyway.
 */
export async function changedSinceRelease(
  pkg: string,
  version: string,
  git: GitProbe = GIT,
): Promise<string | null> {
  const tag = `${pkg}-v${version}`;
  if (await git.tagCommit(tag) === null) return null;
  return (await git.changed(tag, `packages/${pkg}`)).length === 0
    ? null
    : `packages/${pkg} has changed since ${tag}; check out the tag to verify it.`;
}

/**
 * The commit `pkg`@`version`'s provenance must name: its release tag's commit
 * when this clone has the tag (the version was built there, and
 * {@link changedSinceRelease} has said the package is unchanged since), else
 * the commit checked out, which is the release itself when run on a tag.
 */
export async function builtCommit(
  pkg: string,
  version: string,
  git: GitProbe = GIT,
): Promise<string> {
  return await git.tagCommit(`${pkg}-v${version}`) ?? await git.head();
}

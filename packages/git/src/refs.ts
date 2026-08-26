// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Ref-name handling shared by the tasks that read refs back out of git.
 *
 * Internal to the package: not exported from `mod.ts`. It exists so the
 * `refs/heads/` prefix is stripped in exactly one place, whether the ref came
 * from a worktree listing or from a remote's `HEAD`.
 *
 * @module
 */

/** The prefix git reports a local branch ref under. */
const HEADS = "refs/heads/";

/**
 * A branch ref with its `refs/heads/` prefix removed. Anything else — a
 * remote-tracking ref, a tag, a bare name — is returned unchanged, so the
 * caller never has to guess whether stripping happened.
 */
export function shortBranchName(ref: string): string {
  return ref.startsWith(HEADS) ? ref.slice(HEADS.length) : ref;
}

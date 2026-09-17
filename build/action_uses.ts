// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Reading `uses:` pins out of a workflow or an action manifest.
 *
 * Its own module because two callers need it and neither may import the other.
 * {@link "./action_pins.ts"} collects the pins the workflow generator writes
 * from, and {@link "./action_notes.ts"} diffs them between two revisions of
 * `action.yml` to say which action a release bumps. Putting the reader in
 * either one would have made `action_release.ts` → `action_notes.ts` →
 * `action_pins.ts` → `action_release.ts` a cycle; a second copy of the pattern
 * would have been worse, since the two copies would answer differently the
 * first time one of them learned about a new `uses:` spelling.
 *
 * @module
 */

/** One `uses:` pin: the action, the SHA it names, and the version beside it. */
export interface UsesPin {
  /** The action, with any subpath — `github/codeql-action/init`. */
  action: string;
  /** The pinned reference, `<action>@<40-character-sha>`. */
  ref: string;
  /** The `# vX.Y.Z` comment beside the pin, when it carries one. */
  version?: string;
}

/**
 * A `uses:` line: the action (with any subpath), its pinned SHA, and the
 * version comment beside it. Anchored to `uses:` so a SHA mentioned in prose is
 * ignored.
 */
export const USES_LINE =
  /^\s*(?:-\s+)?uses:\s*([\w.-]+\/[\w.\-/]+)@([0-9a-f]{40})\s*(?:#\s*(\S+))?/;

/**
 * Every pinned `uses:` in `text`, keyed by action.
 *
 * Only SHA pins are matched. A floating `uses: actions/checkout@v4` is not a
 * pin, and reporting one here would let it pass for a value this repository
 * never generates.
 */
export function usesPins(text: string): Map<string, UsesPin> {
  const found = new Map<string, UsesPin>();
  for (const line of text.split("\n")) {
    const match = USES_LINE.exec(line);
    if (match === null) continue;
    const [, action, sha, version] = match;
    found.set(action, { action, ref: `${action}@${sha}`, version });
  }
  return found;
}

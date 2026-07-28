/**
 * The gate's lock-integrity check.
 *
 * `deno.lock` is committed, and a green gate is supposed to mean *the committed
 * lock resolves*. The failure mode this guards against is the opposite: a step
 * silently rewrites the lock to add a resolution it was missing, so the gate
 * passes precisely because it healed the file — while CI, whose checkout has the
 * committed lock, fails later with "The lockfile is out of date".
 *
 * Every entrypoint that loads `zuke.ts` now passes `--frozen`, which stops the
 * rewrite at its most common source. `deno task` resolves the workspace before
 * it runs the task's command, though, so `deno task ci` can still heal the lock
 * before a frozen inner run ever starts. This check closes that gap from the
 * other side: rather than trying to prevent every writer, it asserts afterwards
 * that the run left the lock alone.
 *
 * @module
 */

import { GitTasks } from "@zuke/git";

/** The lock file whose integrity the gate asserts. */
export const LOCK_FILE = "deno.lock";

/**
 * Whether a `git status --porcelain` listing reports {@link LOCK_FILE} as
 * changed. Pure — it takes the listing as text — so the branch table is
 * unit-testable without a repository.
 *
 * Porcelain v1 lines are two status characters, a space, then the path; a rename
 * renders as `old -> new`, so the destination is what matters. An untracked lock
 * (`?? deno.lock`) counts as changed too.
 */
export function lockIsDirty(
  porcelain: string,
  lockFile: string = LOCK_FILE,
): boolean {
  for (const line of porcelain.split("\n")) {
    if (line.length <= 3) continue;
    const entry = line.slice(3).trim();
    const arrow = entry.lastIndexOf(" -> ");
    const path = arrow === -1 ? entry : entry.slice(arrow + 4);
    const unquoted = path.startsWith('"') && path.endsWith('"')
      ? path.slice(1, -1)
      : path;
    if (unquoted === lockFile || unquoted.endsWith(`/${lockFile}`)) return true;
  }
  return false;
}

/** The guidance shown when the run rewrote the lock. */
export function lockDriftMessage(lockFile: string = LOCK_FILE): string {
  return `${lockFile} changed while the gate ran, so this run does not prove ` +
    `the committed lock resolves — something rewrote it to add a missing ` +
    `resolution.\nCommit the rewrite (review the diff first), or, if you did ` +
    `not intend a dependency change, restore it with \`git checkout -- ` +
    `${lockFile}\` and find what wrote it. Regenerate deliberately with ` +
    `\`deno task lock\`. See docs/versioning.md.`;
}

/**
 * Assert the run has not modified {@link LOCK_FILE}, throwing
 * {@link lockDriftMessage} when it has.
 *
 * Skips silently when `git status` cannot report — an exported tarball or a
 * checkout without git is not a lock problem, and the gate must stay usable
 * there.
 */
export async function assertLockUnchanged(
  lockFile: string = LOCK_FILE,
): Promise<void> {
  const status = await GitTasks.status((s) => s.porcelain().noThrow());
  if (status.code !== 0) return;
  if (!lockIsDirty(status.text(), lockFile)) return;
  throw new Error(lockDriftMessage(lockFile));
}

/**
 * Committing applied fix edits and pushing them to the current branch. Used by
 * the {@link "./fixer.ts".AiFixer} when `.commitFixes()` is set so a healed PR
 * carries the fix as a commit. All git calls go through an injected runner so
 * the behaviour is unit-testable without a real repository.
 *
 * @module
 */

/** Runs a git argv and resolves to its stdout (the fixer's `git` seam). */
export type GitRunner = (argv: string[]) => Promise<string>;

/** How to commit (and optionally push) a fix. */
export interface CommitOptions {
  /** The paths to stage and commit. */
  paths: string[];
  /** The commit message subject. */
  message: string;
  /** Push to the current branch after committing (default true). */
  push?: boolean;
  /** The git runner. */
  run: GitRunner;
}

/**
 * Stage the given paths, commit them with `message`, and (unless `push` is
 * false) push to the current branch's upstream. A no-op when `paths` is empty.
 * Errors from any git call propagate to the caller, which reports them.
 */
export async function commitAndPush(options: CommitOptions): Promise<void> {
  if (options.paths.length === 0) return;
  await options.run(["git", "add", "--", ...options.paths]);
  await options.run(["git", "commit", "-m", options.message]);
  if (options.push !== false) {
    await options.run(["git", "push"]);
  }
}

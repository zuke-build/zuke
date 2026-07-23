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
  // `--literal-pathspecs` disables pathspec magic (`:(glob)`, `:/`, …) so a path
  // that slipped a guard can only ever stage that literal file, never sweep the
  // tree. Defence in depth with normalizePath's leading-`:` rejection.
  await options.run([
    "git",
    "--literal-pathspecs",
    "add",
    "--",
    ...options.paths,
  ]);
  await options.run(["git", "commit", "-m", options.message]);
  if (options.push !== false) {
    await options.run(["git", "push"]);
  }
}

/**
 * The paths reported dirty by `git status --porcelain`. Each line is
 * `XY <path>` (or, only for a rename/copy — status `R`/`C` — `XY <old> -> <new>`,
 * where the *new* path is taken). The ` -> ` split is gated on the status code
 * so an ordinary file whose name literally contains ` -> ` isn't mis-parsed.
 * Blank lines are ignored.
 *
 * caveat: paths git would quote (non-ASCII under `core.quotePath`, or names
 * with control chars) come back quoted and won't stage — fail-safe (the fix is
 * reported failed, nothing wrong is committed); upgrade to `--porcelain=v2 -z`
 * if exotic filenames need committing.
 */
export function porcelainPaths(status: string): string[] {
  const paths: string[] = [];
  for (const line of status.split("\n")) {
    if (line.trim() === "") continue;
    const code = line.slice(0, 2); // the XY status columns
    const rest = line.slice(3); // drop the two status columns and the space
    const renamed = code.includes("R") || code.includes("C");
    const arrow = renamed ? rest.indexOf(" -> ") : -1;
    paths.push(arrow === -1 ? rest : rest.slice(arrow + 4));
  }
  return paths;
}

/** How to commit only the changes an agent newly introduced. */
export interface CommitChangedOptions {
  /**
   * Paths already dirty **before** the agent ran (from {@link porcelainPaths}).
   * These are the developer's own working-tree changes and are left untouched.
   */
  before: string[];
  /** The commit message subject. */
  message: string;
  /** Push to the current branch after committing (default true). */
  push?: boolean;
  /** The git runner. */
  run: GitRunner;
}

/**
 * Stage, commit, and (unless `push` is false) push **only the paths the agent
 * newly changed** — those dirty now but not in `before`. The agent fixer lets a
 * coding agent edit files autonomously, so this scopes the commit to its work
 * and never sweeps a developer's unrelated working-tree changes into (or pushes
 * them with) the fix. A no-op when nothing new changed, so it never makes an
 * empty commit.
 *
 * Ceiling: a file already dirty before the agent ran is left to the developer
 * even if the agent edited it further — deliberately, since committing their
 * pre-existing changes to that file would be worse than under-committing.
 */
export async function commitChanged(
  options: CommitChangedOptions,
): Promise<void> {
  const status = await options.run(["git", "status", "--porcelain"]);
  const before = new Set(options.before);
  const paths = porcelainPaths(status).filter((p) => !before.has(p));
  await commitAndPush({
    paths,
    message: options.message,
    push: options.push,
    run: options.run,
  });
}

/**
 * `gitInfo()` — resolve the current repository's branch, commit, nearest tag,
 * dirty state, and origin URL. Useful for versioning and conditional build
 * steps, e.g. `publish.onlyWhen(async () => (await gitInfo()).branch === "main")`.
 *
 * ```ts
 * import { gitInfo } from "jsr:@zuke/git";
 *
 * const git = await gitInfo();
 * console.log(`${git.branch} @ ${git.shortCommit}${git.dirty ? " (dirty)" : ""}`);
 * ```
 *
 * The git invocations go through an injectable {@link GitRunner} (defaulting to
 * spawning `git`), so the logic is unit-testable without a real repository.
 *
 * @module
 */

/** Resolved git repository information. */
export interface GitInfo {
  /** Current branch, or `"HEAD"` when detached. */
  branch: string;
  /** Full commit SHA of `HEAD`. */
  commit: string;
  /** Abbreviated commit SHA. */
  shortCommit: string;
  /** The nearest tag (`git describe --tags --abbrev=0`), if any. */
  tag?: string;
  /** Whether the working tree has uncommitted changes. */
  dirty: boolean;
  /** The `origin` remote URL, if configured. */
  remoteUrl?: string;
}

/**
 * Runs a `git` subcommand and resolves to its trimmed stdout, or `null` when
 * the command fails (non-zero exit, or `git` unavailable).
 */
export type GitRunner = (args: string[]) => Promise<string | null>;

/** Options for {@link gitInfo}. */
export interface GitInfoOptions {
  /** Directory to inspect (defaults to the current directory). */
  cwd?: string;
  /** Override how git is invoked (defaults to spawning `git`); for testing. */
  run?: GitRunner;
}

/** A {@link GitRunner} that spawns the real `git` binary in `cwd`. */
function defaultRunner(cwd?: string): GitRunner {
  return async (args: string[]): Promise<string | null> => {
    try {
      const command = new Deno.Command("git", {
        args,
        cwd,
        stdout: "piped",
        stderr: "null",
      });
      const { code, stdout } = await command.output();
      if (code !== 0) return null;
      return new TextDecoder().decode(stdout).trim();
    } catch {
      return null; // git not installed, or no permission to run it
    }
  };
}

/** Normalize an empty/`null` runner result to `undefined`. */
function optional(value: string | null): string | undefined {
  return value === null || value === "" ? undefined : value;
}

/**
 * Resolve {@link GitInfo} for the repository at `cwd`. Throws if `cwd` is not a
 * git repository (or `git` is unavailable). Optional fields (`tag`, `remoteUrl`)
 * are `undefined` when absent.
 */
export async function gitInfo(options: GitInfoOptions = {}): Promise<GitInfo> {
  const run = options.run ?? defaultRunner(options.cwd);

  const commit = await run(["rev-parse", "HEAD"]);
  if (commit === null) {
    throw new Error("gitInfo: not a git repository, or git is unavailable.");
  }
  const branch = await run(["rev-parse", "--abbrev-ref", "HEAD"]) ?? "HEAD";
  const shortCommit = await run(["rev-parse", "--short", "HEAD"]) ??
    commit.slice(0, 7);
  const status = await run(["status", "--porcelain"]);

  return {
    branch,
    commit,
    shortCommit,
    tag: optional(await run(["describe", "--tags", "--abbrev=0"])),
    dirty: status !== null && status !== "",
    remoteUrl: optional(await run(["config", "--get", "remote.origin.url"])),
  };
}

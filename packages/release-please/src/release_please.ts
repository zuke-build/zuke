/**
 * `ReleasePleaseTasks` — typed task functions for
 * [release-please](https://github.com/googleapis/release-please), in the same
 * settings-lambda style as the other Zuke tool wrappers: configure a fluent
 * settings object in a lambda, and the task function builds the command line and
 * executes it.
 *
 * ```ts
 * import { ReleasePleaseTasks } from "jsr:@zuke/release-please";
 *
 * await ReleasePleaseTasks.releasePr((s) =>
 *   s.token(token).repoUrl("owner/repo").targetBranch("main"));
 * await ReleasePleaseTasks.githubRelease((s) =>
 *   s.token(token).repoUrl("owner/repo").targetBranch("main"));
 * ```
 *
 * The binary is `release-please` from PATH (release-please ships only on npm, so
 * install it first — e.g. with `DenoTasks.install` or `npm` — and point the
 * wrapper at it with `.toolPath(...)`). Arguments stay a discrete argv array
 * end-to-end — never a concatenated shell string — so command construction is
 * injection-free.
 *
 * @module
 */

import {
  type Configure,
  type PathLike,
  runSettings,
  ToolSettings,
} from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/**
 * Shared base for release-please subcommands. Each subcommand contributes its
 * leading token via {@link subcommand}; the common `--token`/`--repo-url`/… flags
 * live here since `release-pr` and `github-release` accept the same set.
 */
abstract class ReleasePleaseSettings extends ToolSettings {
  #token?: string;
  #repoUrl?: string;
  #targetBranch?: string;
  #configFile?: string;
  #manifestFile?: string;
  #dryRun = false;
  #debug = false;

  protected override defaultTool(): string {
    return "release-please";
  }

  /** The subcommand token, e.g. `release-pr`. */
  protected abstract subcommand(): string;

  /** GitHub access token (`--token`). */
  token(value: string): this {
    this.#token = value;
    return this;
  }

  /** The repository, as `owner/repo` or a URL (`--repo-url`). */
  repoUrl(value: string): this {
    this.#repoUrl = value;
    return this;
  }

  /** The branch to release from (`--target-branch`). */
  targetBranch(value: string): this {
    this.#targetBranch = value;
    return this;
  }

  /** Path to the release-please config file (`--config-file`). */
  configFile(path: PathLike): this {
    this.#configFile = String(path);
    return this;
  }

  /** Path to the release-please manifest file (`--manifest-file`). */
  manifestFile(path: PathLike): this {
    this.#manifestFile = String(path);
    return this;
  }

  /** Print actions without performing them (`--dry-run`). */
  dryRun(): this {
    this.#dryRun = true;
    return this;
  }

  /** Emit verbose debug logging (`--debug`). */
  debug(): this {
    this.#debug = true;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = [this.subcommand()];
    if (this.#token !== undefined) argv.push("--token", this.#token);
    if (this.#repoUrl !== undefined) argv.push("--repo-url", this.#repoUrl);
    if (this.#targetBranch !== undefined) {
      argv.push("--target-branch", this.#targetBranch);
    }
    if (this.#configFile !== undefined) {
      argv.push("--config-file", this.#configFile);
    }
    if (this.#manifestFile !== undefined) {
      argv.push("--manifest-file", this.#manifestFile);
    }
    if (this.#dryRun) argv.push("--dry-run");
    if (this.#debug) argv.push("--debug");
    return argv;
  }
}

/** Settings for `release-please release-pr` (maintain the release PR). */
export class ReleasePleaseReleasePrSettings extends ReleasePleaseSettings {
  protected override subcommand(): string {
    return "release-pr";
  }
}

/** Settings for `release-please github-release` (cut releases and tags). */
export class ReleasePleaseGithubReleaseSettings extends ReleasePleaseSettings {
  protected override subcommand(): string {
    return "github-release";
  }
}

/** The shape of {@link ReleasePleaseTasks}. */
export interface ReleasePleaseTasksApi {
  /** Create or update the release PR: `release-please release-pr`. */
  releasePr(
    configure?: Configure<ReleasePleaseReleasePrSettings>,
  ): Promise<CommandOutput>;
  /** Cut GitHub releases and tags: `release-please github-release`. */
  githubRelease(
    configure?: Configure<ReleasePleaseGithubReleaseSettings>,
  ): Promise<CommandOutput>;
}

/** Typed task functions for the `release-please` CLI. */
export const ReleasePleaseTasks: ReleasePleaseTasksApi = {
  releasePr(
    configure?: Configure<ReleasePleaseReleasePrSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new ReleasePleaseReleasePrSettings(), configure);
  },
  githubRelease(
    configure?: Configure<ReleasePleaseGithubReleaseSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new ReleasePleaseGithubReleaseSettings(), configure);
  },
};

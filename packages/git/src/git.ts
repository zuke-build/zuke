// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `GitTasks` — typed task functions for the common `git` commands, in the same
 * settings-lambda style as the other Zuke tool wrappers: configure a fluent
 * settings object in a lambda, and the task function builds the command line
 * and executes it.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * await GitTasks.add((s) => s.all());
 * await GitTasks.commit((s) => s.message("ci: release"));
 * await GitTasks.push((s) => s.setUpstream().remote("origin").ref("main"));
 * ```
 *
 * Every command shares the global options `.dir()` (`-C <path>`) and `.config()`
 * (`-c key=value`). For anything without a typed task, use {@link GitTasks.run}
 * with `.command(...)`. Arguments stay a discrete argv array end-to-end — never
 * a concatenated shell string — so command construction is injection-free.
 *
 * @module
 */

import { type Configure, type PathLike, runSettings } from "@zuke/core/tooling";
import { GitSettings } from "./settings.ts";
import type { CommandOutput } from "@zuke/core/shell";
import {
  type GitWorktree,
  GitWorktreeSettings,
  parseWorktreeList,
} from "./worktree.ts";
import {
  type GitDefaultBranchSettings,
  resolveDefaultBranch,
} from "./default_branch.ts";

/** Settings for `git init`. */
export class GitInitSettings extends GitSettings {
  #bare = false;
  #initialBranch?: string;

  /** Create a bare repository (`--bare`). */
  bare(): this {
    this.#bare = true;
    return this;
  }

  /** Name the initial branch (`-b`/`--initial-branch`). */
  initialBranch(name: string): this {
    this.#initialBranch = name;
    return this;
  }

  /** Assemble the `git init` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["init"];
    if (this.#bare) argv.push("--bare");
    if (this.#initialBranch !== undefined) {
      argv.push("-b", this.#initialBranch);
    }
    return argv;
  }
}

/** Settings for `git clone`. */
export class GitCloneSettings extends GitSettings {
  #repository?: string;
  #directory?: string;
  #branch?: string;
  #depth?: number;
  #bare = false;

  /** The repository URL to clone (required). */
  repository(url: string): this {
    this.#repository = url;
    return this;
  }

  /** Target directory for the clone. */
  directory(path: PathLike): this {
    this.#directory = String(path);
    return this;
  }

  /** Check out a specific branch (`-b`/`--branch`). */
  branch(name: string): this {
    this.#branch = name;
    return this;
  }

  /** Create a shallow clone of the given depth (`--depth`). */
  depth(commits: number): this {
    this.#depth = commits;
    return this;
  }

  /** Clone a bare repository (`--bare`). */
  bare(): this {
    this.#bare = true;
    return this;
  }

  /** Assemble the `git clone` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#repository === undefined) {
      throw new Error("GitTasks.clone: .repository() is required.");
    }
    const argv = ["clone"];
    if (this.#branch !== undefined) argv.push("-b", this.#branch);
    if (this.#depth !== undefined) argv.push("--depth", String(this.#depth));
    if (this.#bare) argv.push("--bare");
    argv.push(this.#repository);
    if (this.#directory !== undefined) argv.push(this.#directory);
    return argv;
  }
}

/** Settings for `git add`. */
export class GitAddSettings extends GitSettings {
  #paths: string[] = [];
  #all = false;
  #update = false;

  /** Paths/pathspecs to stage (positional); repeatable. */
  paths(...values: PathLike[]): this {
    this.#paths.push(...values.map(String));
    return this;
  }

  /** Stage all changes including new files (`-A`/`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Stage modifications and deletions, but not new files (`-u`/`--update`). */
  update(): this {
    this.#update = true;
    return this;
  }

  /** Assemble the `git add` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["add"];
    if (this.#all) argv.push("--all");
    if (this.#update) argv.push("--update");
    // `--` so a pathspec beginning with `-` (e.g. `-weird.txt`) is treated as a
    // path, not parsed by git as a flag. `add` positionals are always pathspecs.
    if (this.#paths.length > 0) argv.push("--", ...this.#paths);
    return argv;
  }
}

/** Settings for `git commit`. */
export class GitCommitSettings extends GitSettings {
  #message?: string;
  #all = false;
  #amend = false;
  #noEdit = false;
  #allowEmpty = false;

  /** The commit message (`-m`). */
  message(text: string): this {
    this.#message = text;
    return this;
  }

  /** Stage modified/deleted files before committing (`-a`/`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Amend the previous commit (`--amend`). */
  amend(): this {
    this.#amend = true;
    return this;
  }

  /** Keep the existing message when amending (`--no-edit`). */
  noEdit(): this {
    this.#noEdit = true;
    return this;
  }

  /** Allow a commit with no changes (`--allow-empty`). */
  allowEmpty(): this {
    this.#allowEmpty = true;
    return this;
  }

  /** Assemble the `git commit` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["commit"];
    if (this.#all) argv.push("--all");
    if (this.#amend) argv.push("--amend");
    if (this.#noEdit) argv.push("--no-edit");
    if (this.#allowEmpty) argv.push("--allow-empty");
    if (this.#message !== undefined) argv.push("-m", this.#message);
    return argv;
  }
}

/** Settings for `git status`. */
export class GitStatusSettings extends GitSettings {
  #short = false;
  #porcelain = false;
  #branch = false;

  /** Short-format output (`-s`/`--short`). */
  short(): this {
    this.#short = true;
    return this;
  }

  /** Stable machine-readable output (`--porcelain`). */
  porcelain(): this {
    this.#porcelain = true;
    return this;
  }

  /** Show branch information (`-b`/`--branch`). */
  branch(): this {
    this.#branch = true;
    return this;
  }

  /** Assemble the `git status` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["status"];
    if (this.#short) argv.push("--short");
    if (this.#porcelain) argv.push("--porcelain");
    if (this.#branch) argv.push("--branch");
    return argv;
  }
}

/** Settings for `git checkout`. */
export class GitCheckoutSettings extends GitSettings {
  #ref?: string;
  #paths: string[] = [];
  #create = false;
  #force = false;

  /**
   * The branch or commit to check out — or, with {@link paths}, the source to
   * restore those paths from. Required unless {@link paths} is given.
   */
  ref(target: string): this {
    this.#ref = target;
    return this;
  }

  /**
   * Restore one or more paths (`git checkout [<ref>] -- <paths>`). The `--`
   * separates paths from any ref so a path is never misread as a branch name;
   * repeatable. With no {@link ref}, restores the paths from the index
   * (discarding working-tree changes).
   */
  paths(...paths: string[]): this {
    this.#paths.push(...paths);
    return this;
  }

  /** Create a new branch (`-b`). */
  create(): this {
    this.#create = true;
    return this;
  }

  /** Force checkout, discarding local changes (`-f`/`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Assemble the `git checkout` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#ref === undefined && this.#paths.length === 0) {
      throw new Error("GitTasks.checkout: .ref() or .paths(...) is required.");
    }
    if (this.#create && this.#paths.length > 0) {
      throw new Error(
        "GitTasks.checkout: .create() cannot be combined with .paths(...) — " +
          "`git checkout -b` creates a branch, it does not restore files.",
      );
    }
    const argv = ["checkout"];
    // `--force` must precede `-b`: `git checkout -b --force <ref>` makes git read
    // `--force` as the new branch name (`cannot be created`), so force comes first.
    if (this.#force) argv.push("--force");
    if (this.#create) argv.push("-b");
    if (this.#ref !== undefined) argv.push(this.#ref);
    // `-- <paths>` last so git never treats a path as a ref (mirrors `add`).
    if (this.#paths.length > 0) argv.push("--", ...this.#paths);
    return argv;
  }
}

/** Settings for `git branch`. */
export class GitBranchSettings extends GitSettings {
  #name?: string;
  #delete?: "soft" | "force";
  #all = false;

  /** The branch name to create or operate on. */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** Delete the branch (`-d`, or `-D` when forced). */
  deleteBranch(force = false): this {
    this.#delete = force ? "force" : "soft";
    return this;
  }

  /** List both local and remote-tracking branches (`-a`/`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Assemble the `git branch` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["branch"];
    if (this.#delete !== undefined) {
      argv.push(this.#delete === "force" ? "-D" : "-d");
    }
    if (this.#all) argv.push("--all");
    if (this.#name !== undefined) argv.push(this.#name);
    return argv;
  }
}

/** Settings for `git tag`. */
export class GitTagSettings extends GitSettings {
  #name?: string;
  #message?: string;
  #force = false;
  #delete = false;

  /** The tag name. */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** Create an annotated tag with this message (`-a -m`). */
  message(text: string): this {
    this.#message = text;
    return this;
  }

  /** Replace an existing tag (`-f`/`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Delete the tag (`-d`/`--delete`). */
  deleteTag(): this {
    this.#delete = true;
    return this;
  }

  /** Assemble the `git tag` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["tag"];
    if (this.#delete) argv.push("--delete");
    if (this.#force) argv.push("--force");
    if (this.#message !== undefined) argv.push("-a", "-m", this.#message);
    if (this.#name !== undefined) argv.push(this.#name);
    return argv;
  }
}

/** Settings for `git push`. */
export class GitPushSettings extends GitSettings {
  #remote?: string;
  #ref?: string;
  #setUpstream = false;
  #tags = false;
  #forceWithLease = false;
  #delete = false;

  /** The remote to push to (e.g. `origin`). */
  remote(name: string): this {
    this.#remote = name;
    return this;
  }

  /** The refspec/branch to push. */
  ref(value: string): this {
    this.#ref = value;
    return this;
  }

  /** Set the upstream tracking ref (`-u`/`--set-upstream`). */
  setUpstream(): this {
    this.#setUpstream = true;
    return this;
  }

  /** Also push tags (`--tags`). */
  tags(): this {
    this.#tags = true;
    return this;
  }

  /** Force push, but only if the remote ref is unchanged (`--force-with-lease`). */
  forceWithLease(): this {
    this.#forceWithLease = true;
    return this;
  }

  /** Delete the remote ref (`--delete`). */
  deleteRef(): this {
    this.#delete = true;
    return this;
  }

  /** Assemble the `git push` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["push"];
    if (this.#setUpstream) argv.push("--set-upstream");
    if (this.#tags) argv.push("--tags");
    if (this.#forceWithLease) argv.push("--force-with-lease");
    if (this.#delete) argv.push("--delete");
    if (this.#remote !== undefined) argv.push(this.#remote);
    if (this.#ref !== undefined) argv.push(this.#ref);
    return argv;
  }
}

/** Settings for `git pull`. */
export class GitPullSettings extends GitSettings {
  #remote?: string;
  #ref?: string;
  #rebase = false;
  #ffOnly = false;

  /** The remote to pull from. */
  remote(name: string): this {
    this.#remote = name;
    return this;
  }

  /** The refspec/branch to pull. */
  ref(value: string): this {
    this.#ref = value;
    return this;
  }

  /** Rebase instead of merge (`--rebase`). */
  rebase(): this {
    this.#rebase = true;
    return this;
  }

  /** Only fast-forward (`--ff-only`). */
  ffOnly(): this {
    this.#ffOnly = true;
    return this;
  }

  /** Assemble the `git pull` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["pull"];
    if (this.#rebase) argv.push("--rebase");
    if (this.#ffOnly) argv.push("--ff-only");
    if (this.#remote !== undefined) argv.push(this.#remote);
    if (this.#ref !== undefined) argv.push(this.#ref);
    return argv;
  }
}

/** Settings for `git fetch`. */
export class GitFetchSettings extends GitSettings {
  #remote?: string;
  #all = false;
  #tags = false;
  #noTags = false;
  #prune = false;
  #depth?: number;
  #refspecs: string[] = [];

  /** The remote to fetch from. */
  remote(name: string): this {
    this.#remote = name;
    return this;
  }

  /**
   * Add a refspec to fetch, after the remote — `master`, or
   * `master:refs/remotes/origin/master` to also update the remote-tracking ref
   * (which is what makes `origin/master` resolvable in a shallow CI checkout
   * that never fetched it). Repeatable.
   *
   * Prefix the source with `+` to force the update. Pair it with
   * {@link depth}: a shallow fetch is not a fast-forward of the history already
   * present, and git rejects such an update unless it is forced.
   */
  refspec(...specs: string[]): this {
    this.#refspecs.push(...specs);
    return this;
  }

  /** Skip fetching tags (`--no-tags`). */
  noTags(): this {
    this.#noTags = true;
    return this;
  }

  /**
   * Limit history to this many commits (`--depth`). `1` is enough to diff
   * against a base branch and avoids pulling a whole history into a CI job.
   */
  depth(commits: number): this {
    this.#depth = commits;
    return this;
  }

  /** Fetch from all remotes (`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Also fetch tags (`--tags`). */
  tags(): this {
    this.#tags = true;
    return this;
  }

  /** Prune deleted remote refs (`--prune`). */
  prune(): this {
    this.#prune = true;
    return this;
  }

  /** Assemble the `git fetch` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["fetch"];
    if (this.#all) argv.push("--all");
    if (this.#tags) argv.push("--tags");
    if (this.#noTags) argv.push("--no-tags");
    if (this.#prune) argv.push("--prune");
    if (this.#depth !== undefined) argv.push("--depth", String(this.#depth));
    if (this.#remote !== undefined) argv.push(this.#remote);
    // Refspecs are positional and must follow the remote they belong to.
    argv.push(...this.#refspecs);
    return argv;
  }
}

/** Settings for an arbitrary `git` command not covered by a typed task. */
export class GitRunSettings extends GitSettings {
  #command: string[] = [];

  /** The subcommand and its arguments, e.g. `command("rev-parse", "HEAD")`. */
  command(...parts: Array<string | number>): this {
    this.#command.push(...parts.map(String));
    return this;
  }

  /** Assemble the arbitrary `git` subcommand argv from `.command(...)`. */
  protected override subcommandArgs(): string[] {
    return [...this.#command];
  }
}

/** The shape of {@link GitTasks}. */
export interface GitTasksApi {
  /** Create a repository: `git init`. */
  init(configure?: Configure<GitInitSettings>): Promise<CommandOutput>;
  /** Clone a repository: `git clone`. */
  clone(configure?: Configure<GitCloneSettings>): Promise<CommandOutput>;
  /** Stage changes: `git add`. */
  add(configure?: Configure<GitAddSettings>): Promise<CommandOutput>;
  /** Record changes: `git commit`. */
  commit(configure?: Configure<GitCommitSettings>): Promise<CommandOutput>;
  /** Show working-tree status: `git status`. */
  status(configure?: Configure<GitStatusSettings>): Promise<CommandOutput>;
  /** Switch branches or restore files: `git checkout`. */
  checkout(configure?: Configure<GitCheckoutSettings>): Promise<CommandOutput>;
  /** Manage branches: `git branch`. */
  branch(configure?: Configure<GitBranchSettings>): Promise<CommandOutput>;
  /** Manage tags: `git tag`. */
  tag(configure?: Configure<GitTagSettings>): Promise<CommandOutput>;
  /** Update remote refs: `git push`. */
  push(configure?: Configure<GitPushSettings>): Promise<CommandOutput>;
  /** Fetch and integrate: `git pull`. */
  pull(configure?: Configure<GitPullSettings>): Promise<CommandOutput>;
  /** Download objects and refs: `git fetch`. */
  fetch(configure?: Configure<GitFetchSettings>): Promise<CommandOutput>;
  /**
   * Manage worktrees: `git worktree add|list|remove|prune`. Pick the
   * subcommand in the lambda — `s.add(path)`, `s.list()`, `s.remove(path)`, or
   * `s.prune()`. For a listing to read rather than print, use
   * {@link GitTasksApi.worktreeList}.
   */
  worktree(configure?: Configure<GitWorktreeSettings>): Promise<CommandOutput>;
  /**
   * List the repository's worktrees as parsed {@link GitWorktree} entries,
   * from `git worktree list --porcelain`.
   *
   * The lambda configures the global options (`.dir()`, `.config()`); the
   * subcommand itself is fixed, since the parse depends on it.
   */
  worktreeList(
    configure?: Configure<GitWorktreeSettings>,
  ): Promise<GitWorktree[]>;
  /**
   * The name of a remote's default branch — `main`, `master`, or whatever it
   * chose — so a build does not have to hardcode one.
   *
   * Reads the local `refs/remotes/<remote>/HEAD` first, which costs no network,
   * and asks the remote itself when that ref was never populated. Fails when
   * neither names a branch, rather than guessing.
   */
  defaultBranch(
    configure?: Configure<GitDefaultBranchSettings>,
  ): Promise<string>;
  /** Run any other git command via `.command(...)`. */
  run(configure?: Configure<GitRunSettings>): Promise<CommandOutput>;
}

/**
 * Run `git worktree list --porcelain` and parse it. Backs
 * {@link GitTasksApi.worktreeList}.
 */
async function listWorktrees(
  configure?: Configure<GitWorktreeSettings>,
): Promise<GitWorktree[]> {
  const settings = new GitWorktreeSettings();
  const configured = configure ? configure(settings) : settings;
  const output = await configured.list().porcelain().run();
  return parseWorktreeList(output.stdout);
}

/** Typed task functions for the common `git` commands. */
export const GitTasks: GitTasksApi = {
  init: (c) => runSettings(new GitInitSettings(), c),
  clone: (c) => runSettings(new GitCloneSettings(), c),
  add: (c) => runSettings(new GitAddSettings(), c),
  commit: (c) => runSettings(new GitCommitSettings(), c),
  status: (c) => runSettings(new GitStatusSettings(), c),
  checkout: (c) => runSettings(new GitCheckoutSettings(), c),
  branch: (c) => runSettings(new GitBranchSettings(), c),
  tag: (c) => runSettings(new GitTagSettings(), c),
  push: (c) => runSettings(new GitPushSettings(), c),
  pull: (c) => runSettings(new GitPullSettings(), c),
  fetch: (c) => runSettings(new GitFetchSettings(), c),
  worktree: (c) => runSettings(new GitWorktreeSettings(), c),
  worktreeList: (c) => listWorktrees(c),
  defaultBranch: (c) => resolveDefaultBranch(c),
  run: (c) => runSettings(new GitRunSettings(), c),
};

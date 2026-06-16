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

import {
  type Configure,
  type PathLike,
  runSettings,
  ToolSettings,
} from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/** Shared base for every `git` subcommand: the binary and global options. */
abstract class GitSettings extends ToolSettings {
  #dir?: string;
  #configs: string[] = [];

  protected override defaultTool(): string {
    return "git";
  }

  /** The subcommand argv (after the global options). */
  protected abstract subcommandArgs(): string[];

  /** Run git as if started in `path` (`-C <path>`). */
  dir(path: PathLike): this {
    this.#dir = String(path);
    return this;
  }

  /** Set a one-off config value (`-c key=value`); repeatable. */
  config(key: string, value: string): this {
    this.#configs.push("-c", `${key}=${value}`);
    return this;
  }

  protected override buildArgs(): string[] {
    const argv: string[] = [];
    if (this.#dir !== undefined) argv.push("-C", this.#dir);
    argv.push(...this.#configs);
    argv.push(...this.subcommandArgs());
    return argv;
  }
}

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

  protected override subcommandArgs(): string[] {
    const argv = ["add"];
    if (this.#all) argv.push("--all");
    if (this.#update) argv.push("--update");
    argv.push(...this.#paths);
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
  #create = false;
  #force = false;

  /** The branch, commit, or path to check out (required). */
  ref(target: string): this {
    this.#ref = target;
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

  protected override subcommandArgs(): string[] {
    if (this.#ref === undefined) {
      throw new Error("GitTasks.checkout: .ref() is required.");
    }
    const argv = ["checkout"];
    if (this.#create) argv.push("-b");
    if (this.#force) argv.push("--force");
    argv.push(this.#ref);
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
  #prune = false;

  /** The remote to fetch from. */
  remote(name: string): this {
    this.#remote = name;
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

  protected override subcommandArgs(): string[] {
    const argv = ["fetch"];
    if (this.#all) argv.push("--all");
    if (this.#tags) argv.push("--tags");
    if (this.#prune) argv.push("--prune");
    if (this.#remote !== undefined) argv.push(this.#remote);
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
  /** Run any other git command via `.command(...)`. */
  run(configure?: Configure<GitRunSettings>): Promise<CommandOutput>;
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
  run: (c) => runSettings(new GitRunSettings(), c),
};

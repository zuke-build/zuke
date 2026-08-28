// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The commands that move objects between repositories: `git push`,
 * `git pull`, and `git fetch`.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * await GitTasks.fetch((s) => s.noTags().depth(1).remote("origin")
 *   .refspec("+main:refs/remotes/origin/main"));
 * await GitTasks.push((s) => s.setUpstream().remote("origin").ref("main"));
 * ```
 *
 * @module
 */

import { GitSettings } from "./settings.ts";

/** Settings for `git push`. */
export class GitPushSettings extends GitSettings {
  #remote?: string;
  #ref?: string;
  #setUpstream = false;
  #tags = false;
  #followTags = false;
  #forceWithLease = false;
  #delete = false;
  #dryRun = false;
  #atomic = false;
  #pushOptions: string[] = [];

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

  /**
   * Push the annotated tags reachable from the refs being pushed
   * (`--follow-tags`) — a release target's tag rides along with its commit
   * instead of needing a second push.
   */
  followTags(): this {
    this.#followTags = true;
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

  /** Update every ref or none (`--atomic`). */
  atomic(): this {
    this.#atomic = true;
    return this;
  }

  /** Report what would be pushed without pushing it (`--dry-run`). */
  dryRun(): this {
    this.#dryRun = true;
    return this;
  }

  /**
   * Send a server-side option (`--push-option=<value>`); repeatable. GitLab
   * reads these for `ci.skip` and merge-request creation.
   */
  pushOption(...values: string[]): this {
    this.#pushOptions.push(...values);
    return this;
  }

  /** Assemble the `git push` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["push"];
    if (this.#setUpstream) argv.push("--set-upstream");
    if (this.#tags) argv.push("--tags");
    if (this.#followTags) argv.push("--follow-tags");
    if (this.#forceWithLease) argv.push("--force-with-lease");
    if (this.#atomic) argv.push("--atomic");
    if (this.#dryRun) argv.push("--dry-run");
    for (const option of this.#pushOptions) {
      argv.push(`--push-option=${option}`);
    }
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
  #noRebase = false;
  #depth?: number;
  #tags = false;
  #prune = false;

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

  /**
   * Merge rather than rebase (`--no-rebase`), whatever `pull.rebase` is set to
   * in the ambient config — the flag a build reaches for when it must not
   * depend on the machine it runs on.
   */
  noRebase(): this {
    this.#noRebase = true;
    return this;
  }

  /** Only fast-forward (`--ff-only`). */
  ffOnly(): this {
    this.#ffOnly = true;
    return this;
  }

  /** Limit the fetched history to this many commits (`--depth`). */
  depth(commits: number): this {
    this.#depth = commits;
    return this;
  }

  /** Also fetch tags (`--tags`). */
  tags(): this {
    this.#tags = true;
    return this;
  }

  /** Prune deleted remote refs while fetching (`--prune`). */
  prune(): this {
    this.#prune = true;
    return this;
  }

  /** Assemble the `git pull` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#rebase && this.#noRebase) {
      throw new Error(
        "GitTasks.pull: .rebase() and .noRebase() are opposites — pick one.",
      );
    }
    const argv = ["pull"];
    if (this.#rebase) argv.push("--rebase");
    if (this.#noRebase) argv.push("--no-rebase");
    if (this.#ffOnly) argv.push("--ff-only");
    if (this.#tags) argv.push("--tags");
    if (this.#prune) argv.push("--prune");
    if (this.#depth !== undefined) argv.push("--depth", String(this.#depth));
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
  #force = false;
  #unshallow = false;
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
   * {@link depth}: a shallow fetch is not a fast-forward of the history
   * already present, and git rejects such an update unless it is forced.
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

  /**
   * Deepen a shallow clone into the full history (`--unshallow`) — what a
   * release target needs before `git describe` or a changelog can see past the
   * one commit CI checked out.
   */
  unshallow(): this {
    this.#unshallow = true;
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

  /** Update refs even when the update is not a fast-forward (`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Assemble the `git fetch` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#depth !== undefined && this.#unshallow) {
      throw new Error(
        "GitTasks.fetch: .depth(...) truncates history and .unshallow() " +
          "restores all of it — pick one.",
      );
    }
    const argv = ["fetch"];
    if (this.#all) argv.push("--all");
    if (this.#tags) argv.push("--tags");
    if (this.#noTags) argv.push("--no-tags");
    if (this.#prune) argv.push("--prune");
    if (this.#force) argv.push("--force");
    if (this.#unshallow) argv.push("--unshallow");
    if (this.#depth !== undefined) argv.push("--depth", String(this.#depth));
    if (this.#remote !== undefined) argv.push(this.#remote);
    // Refspecs are positional and must follow the remote they belong to.
    argv.push(...this.#refspecs);
    return argv;
  }
}

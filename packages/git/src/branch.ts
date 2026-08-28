// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The commands that create branches and move between them: `git branch`,
 * `git checkout`, and its modern half `git switch`.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * await GitTasks.branch((s) => s.name("release/1.2").startPoint("origin/main"));
 * await GitTasks.switch((s) => s.create().branch("feature"));
 * await GitTasks.checkout((s) => s.ref("origin/main").paths("docs"));
 * ```
 *
 * `checkout` still does both jobs — switching branches and restoring files —
 * which is why git grew `switch` and `restore`. New code is clearer with those
 * two; `checkout` stays for the builds and habits that already use it.
 *
 * @module
 */

import { GitSettings } from "./settings.ts";

/** Settings for `git checkout`. */
export class GitCheckoutSettings extends GitSettings {
  #ref?: string;
  #paths: string[] = [];
  #create = false;
  #force = false;
  #detach = false;

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

  /** Check the ref out with a detached `HEAD` (`--detach`). */
  detach(): this {
    this.#detach = true;
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
    if (this.#detach) argv.push("--detach");
    if (this.#create) argv.push("-b");
    if (this.#ref !== undefined) argv.push(this.#ref);
    // `-- <paths>` last so git never treats a path as a ref (mirrors `add`).
    if (this.#paths.length > 0) argv.push("--", ...this.#paths);
    return argv;
  }
}

/** Settings for `git switch`. */
export class GitSwitchSettings extends GitSettings {
  #branch?: string;
  #startPoint?: string;
  #create = false;
  #forceCreate = false;
  #detach = false;
  #force = false;
  #track?: string;

  /** The branch to switch to — or, with {@link create}, the one to create. */
  branch(name: string): this {
    this.#branch = name;
    return this;
  }

  /**
   * The commit the new branch forks from (git's trailing `<start-point>`),
   * e.g. `origin/main`. Without it a created branch forks from the current
   * `HEAD`, which is whatever the checkout happened to be on.
   */
  startPoint(rev: string): this {
    this.#startPoint = rev;
    return this;
  }

  /** Create the branch (`-c`); fails if it already exists. */
  create(): this {
    this.#create = true;
    return this;
  }

  /** Create the branch, resetting it if it exists (`-C`). */
  forceCreate(): this {
    this.#forceCreate = true;
    return this;
  }

  /** Set up upstream tracking (`--track=<mode>`), `direct` or `inherit`. */
  track(mode: "direct" | "inherit"): this {
    this.#track = mode;
    return this;
  }

  /**
   * Switch with a detached `HEAD` (`--detach`) — checking out a commit rather
   * than a branch, which `switch` otherwise refuses.
   */
  detach(): this {
    this.#detach = true;
    return this;
  }

  /** Throw away local changes rather than refusing to switch (`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Assemble the `git switch` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#branch === undefined && !this.#detach) {
      throw new Error(
        "GitTasks.switch: .branch(...) is required — it names the branch to " +
          "switch to. Only .detach() stands alone, detaching at the current " +
          "HEAD.",
      );
    }
    if (this.#create && this.#forceCreate) {
      throw new Error(
        "GitTasks.switch: .create() (-c) and .forceCreate() (-C) both create " +
          "the branch — pick one.",
      );
    }
    const argv = ["switch"];
    if (this.#force) argv.push("--force");
    if (this.#detach) argv.push("--detach");
    if (this.#track !== undefined) argv.push(`--track=${this.#track}`);
    if (this.#create) argv.push("-c");
    if (this.#forceCreate) argv.push("-C");
    if (this.#branch !== undefined) argv.push(this.#branch);
    if (this.#startPoint !== undefined) argv.push(this.#startPoint);
    return argv;
  }
}

/** Settings for `git branch`. */
export class GitBranchSettings extends GitSettings {
  #name?: string;
  #startPoint?: string;
  #delete?: "soft" | "force";
  #all = false;
  #remotes = false;
  #move?: "soft" | "force";
  #newName?: string;
  #setUpstreamTo?: string;
  #contains?: string;
  #merged?: string;
  #format?: string;
  #sort?: string;

  /** The branch name to create or operate on. */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /**
   * The commit a created branch forks from (git's trailing `<start-point>`),
   * e.g. `origin/main`.
   */
  startPoint(rev: string): this {
    this.#startPoint = rev;
    return this;
  }

  /** Delete the branch (`-d`, or `-D` when forced). */
  deleteBranch(force = false): this {
    this.#delete = force ? "force" : "soft";
    return this;
  }

  /** Rename {@link name} to `newName` (`-m`, or `-M` when forced). */
  rename(newName: string, force = false): this {
    this.#newName = newName;
    this.#move = force ? "force" : "soft";
    return this;
  }

  /** Point the branch's upstream at this ref (`--set-upstream-to=<ref>`). */
  setUpstreamTo(ref: string): this {
    this.#setUpstreamTo = ref;
    return this;
  }

  /** List both local and remote-tracking branches (`-a`/`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** List remote-tracking branches only (`-r`/`--remotes`). */
  remotes(): this {
    this.#remotes = true;
    return this;
  }

  /** List only branches containing this commit (`--contains <commit>`). */
  contains(rev: string): this {
    this.#contains = rev;
    return this;
  }

  /**
   * List only branches already merged into this ref (`--merged <ref>`) — the
   * listing a cleanup target filters stale branches from.
   */
  merged(ref: string): this {
    this.#merged = ref;
    return this;
  }

  /**
   * Render a listing through a format string (`--format=<fmt>`), e.g.
   * `%(refname:short)` for bare branch names with no `*` marker or padding.
   */
  format(spec: string): this {
    this.#format = spec;
    return this;
  }

  /** Order a listing (`--sort=<key>`), e.g. `-committerdate` for most recent first. */
  sort(key: string): this {
    this.#sort = key;
    return this;
  }

  /** Assemble the `git branch` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#move !== undefined && this.#name === undefined) {
      throw new Error(
        "GitTasks.branch: .rename(...) needs the branch to rename — call " +
          ".name(...).",
      );
    }
    const argv = ["branch"];
    if (this.#delete !== undefined) {
      argv.push(this.#delete === "force" ? "-D" : "-d");
    }
    if (this.#move !== undefined) {
      argv.push(this.#move === "force" ? "-M" : "-m");
    }
    if (this.#all) argv.push("--all");
    if (this.#remotes) argv.push("--remotes");
    if (this.#contains !== undefined) argv.push("--contains", this.#contains);
    if (this.#merged !== undefined) argv.push("--merged", this.#merged);
    if (this.#format !== undefined) argv.push(`--format=${this.#format}`);
    if (this.#sort !== undefined) argv.push(`--sort=${this.#sort}`);
    if (this.#setUpstreamTo !== undefined) {
      argv.push(`--set-upstream-to=${this.#setUpstreamTo}`);
    }
    if (this.#name !== undefined) argv.push(this.#name);
    if (this.#newName !== undefined) argv.push(this.#newName);
    if (this.#startPoint !== undefined) argv.push(this.#startPoint);
    return argv;
  }
}

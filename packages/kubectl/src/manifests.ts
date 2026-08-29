// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `kubectl` commands that take manifests: `apply`, `create`, `delete`,
 * `replace`, and `diff`.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { type DryRunMode, KubectlSettings } from "./settings.ts";

/** Settings for `kubectl apply`. */
export class KubectlApplySettings extends KubectlSettings {
  #files: string[] = [];
  #kustomize?: string;
  #recursive = false;
  #prune = false;
  #serverSide = false;
  #dryRun?: DryRunMode;
  #selector?: string;
  #force = false;

  /** Apply a manifest file, directory, or URL (`-f`); repeatable. */
  file(path: PathLike): this {
    this.#files.push(String(path));
    return this;
  }

  /** Apply a kustomization directory (`-k`). */
  kustomize(dir: PathLike): this {
    this.#kustomize = String(dir);
    return this;
  }

  /** Recurse into directories given to `-f` (`-R`). */
  recursive(): this {
    this.#recursive = true;
    return this;
  }

  /** Prune resources not present in the applied set (`--prune`). */
  prune(): this {
    this.#prune = true;
    return this;
  }

  /** Apply server-side (`--server-side`). */
  serverSide(): this {
    this.#serverSide = true;
    return this;
  }

  /** Preview without persisting (`--dry-run=`; defaults to `client`). */
  dryRun(mode: DryRunMode = "client"): this {
    this.#dryRun = mode;
    return this;
  }

  /** Restrict to resources matching a label selector (`-l`). */
  selector(query: string): this {
    this.#selector = query;
    return this;
  }

  /** Force apply by delete-and-recreate when needed (`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Assemble the `kubectl apply` argv. */
  protected override buildArgs(): string[] {
    if (this.#files.length === 0 && this.#kustomize === undefined) {
      throw new Error(
        "KubectlTasks.apply: .file() or .kustomize() is required.",
      );
    }
    // kubectl apply accepts EITHER -f or -k, never both.
    if (this.#files.length > 0 && this.#kustomize !== undefined) {
      throw new Error(
        "KubectlTasks.apply: .file() and .kustomize() are mutually exclusive.",
      );
    }
    // -k also rejects -R: kubectl errors "the -k flag can't be used with -f or -R".
    if (this.#kustomize !== undefined && this.#recursive) {
      throw new Error(
        "KubectlTasks.apply: .kustomize() cannot be combined with .recursive().",
      );
    }
    const argv = ["apply", ...this.globalArgs()];
    for (const f of this.#files) argv.push("-f", f);
    if (this.#kustomize !== undefined) argv.push("-k", this.#kustomize);
    if (this.#recursive) argv.push("-R");
    if (this.#prune) argv.push("--prune");
    if (this.#serverSide) argv.push("--server-side");
    if (this.#dryRun !== undefined) argv.push(`--dry-run=${this.#dryRun}`);
    if (this.#selector !== undefined) argv.push("-l", this.#selector);
    if (this.#force) argv.push("--force");
    return argv;
  }
}

/** Settings for `kubectl create`. */
export class KubectlCreateSettings extends KubectlSettings {
  #files: string[] = [];
  #recursive = false;
  #dryRun?: DryRunMode;
  #output?: string;
  #saveConfig = false;

  /**
   * Create from a manifest file, directory, or URL (`-f`); repeatable. For
   * resource-form creation (`create secret …`), use the base `.args(...)`.
   */
  file(path: PathLike): this {
    this.#files.push(String(path));
    return this;
  }

  /** Recurse into directories given to `-f` (`-R`). */
  recursive(): this {
    this.#recursive = true;
    return this;
  }

  /** Preview without persisting (`--dry-run=`; defaults to `client`). */
  dryRun(mode: DryRunMode = "client"): this {
    this.#dryRun = mode;
    return this;
  }

  /** Output format, e.g. `yaml` or `json` (`-o`). */
  output(format: string): this {
    this.#output = format;
    return this;
  }

  /** Record the current resource in its annotation (`--save-config`). */
  saveConfig(): this {
    this.#saveConfig = true;
    return this;
  }

  /** Assemble the `kubectl create` argv. */
  protected override buildArgs(): string[] {
    const argv = ["create", ...this.globalArgs()];
    for (const f of this.#files) argv.push("-f", f);
    if (this.#recursive) argv.push("-R");
    if (this.#dryRun !== undefined) argv.push(`--dry-run=${this.#dryRun}`);
    if (this.#output !== undefined) argv.push("-o", this.#output);
    if (this.#saveConfig) argv.push("--save-config");
    return argv;
  }
}

/** Settings for `kubectl delete`. */
export class KubectlDeleteSettings extends KubectlSettings {
  #files: string[] = [];
  #resources: string[] = [];
  #selector?: string;
  #all = false;
  #ignoreNotFound = false;
  #force = false;
  #gracePeriod?: number;
  #recursive = false;

  /** Delete from a manifest file or directory (`-f`); repeatable. */
  file(path: PathLike): this {
    this.#files.push(String(path));
    return this;
  }

  /** Resource tokens, e.g. `("pod", "web")` or `("deployment/api")`; repeatable. */
  resource(...tokens: string[]): this {
    this.#resources.push(...tokens);
    return this;
  }

  /** Restrict to resources matching a label selector (`-l`). */
  selector(query: string): this {
    this.#selector = query;
    return this;
  }

  /** Delete all resources of the given type (`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Treat "not found" as a success (`--ignore-not-found`). */
  ignoreNotFound(): this {
    this.#ignoreNotFound = true;
    return this;
  }

  /** Force immediate deletion (`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Seconds to wait before forceful termination (`--grace-period`). */
  gracePeriod(seconds: number): this {
    this.#gracePeriod = seconds;
    return this;
  }

  /** Recurse into directories given to `-f` (`-R`). */
  recursive(): this {
    this.#recursive = true;
    return this;
  }

  /** Assemble the `kubectl delete` argv. */
  protected override buildArgs(): string[] {
    if (this.#files.length === 0 && this.#resources.length === 0) {
      throw new Error(
        "KubectlTasks.delete: specify .file() or .resource(...).",
      );
    }
    const argv = ["delete", ...this.globalArgs()];
    for (const f of this.#files) argv.push("-f", f);
    argv.push(...this.#resources);
    if (this.#selector !== undefined) argv.push("-l", this.#selector);
    if (this.#all) argv.push("--all");
    if (this.#ignoreNotFound) argv.push("--ignore-not-found");
    if (this.#force) argv.push("--force");
    if (this.#gracePeriod !== undefined) {
      argv.push(`--grace-period=${this.#gracePeriod}`);
    }
    if (this.#recursive) argv.push("-R");
    return argv;
  }
}

/** Settings for `kubectl replace`. */
export class KubectlReplaceSettings extends KubectlSettings {
  #files: string[] = [];
  #kustomize?: string;
  #recursive = false;
  #force = false;
  #gracePeriod?: number;
  #timeout?: string;
  #cascade?: string;
  #wait = false;
  #dryRun?: DryRunMode;

  /** Replace from a manifest file, directory, or URL (`-f`); repeatable. */
  file(path: PathLike): this {
    this.#files.push(String(path));
    return this;
  }

  /** Replace from a kustomization directory (`-k`). */
  kustomize(dir: PathLike): this {
    this.#kustomize = String(dir);
    return this;
  }

  /** Recurse into directories given to `-f` (`-R`). */
  recursive(): this {
    this.#recursive = true;
    return this;
  }

  /**
   * Delete and recreate rather than update (`--force`). This is not a retry
   * knob: the resource genuinely goes away first, so anything depending on it
   * sees it missing.
   */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Seconds each object gets to terminate (`--grace-period`). */
  gracePeriod(seconds: number): this {
    this.#gracePeriod = seconds;
    return this;
  }

  /** How long to wait on the delete half, e.g. `60s` (`--timeout`). */
  timeout(duration: string): this {
    this.#timeout = duration;
    return this;
  }

  /** The cascading strategy for dependents (`--cascade`). */
  cascade(strategy: "background" | "orphan" | "foreground"): this {
    this.#cascade = strategy;
    return this;
  }

  /** Wait for the resources to be gone before returning (`--wait`). */
  wait(): this {
    this.#wait = true;
    return this;
  }

  /** Preview without persisting (`--dry-run=`; defaults to `client`). */
  dryRun(mode: DryRunMode = "client"): this {
    this.#dryRun = mode;
    return this;
  }

  /** Assemble the `kubectl replace` argv. */
  protected override buildArgs(): string[] {
    if (this.#files.length === 0 && this.#kustomize === undefined) {
      throw new Error(
        "KubectlTasks.replace: .file() or .kustomize() is required.",
      );
    }
    if (this.#files.length > 0 && this.#kustomize !== undefined) {
      throw new Error(
        "KubectlTasks.replace: .file() and .kustomize() are mutually exclusive.",
      );
    }
    if (this.#kustomize !== undefined && this.#recursive) {
      throw new Error(
        "KubectlTasks.replace: .kustomize() cannot be combined with .recursive().",
      );
    }
    // kubectl only accepts a zero grace period under --force.
    if (this.#gracePeriod === 0 && !this.#force) {
      throw new Error(
        "KubectlTasks.replace: kubectl accepts .gracePeriod(0) only with " +
          ".force() — add it, or give the object time to terminate.",
      );
    }
    const argv = ["replace", ...this.globalArgs()];
    for (const f of this.#files) argv.push("-f", f);
    if (this.#kustomize !== undefined) argv.push("-k", this.#kustomize);
    if (this.#recursive) argv.push("-R");
    if (this.#force) argv.push("--force");
    if (this.#gracePeriod !== undefined) {
      argv.push(`--grace-period=${this.#gracePeriod}`);
    }
    if (this.#timeout !== undefined) argv.push(`--timeout=${this.#timeout}`);
    if (this.#cascade !== undefined) argv.push(`--cascade=${this.#cascade}`);
    if (this.#wait) argv.push("--wait");
    if (this.#dryRun !== undefined) argv.push(`--dry-run=${this.#dryRun}`);
    return argv;
  }
}

/**
 * Settings for `kubectl diff` — what an apply would change, without changing
 * it.
 *
 * `diff` reports its answer through the exit status: **0** when there is no
 * difference and **1** when there is, with anything above 1 meaning kubectl or
 * the differ failed. {@link "./kubectl.ts".KubectlTasksApi.diff} keeps the
 * ordinary contract, so a build that wants the printed diff and a failed
 * target on drift gets both;
 * {@link "./kubectl.ts".KubectlTasksApi.diffHasChanges} is the reader that
 * turns the code into a boolean.
 */
export class KubectlDiffSettings extends KubectlSettings {
  #files: string[] = [];
  #kustomize?: string;
  #recursive = false;
  #serverSide = false;
  #forceConflicts = false;
  #prune = false;
  #selector?: string;
  #showManagedFields = false;
  #concurrency?: number;

  /** Diff a manifest file, directory, or URL (`-f`); repeatable. */
  file(path: PathLike): this {
    this.#files.push(String(path));
    return this;
  }

  /** Diff a kustomization directory (`-k`). */
  kustomize(dir: PathLike): this {
    this.#kustomize = String(dir);
    return this;
  }

  /** Recurse into directories given to `-f` (`-R`). */
  recursive(): this {
    this.#recursive = true;
    return this;
  }

  /** Diff the server-side apply (`--server-side`). */
  serverSide(): this {
    this.#serverSide = true;
    return this;
  }

  /** Take ownership of conflicting fields (`--force-conflicts`). */
  forceConflicts(): this {
    this.#forceConflicts = true;
    return this;
  }

  /** Include what a prune would delete (`--prune`). */
  prune(): this {
    this.#prune = true;
    return this;
  }

  /** Restrict to resources matching a label selector (`-l`). */
  selector(query: string): this {
    this.#selector = query;
    return this;
  }

  /** Include the managed fields, which are otherwise hidden (`--show-managed-fields`). */
  showManagedFields(): this {
    this.#showManagedFields = true;
    return this;
  }

  /** How many objects to diff in parallel (`--concurrency`). */
  concurrency(count: number): this {
    this.#concurrency = count;
    return this;
  }

  /** Assemble the `kubectl diff` argv. */
  protected override buildArgs(): string[] {
    if (this.#files.length === 0 && this.#kustomize === undefined) {
      throw new Error(
        "KubectlTasks.diff: .file() or .kustomize() is required.",
      );
    }
    if (this.#files.length > 0 && this.#kustomize !== undefined) {
      throw new Error(
        "KubectlTasks.diff: .file() and .kustomize() are mutually exclusive.",
      );
    }
    if (this.#kustomize !== undefined && this.#recursive) {
      throw new Error(
        "KubectlTasks.diff: .kustomize() cannot be combined with .recursive().",
      );
    }
    if (this.#forceConflicts && !this.#serverSide) {
      throw new Error(
        "KubectlTasks.diff: .forceConflicts() only applies to a server-side " +
          "apply — add .serverSide(), or drop it.",
      );
    }
    const argv = ["diff", ...this.globalArgs()];
    for (const f of this.#files) argv.push("-f", f);
    if (this.#kustomize !== undefined) argv.push("-k", this.#kustomize);
    if (this.#recursive) argv.push("-R");
    if (this.#serverSide) argv.push("--server-side");
    if (this.#forceConflicts) argv.push("--force-conflicts");
    if (this.#prune) argv.push("--prune");
    if (this.#selector !== undefined) argv.push("-l", this.#selector);
    if (this.#showManagedFields) argv.push("--show-managed-fields");
    if (this.#concurrency !== undefined) {
      argv.push(`--concurrency=${this.#concurrency}`);
    }
    return argv;
  }
}

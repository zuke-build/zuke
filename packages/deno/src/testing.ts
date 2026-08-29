// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for the `deno` subcommands that run tests and report on their
 * coverage: `test` and `coverage`.
 */

import type { PathLike } from "@zuke/core/tooling";
import { DenoPermissionSettings, DenoSettings } from "./settings.ts";
import type { CoverageThresholds } from "./coverage.ts";

/** Settings for `deno test`. */
export class DenoTestSettings extends DenoPermissionSettings {
  #paths: string[] = [];
  #coverage?: string;
  #filter?: string;
  #parallel = false;
  #failFast = false;

  /** Restrict the run to specific test files or directories. */
  paths(...paths: PathLike[]): this {
    this.#paths.push(...paths.map(String));
    return this;
  }

  /** Collect coverage into the given profile directory (`--coverage=`). */
  coverage(dir: PathLike): this {
    this.#coverage = String(dir);
    return this;
  }

  /** Only run tests whose name matches (`--filter`). */
  filter(pattern: string): this {
    this.#filter = pattern;
    return this;
  }

  /** Run test files in parallel (`--parallel`). */
  parallel(): this {
    this.#parallel = true;
    return this;
  }

  /** Stop on the first failure (`--fail-fast`). */
  failFast(): this {
    this.#failFast = true;
    return this;
  }

  /** Assemble the `deno test` argv. */
  protected override buildArgs(): string[] {
    const argv = ["test", ...this.permissionArgs, ...this.frozenArgs];
    if (this.#coverage !== undefined) {
      argv.push(`--coverage=${this.#coverage}`);
    }
    if (this.#filter !== undefined) argv.push("--filter", this.#filter);
    if (this.#parallel) argv.push("--parallel");
    if (this.#failFast) argv.push("--fail-fast");
    argv.push(...this.#paths);
    return argv;
  }
}

/** Settings for `deno coverage`. */
export class DenoCoverageSettings extends DenoSettings {
  #dir?: string;
  #lcov = false;
  #output?: string;
  #exclude?: string;
  #linesThreshold?: number;
  #branchesThreshold?: number;
  #perFileThreshold?: number;

  /** The coverage profile directory to report on. */
  dir(path: PathLike): this {
    this.#dir = String(path);
    return this;
  }

  /** Emit lcov instead of the table report (`--lcov`). */
  lcov(): this {
    this.#lcov = true;
    return this;
  }

  /** Write the report to a file (`--output=`). */
  output(path: PathLike): this {
    this.#output = String(path);
    return this;
  }

  /** Exclude files matching the pattern (`--exclude=`). */
  exclude(pattern: string): this {
    this.#exclude = pattern;
    return this;
  }

  /**
   * Fail the gate if line coverage is below `percent`. `deno coverage` has no
   * fail-under flag, so {@link DenoTasks.coverage} enforces this after parsing
   * the lcov report (and forces `--lcov` so a report exists to parse).
   */
  linesThreshold(percent: number): this {
    this.#linesThreshold = percent;
    return this;
  }

  /** Fail the gate if branch coverage is below `percent` (see {@link linesThreshold}). */
  branchesThreshold(percent: number): this {
    this.#branchesThreshold = percent;
    return this;
  }

  /** Fail the gate if either line or branch coverage is below `percent`. */
  threshold(percent: number): this {
    this.#linesThreshold = percent;
    this.#branchesThreshold = percent;
    return this;
  }

  /**
   * Fail the gate if any single instrumented file's line coverage is below
   * `percent` — a per-file floor, so an under-tested file can't hide inside a
   * healthy aggregate (see {@link CoverageThresholds.perFile}, which notes the
   * `deno coverage` limit for files no test loads).
   */
  perFileThreshold(percent: number): this {
    this.#perFileThreshold = percent;
    return this;
  }

  /** The configured thresholds; read by {@link DenoTasks.coverage}. */
  get thresholds(): CoverageThresholds {
    return {
      lines: this.#linesThreshold,
      branches: this.#branchesThreshold,
      perFile: this.#perFileThreshold,
    };
  }

  /** The `--output` file path, if {@link output} was set; read by the task. */
  get outputPath(): string | undefined {
    return this.#output;
  }

  #hasThreshold(): boolean {
    return this.#linesThreshold !== undefined ||
      this.#branchesThreshold !== undefined ||
      this.#perFileThreshold !== undefined;
  }

  /** Assemble the `deno coverage` argv. */
  protected override buildArgs(): string[] {
    const argv = ["coverage"];
    if (this.#dir !== undefined) argv.push(this.#dir);
    // A threshold needs an lcov report to parse, so force it on.
    if (this.#lcov || this.#hasThreshold()) argv.push("--lcov");
    if (this.#output !== undefined) argv.push(`--output=${this.#output}`);
    if (this.#exclude !== undefined) argv.push(`--exclude=${this.#exclude}`);
    return argv;
  }
}

/** Settings for `deno bench`. */
export class DenoBenchSettings extends DenoPermissionSettings {
  #paths: string[] = [];
  #filter?: string;
  #json = false;
  #noRun = false;
  #permitNoFiles = false;
  #ignore: string[] = [];
  #config?: string;

  /** Restrict the run to specific benchmark files or directories. */
  paths(...paths: PathLike[]): this {
    this.#paths.push(...paths.map(String));
    return this;
  }

  /** Only run benchmarks whose name matches (`--filter`). */
  filter(pattern: string): this {
    this.#filter = pattern;
    return this;
  }

  /**
   * Report results as JSON (`--json`) rather than the table. Deno marks the
   * flag unstable, so treat the shape as subject to change between releases.
   */
  json(): this {
    this.#json = true;
    return this;
  }

  /**
   * Cache the benchmark modules without running them (`--no-run`) — a cheap
   * way to prove the benchmarks still compile without paying to run them.
   */
  noRun(): this {
    this.#noRun = true;
    return this;
  }

  /**
   * Succeed when no benchmark files matched (`--permit-no-files`) instead of
   * failing the target.
   */
  permitNoFiles(): this {
    this.#permitNoFiles = true;
    return this;
  }

  /** Skip files matching these patterns (`--ignore`). */
  ignore(...patterns: string[]): this {
    this.#ignore.push(...patterns);
    return this;
  }

  /** Use an explicit config file (`--config`). */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /** Assemble the `deno bench` argv. */
  protected override buildArgs(): string[] {
    const argv = ["bench", ...this.permissionArgs, ...this.frozenArgs];
    if (this.#config !== undefined) argv.push("--config", this.#config);
    if (this.#filter !== undefined) argv.push("--filter", this.#filter);
    if (this.#json) argv.push("--json");
    if (this.#noRun) argv.push("--no-run");
    if (this.#permitNoFiles) argv.push("--permit-no-files");
    if (this.#ignore.length > 0) {
      argv.push(`--ignore=${this.#ignore.join(",")}`);
    }
    argv.push(...this.#paths);
    return argv;
  }
}

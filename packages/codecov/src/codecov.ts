/**
 * `CodecovTasks` — a typed wrapper for the Codecov CLI (`codecovcli`), in the
 * same settings-lambda style as the other Zuke tool wrappers.
 *
 * `upload` runs `codecovcli upload-process` — the recommended one-shot that
 * creates the commit and report records and uploads the coverage files in a
 * single step. Point it at one or more reports and tag them with flags:
 *
 * ```ts
 * import { CodecovTasks } from "jsr:@zuke/codecov";
 * await CodecovTasks.upload((s) => s.files("cov.lcov").flags("unit"));
 * ```
 *
 * The upload token is read from `CODECOV_TOKEN` in the environment, so it never
 * lands in argv. Arguments stay a discrete argv array end-to-end — never a
 * concatenated shell string — so command construction is injection-free.
 *
 * @module
 */

import { type Configure, runSettings, ToolSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/** Settings for `codecovcli upload-process`. */
export class CodecovUploadSettings extends ToolSettings {
  #files: string[] = [];
  #flags: string[] = [];
  #plugins: string[] = [];
  #token?: string;
  #slug?: string;
  #sha?: string;
  #branch?: string;
  #pr?: string;
  #gitService?: string;
  #name?: string;
  #dir?: string;
  #networkRootFolder?: string;
  #reportType?: string;
  #disableSearch = false;
  #failOnError = false;
  #dryRun = false;

  protected override defaultTool(): string {
    return "codecovcli";
  }

  /** A coverage report file to upload (`--file`). Repeatable. */
  files(...paths: string[]): this {
    this.#files.push(...paths);
    return this;
  }

  /** Tag the uploaded reports with a flag (`--flag`). Repeatable. */
  flags(...names: string[]): this {
    this.#flags.push(...names);
    return this;
  }

  /** Run an upload plugin, e.g. `gcov` or `noop` (`--plugin`). Repeatable. */
  plugins(...names: string[]): this {
    this.#plugins.push(...names);
    return this;
  }

  /** Repository upload token (`--token`); prefer the `CODECOV_TOKEN` env var. */
  token(value: string): this {
    this.#token = value;
    return this;
  }

  /** Repository slug as `OWNER/REPO` (`--slug`). */
  slug(value: string): this {
    this.#slug = value;
    return this;
  }

  /** Commit SHA the coverage belongs to (`--sha`). */
  sha(value: string): this {
    this.#sha = value;
    return this;
  }

  /** Branch the coverage belongs to (`--branch`). */
  branch(value: string): this {
    this.#branch = value;
    return this;
  }

  /** Pull request number the coverage belongs to (`--pr`). */
  pullRequest(value: string | number): this {
    this.#pr = String(value);
    return this;
  }

  /** Git host the repo lives on, e.g. `github` (`--git-service`). */
  gitService(value: string): this {
    this.#gitService = value;
    return this;
  }

  /** A custom display name for this upload (`--name`). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** Directory to search for coverage reports (`--dir`). */
  dir(value: string): this {
    this.#dir = value;
    return this;
  }

  /** Root folder used to resolve report file paths (`--network-root-folder`). */
  networkRootFolder(value: string): this {
    this.#networkRootFolder = value;
    return this;
  }

  /** Report kind: `coverage` (default) or `test_results` (`--report-type`). */
  reportType(value: string): this {
    this.#reportType = value;
    return this;
  }

  /** Upload only the named files, skipping the auto-search (`--disable-search`). */
  disableSearch(): this {
    this.#disableSearch = true;
    return this;
  }

  /** Exit non-zero when the upload fails (`--fail-on-error`). */
  failOnError(): this {
    this.#failOnError = true;
    return this;
  }

  /** Print what would be uploaded without sending anything (`--dry-run`). */
  dryRun(): this {
    this.#dryRun = true;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["upload-process"];
    if (this.#token !== undefined) argv.push("--token", this.#token);
    if (this.#slug !== undefined) argv.push("--slug", this.#slug);
    if (this.#sha !== undefined) argv.push("--sha", this.#sha);
    if (this.#branch !== undefined) argv.push("--branch", this.#branch);
    if (this.#pr !== undefined) argv.push("--pr", this.#pr);
    if (this.#gitService !== undefined) {
      argv.push("--git-service", this.#gitService);
    }
    if (this.#name !== undefined) argv.push("--name", this.#name);
    if (this.#dir !== undefined) argv.push("--dir", this.#dir);
    if (this.#networkRootFolder !== undefined) {
      argv.push("--network-root-folder", this.#networkRootFolder);
    }
    if (this.#reportType !== undefined) {
      argv.push("--report-type", this.#reportType);
    }
    for (const file of this.#files) argv.push("--file", file);
    for (const flag of this.#flags) argv.push("--flag", flag);
    for (const plugin of this.#plugins) argv.push("--plugin", plugin);
    if (this.#disableSearch) argv.push("--disable-search");
    if (this.#failOnError) argv.push("--fail-on-error");
    if (this.#dryRun) argv.push("--dry-run");
    return argv;
  }
}

/** The shape of {@link CodecovTasks}. */
export interface CodecovTasksApi {
  /** Upload coverage reports: `codecovcli upload-process`. */
  upload(configure?: Configure<CodecovUploadSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the Codecov CLI. */
export const CodecovTasks: CodecovTasksApi = {
  upload(configure?: Configure<CodecovUploadSettings>): Promise<CommandOutput> {
    return runSettings(new CodecovUploadSettings(), configure);
  },
};

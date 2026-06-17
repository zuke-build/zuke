/**
 * `PlaywrightTasks` — typed task functions for the Playwright CLI, in the
 * settings-lambda style: configure a fluent settings object in a lambda, and
 * the task function builds the command line and executes it.
 *
 * ```ts
 * import { PlaywrightTasks } from "jsr:@zuke/playwright";
 * await PlaywrightTasks.install((s) => s.withDeps());
 * await PlaywrightTasks.test((s) => s.project("chromium").grep("@smoke"));
 * ```
 *
 * The binary is `playwright` from PATH (install it as a project dependency and
 * expose it, or use a wrapper that resolves `npx playwright`). On Windows the
 * shared tooling base retries through `cmd /c` automatically when direct
 * spawning fails.
 */

import { type Configure, runSettings, ToolSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/** Base for all Playwright subcommand settings: binary is `playwright`. */
abstract class PlaywrightSettings extends ToolSettings {
  protected override defaultTool(): string {
    return "playwright";
  }
}

/** Settings for `playwright test`. */
export class PlaywrightTestSettings extends PlaywrightSettings {
  #projects: string[] = [];
  #grep?: string;
  #headed = false;
  #workers?: number;
  #reporter?: string;
  #config?: string;
  #paths: string[] = [];

  /** Restrict to the named project(s) (`--project=`); repeatable. */
  project(...names: string[]): this {
    this.#projects.push(...names);
    return this;
  }

  /** Only run tests matching the pattern (`--grep`). */
  grep(pattern: string): this {
    this.#grep = pattern;
    return this;
  }

  /** Run in headed browsers (`--headed`). */
  headed(): this {
    this.#headed = true;
    return this;
  }

  /** Set the number of parallel workers (`--workers=`). */
  workers(count: number): this {
    this.#workers = count;
    return this;
  }

  /** Choose the reporter (`--reporter=`). */
  reporter(name: string): this {
    this.#reporter = name;
    return this;
  }

  /** Use a specific config file (`--config=`). */
  config(path: string): this {
    this.#config = path;
    return this;
  }

  /** Test file or directory filters to run; omit to run all tests. */
  paths(...filters: string[]): this {
    this.#paths.push(...filters);
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["test"];
    for (const p of this.#projects) argv.push(`--project=${p}`);
    if (this.#grep !== undefined) argv.push("--grep", this.#grep);
    if (this.#headed) argv.push("--headed");
    if (this.#workers !== undefined) argv.push(`--workers=${this.#workers}`);
    if (this.#reporter !== undefined) argv.push(`--reporter=${this.#reporter}`);
    if (this.#config !== undefined) argv.push(`--config=${this.#config}`);
    argv.push(...this.#paths);
    return argv;
  }
}

/** Settings for `playwright install` (browser binaries). */
export class PlaywrightInstallSettings extends PlaywrightSettings {
  #browsers: string[] = [];
  #withDeps = false;

  /** Browsers to install (e.g. `chromium`); omit to install all. */
  browsers(...names: string[]): this {
    this.#browsers.push(...names);
    return this;
  }

  /** Also install the OS dependencies (`--with-deps`). */
  withDeps(): this {
    this.#withDeps = true;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["install"];
    if (this.#withDeps) argv.push("--with-deps");
    argv.push(...this.#browsers);
    return argv;
  }
}

/** Settings for `playwright show-report`. */
export class PlaywrightShowReportSettings extends PlaywrightSettings {
  #dir?: string;

  /** The report directory to open; omit for the default. */
  dir(path: string): this {
    this.#dir = path;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["show-report"];
    if (this.#dir !== undefined) argv.push(this.#dir);
    return argv;
  }
}

/** Settings for `playwright codegen`. */
export class PlaywrightCodegenSettings extends PlaywrightSettings {
  #url?: string;
  #target?: string;
  #output?: string;

  /** The URL to open for recording; omit to start blank. */
  url(value: string): this {
    this.#url = value;
    return this;
  }

  /** The output language (`--target=`, e.g. `javascript`, `python`). */
  target(language: string): this {
    this.#target = language;
    return this;
  }

  /** Write the generated script to a file (`--output=`). */
  output(path: string): this {
    this.#output = path;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["codegen"];
    if (this.#target !== undefined) argv.push(`--target=${this.#target}`);
    if (this.#output !== undefined) argv.push(`--output=${this.#output}`);
    if (this.#url !== undefined) argv.push(this.#url);
    return argv;
  }
}

/** The shape of {@link PlaywrightTasks}. */
export interface PlaywrightTasksApi {
  /** Run the test suite: `playwright test`. */
  test(configure?: Configure<PlaywrightTestSettings>): Promise<CommandOutput>;
  /** Install browser binaries: `playwright install`. */
  install(
    configure?: Configure<PlaywrightInstallSettings>,
  ): Promise<CommandOutput>;
  /** Open the HTML report: `playwright show-report`. */
  showReport(
    configure?: Configure<PlaywrightShowReportSettings>,
  ): Promise<CommandOutput>;
  /** Record interactions into a script: `playwright codegen`. */
  codegen(
    configure?: Configure<PlaywrightCodegenSettings>,
  ): Promise<CommandOutput>;
}

/** Typed task functions for the Playwright CLI. */
export const PlaywrightTasks: PlaywrightTasksApi = {
  /** Run the test suite: `playwright test`. */
  test(configure?: Configure<PlaywrightTestSettings>): Promise<CommandOutput> {
    return runSettings(new PlaywrightTestSettings(), configure);
  },
  /** Install browser binaries: `playwright install`. */
  install(
    configure?: Configure<PlaywrightInstallSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new PlaywrightInstallSettings(), configure);
  },
  /** Open the HTML report: `playwright show-report`. */
  showReport(
    configure?: Configure<PlaywrightShowReportSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new PlaywrightShowReportSettings(), configure);
  },
  /** Record interactions into a script: `playwright codegen`. */
  codegen(
    configure?: Configure<PlaywrightCodegenSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new PlaywrightCodegenSettings(), configure);
  },
};

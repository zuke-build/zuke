/**
 * `NpxTasks` — typed task functions for the `npx` package runner, in the
 * settings-lambda style: configure a fluent settings object in a lambda, and
 * the task function builds the command line and executes it.
 *
 * ```ts
 * import { NpxTasks } from "jsr:@zuke/npx";
 * await NpxTasks.npx((s) => s.command("cowsay").yes().execArgs("hello"));
 * ```
 *
 * `npx` downloads and runs a package binary in one step; it is npm's sibling of
 * `bun x` and `pnpm dlx`. On Windows, npx ships as a `.cmd` shim; the shared
 * tooling base retries through `cmd /c` automatically when direct spawning
 * fails.
 *
 * @module
 */

import { type Configure, runSettings, ToolSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/** Settings for the `npx` package runner. */
export class NpxSettings extends ToolSettings {
  #command?: string;
  #packages: string[] = [];
  #call?: string;
  #yes = false;
  #no = false;
  #ignoreExisting = false;
  #execArgs: string[] = [];

  protected override defaultTool(): string {
    return "npx";
  }

  /** The package binary to execute (required unless {@link call} is set). */
  command(name: string): this {
    this.#command = name;
    return this;
  }

  /** Packages to load before running (`--package=`); repeatable. */
  package(...specs: string[]): this {
    this.#packages.push(...specs);
    return this;
  }

  /** Execute a string as if inside `npm run-script` (`--call`). */
  call(script: string): this {
    this.#call = script;
    return this;
  }

  /** Auto-install a missing package without prompting (`--yes`). */
  yes(): this {
    this.#yes = true;
    return this;
  }

  /** Never auto-install; fail if the package is missing (`--no`). */
  no(): this {
    this.#no = true;
    return this;
  }

  /** Ignore binaries already present in `$PATH` (`--ignore-existing`). */
  ignoreExisting(): this {
    this.#ignoreExisting = true;
    return this;
  }

  /** Arguments forwarded to the command. */
  execArgs(...args: Array<string | number>): this {
    this.#execArgs.push(...args.map(String));
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#command === undefined && this.#call === undefined) {
      throw new Error("NpxTasks.npx: .command() or .call() is required.");
    }
    const argv: string[] = [];
    for (const spec of this.#packages) argv.push(`--package=${spec}`);
    if (this.#yes) argv.push("--yes");
    if (this.#no) argv.push("--no");
    if (this.#ignoreExisting) argv.push("--ignore-existing");
    if (this.#call !== undefined) argv.push("--call", this.#call);
    if (this.#command !== undefined) argv.push(this.#command);
    argv.push(...this.#execArgs);
    return argv;
  }
}

/** The shape of {@link NpxTasks}. */
export interface NpxTasksApi {
  /** Download and execute a package binary: `npx <command>`. */
  npx(configure?: Configure<NpxSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `npx` package runner. */
export const NpxTasks: NpxTasksApi = {
  /** Download and execute a package binary: `npx <command>`. */
  npx(configure?: Configure<NpxSettings>): Promise<CommandOutput> {
    return runSettings(new NpxSettings(), configure);
  },
};

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A wrapper for the tool bridge's tests, shaped like a published one: a
 * settings class on the core base, a task object of functions. Its tool is
 * the running Deno, so a call spawns nothing the suite does not already have.
 *
 * @module
 */

import { type Configure, runSettings, ToolSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/** Settings for the fake tool: what its `deno eval` prints and how it exits. */
export class FakeSettings extends ToolSettings {
  #prints: string[] = [];
  #exitCode = 0;

  protected override defaultTool(): string {
    return Deno.execPath();
  }

  protected override buildArgs(): string[] {
    const lines = this.#prints.map((line) => `console.log(${line});`).join("");
    return ["eval", `${lines}Deno.exit(${this.#exitCode});`];
  }

  /** Print `text`. */
  prints(text: string): this {
    this.#prints.push(JSON.stringify(text));
    return this;
  }

  /** Print the environment variable `name` as the child sees it. */
  printsEnv(name: string): this {
    this.#prints.push(`String(Deno.env.get(${JSON.stringify(name)}))`);
    return this;
  }

  /** Print the child's working directory. */
  printsCwd(): this {
    this.#prints.push("Deno.cwd()");
    return this;
  }

  /** Exit with `code`. */
  exits(code: number): this {
    this.#exitCode = code;
    return this;
  }

  /** Wait `ms` before exiting, for a test that must catch the command running. */
  sleeps(ms: number): this {
    this.#prints.push(`await new Promise((r) => setTimeout(r, ${ms})), ""`);
    return this;
  }
}

/** Settings of a task that runs no command: a plain object with setters. */
export class Tuning {
  /** The level set last. */
  level_ = 0;

  /** Set the level. */
  level(n: number): this {
    this.level_ = n;
    return this;
  }

  /** Back to zero; answers nothing, as a setter written as a statement might. */
  reset(): void {
    this.level_ = 0;
  }
}

/** The fake wrapper's tasks: a command, and plain functions of several shapes. */
export const FakeTasks = {
  /** Run the fake tool as configured. */
  echo: (configure?: Configure<FakeSettings>): Promise<CommandOutput> =>
    runSettings(new FakeSettings(), configure),
  /** A task of positional JSON arguments with a JSON result. */
  add: (a: number, b: number): number => a + b,
  /** A task with nothing to say. */
  nothing: (): void => {},
  /** A task whose result JSON cannot carry. */
  huge: (): bigint => 1n,
  /** A task configured through settings that run nothing. */
  tune: (configure: Configure<Tuning>): number =>
    configure(new Tuning()).level_,
};

/** An export that is not a task object. */
export const NotTasks = 3;

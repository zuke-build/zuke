// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The commands that run something: `npm run`, `npm exec`, and `npm test`.
 *
 * ```ts
 * import { NpmTasks } from "jsr:@zuke/npm";
 * await NpmTasks.run((s) => s.script("build").workspace("app"));
 * await NpmTasks.exec((s) => s.command("tsc").execArgs("--noEmit"));
 * await NpmTasks.test();
 * ```
 *
 * @module
 */

import { NpmWorkspaceSettings } from "./settings.ts";

/** Settings for `npm run`. */
export class NpmRunSettings extends NpmWorkspaceSettings {
  #script?: string;
  #ifPresent = false;
  #scriptArgs: string[] = [];

  /** The package.json script to run (required). */
  script(name: string): this {
    this.#script = name;
    return this;
  }

  /** Do not fail when the script is missing (`--if-present`). */
  ifPresent(): this {
    this.#ifPresent = true;
    return this;
  }

  /** Arguments forwarded to the script (after `--`). */
  scriptArgs(...args: Array<string | number>): this {
    this.#scriptArgs.push(...args.map(String));
    return this;
  }

  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "run";

  /** Assemble the `npm run` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#script === undefined) {
      throw new Error("NpmTasks.run: .script() is required.");
    }
    const argv = ["run", ...this.workspaceArgs()];
    if (this.#ifPresent) argv.push("--if-present");
    argv.push(this.#script);
    if (this.#scriptArgs.length > 0) argv.push("--", ...this.#scriptArgs);
    return argv;
  }
}

/** Settings for `npm test`. */
export class NpmTestSettings extends NpmWorkspaceSettings {
  #testArgs: string[] = [];

  /** Arguments forwarded to the test script (after `--`). */
  testArgs(...args: Array<string | number>): this {
    this.#testArgs.push(...args.map(String));
    return this;
  }

  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "test";

  /** Assemble the `npm test` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["test", ...this.workspaceArgs()];
    if (this.#testArgs.length > 0) argv.push("--", ...this.#testArgs);
    return argv;
  }
}

/** Settings for `npm exec`. */
export class NpmExecSettings extends NpmWorkspaceSettings {
  #command?: string;
  #package?: string;
  #yes = false;
  #no = false;
  #execArgs: string[] = [];

  /** The command to execute (required). */
  command(name: string): this {
    this.#command = name;
    return this;
  }

  /** The package providing the command (`--package=`). */
  package(spec: string): this {
    this.#package = spec;
    return this;
  }

  /** Skip the install prompt (`--yes`). */
  yes(): this {
    this.#yes = true;
    return this;
  }

  /**
   * Refuse to install anything (`--no`), so the command runs only if it is
   * already present — what a hermetic CI step wants instead of a silent fetch.
   */
  no(): this {
    this.#no = true;
    return this;
  }

  /** Arguments forwarded to the command (after `--`). */
  execArgs(...args: Array<string | number>): this {
    this.#execArgs.push(...args.map(String));
    return this;
  }

  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "exec";

  /** Assemble the `npm exec` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#command === undefined) {
      throw new Error("NpmTasks.exec: .command() is required.");
    }
    if (this.#yes && this.#no) {
      throw new Error(
        "NpmTasks.exec: .yes() installs what is missing and .no() refuses to " +
          "— pick one.",
      );
    }
    const argv = ["exec"];
    if (this.#yes) argv.push("--yes");
    if (this.#no) argv.push("--no");
    if (this.#package !== undefined) argv.push(`--package=${this.#package}`);
    argv.push(...this.workspaceArgs());
    argv.push(this.#command);
    if (this.#execArgs.length > 0) argv.push("--", ...this.#execArgs);
    return argv;
  }
}

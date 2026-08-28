// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The two bases every `npm` subcommand's settings extend.
 *
 * {@link NpmSettings} carries the binary and the flags npm reads as *config*,
 * which it accepts on any command (`--registry`, `--json`, `--loglevel`,
 * `--global`). {@link NpmWorkspaceSettings} adds the workspace selectors that
 * about twenty npm commands share, so the rule that `--workspace` and
 * `--workspaces` are alternatives has exactly one implementation rather than
 * one per command.
 *
 * @module
 */

import { type PathLike, ToolSettings } from "@zuke/core/tooling";

/** A dependency group accepted by npm's `--omit` flag. */
export type NpmOmitType = "dev" | "optional" | "peer";

/** A dependency group accepted by npm's `--include` flag. */
export type NpmIncludeType = "prod" | "dev" | "optional" | "peer";

/** An access level accepted by npm's `--access` flag. */
export type NpmAccess = "public" | "restricted";

/** How verbose npm should be (`--loglevel`). */
export type NpmLogLevel =
  | "silent"
  | "error"
  | "warn"
  | "notice"
  | "http"
  | "info"
  | "verbose"
  | "silly";

/**
 * Shared base for every `npm` subcommand: the binary, and the flags npm treats
 * as configuration rather than as a command's own — it accepts these on any
 * command, which is why they live here instead of being repeated.
 */
export abstract class NpmSettings extends ToolSettings {
  #registry?: string;
  #json = false;
  #logLevel?: NpmLogLevel;
  #global = false;
  #prefix?: string;
  #userconfig?: string;

  /** The default binary: `npm` resolved from PATH. */
  protected override defaultTool(): string {
    return "npm";
  }

  /** The subcommand argv, before the shared config flags are appended. */
  protected abstract subcommandArgs(): string[];

  /**
   * The `NpmTasks` method this settings class backs, for the errors it
   * reports — so a failure names the task a build called, not the class. A
   * field rather than a method: it is the class's identity, not a
   * computation.
   */
  protected abstract readonly taskName: string;

  /** Use a specific registry (`--registry=<url>`). */
  registry(url: string): this {
    this.#registry = url;
    return this;
  }

  /**
   * Emit JSON (`--json`). The value-returning tasks set this themselves; a
   * caller reaches for it to parse output the wrapper does not yet model.
   */
  json(): this {
    this.#json = true;
    return this;
  }

  /** How much npm prints (`--loglevel=<level>`). */
  logLevel(level: NpmLogLevel): this {
    this.#logLevel = level;
    return this;
  }

  /** Operate on the global install rather than the project (`--global`). */
  global(): this {
    this.#global = true;
    return this;
  }

  /** Run as if npm were started in this directory (`--prefix=<path>`). */
  prefix(path: PathLike): this {
    this.#prefix = String(path);
    return this;
  }

  /** Read this user config file rather than `~/.npmrc` (`--userconfig=<path>`). */
  userconfig(path: PathLike): this {
    this.#userconfig = String(path);
    return this;
  }

  /** The config flags, rendered after the subcommand's own arguments. */
  protected configArgs(): string[] {
    const argv: string[] = [];
    if (this.#global) argv.push("--global");
    if (this.#json) argv.push("--json");
    if (this.#registry !== undefined) argv.push(`--registry=${this.#registry}`);
    if (this.#logLevel !== undefined) {
      argv.push(`--loglevel=${this.#logLevel}`);
    }
    if (this.#prefix !== undefined) argv.push(`--prefix=${this.#prefix}`);
    if (this.#userconfig !== undefined) {
      argv.push(`--userconfig=${this.#userconfig}`);
    }
    return argv;
  }

  /**
   * Assemble the `npm` argv: the subcommand, then the shared config flags —
   * but *before* any `--`, because everything after that separator belongs to
   * the script or the executed command rather than to npm. Appending blindly
   * would hand `--json` to the script and leave npm's own output unchanged.
   */
  protected override buildArgs(): string[] {
    const subcommand = this.subcommandArgs();
    const config = this.configArgs();
    if (config.length === 0) return subcommand;
    const separator = subcommand.indexOf("--");
    if (separator === -1) return [...subcommand, ...config];
    return [
      ...subcommand.slice(0, separator),
      ...config,
      ...subcommand.slice(separator),
    ];
  }
}

/**
 * Base for the npm commands that accept workspace selection. `--workspace`
 * names one (repeatable) and `--workspaces` means all of them; npm takes one
 * or the other, and this refuses the combination rather than passing on a
 * command whose meaning is ambiguous.
 */
export abstract class NpmWorkspaceSettings extends NpmSettings {
  #workspaces: string[] = [];
  #allWorkspaces = false;
  #includeWorkspaceRoot = false;

  /** Run in this workspace (`--workspace=<name>`); repeatable. */
  workspace(...names: string[]): this {
    this.#workspaces.push(...names);
    return this;
  }

  /**
   * Run in **every** workspace (`--workspaces`). Mutually exclusive with
   * {@link workspace} — setting both is a build error.
   */
  workspaces(): this {
    this.#allWorkspaces = true;
    return this;
  }

  /** Include the root project alongside the workspaces (`--include-workspace-root`). */
  includeWorkspaceRoot(): this {
    this.#includeWorkspaceRoot = true;
    return this;
  }

  /**
   * The workspace flags, after refusing a selection that names both one
   * workspace and all of them.
   */
  protected workspaceArgs(): string[] {
    if (this.#workspaces.length > 0 && this.#allWorkspaces) {
      throw new Error(
        `NpmTasks.${this.taskName}: .workspace() and .workspaces() are ` +
          `mutually exclusive — pick one workspace or all of them, not both.`,
      );
    }
    const argv = this.#workspaces.map((name) => `--workspace=${name}`);
    if (this.#allWorkspaces) argv.push("--workspaces");
    if (this.#includeWorkspaceRoot) argv.push("--include-workspace-root");
    return argv;
  }
}

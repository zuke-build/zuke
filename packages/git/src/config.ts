// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `git config` — reading and writing configuration values.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * await GitTasks.config((s) => s.set("user.name", "ci-bot").local());
 * const url = await GitTasks.configGet((s) => s.get("remote.origin.url"));
 * ```
 *
 * {@link "./git.ts".GitTasks.configGet} hands back the value — or `undefined`
 * when the key is unset, which `git config --get` reports as exit code 1
 * rather than as empty output. A build asking whether something is configured
 * gets an answer instead of an exception.
 *
 * @module
 */

import type { Configure, PathLike } from "@zuke/core/tooling";
import { GitSettings } from "./settings.ts";

/** Which `git config` operation a {@link GitConfigSettings} runs. */
type ConfigMode = "get" | "get-all" | "set" | "add" | "unset" | "list";

/** Which configuration file a {@link GitConfigSettings} reads or writes. */
type ConfigScope = "global" | "local" | "system" | "worktree";

/**
 * Settings for `git config`. Pick the operation with {@link get},
 * {@link getAll}, {@link set}, {@link add}, {@link unset}, or {@link list},
 * and the file with {@link global}, {@link local}, {@link system},
 * {@link worktree}, or {@link file}.
 */
export class GitConfigSettings extends GitSettings {
  #mode?: ConfigMode;
  #key?: string;
  #value?: string;
  #scope?: ConfigScope;
  #file?: string;
  #default?: string;

  /** Read a key's value (`--get <key>`). */
  get(key: string): this {
    this.#mode = "get";
    this.#key = key;
    return this;
  }

  /** Read every value of a multi-valued key (`--get-all <key>`). */
  getAll(key: string): this {
    this.#mode = "get-all";
    this.#key = key;
    return this;
  }

  /** Set a key, replacing any existing value (`git config <key> <value>`). */
  set(key: string, value: string): this {
    this.#mode = "set";
    this.#key = key;
    this.#value = value;
    return this;
  }

  /** Add another value to a multi-valued key (`--add <key> <value>`). */
  add(key: string, value: string): this {
    this.#mode = "add";
    this.#key = key;
    this.#value = value;
    return this;
  }

  /** Remove a key (`--unset <key>`). */
  unset(key: string): this {
    this.#mode = "unset";
    this.#key = key;
    return this;
  }

  /** List every configured key (`--list`). */
  list(): this {
    this.#mode = "list";
    return this;
  }

  /** Use the user's configuration (`--global`). */
  global(): this {
    this.#scope = "global";
    return this;
  }

  /** Use the repository's configuration (`--local`). */
  local(): this {
    this.#scope = "local";
    return this;
  }

  /** Use the machine's configuration (`--system`). */
  system(): this {
    this.#scope = "system";
    return this;
  }

  /** Use the worktree's configuration (`--worktree`). */
  worktree(): this {
    this.#scope = "worktree";
    return this;
  }

  /** Use a specific file (`--file <path>`), rather than one of the scopes. */
  file(path: PathLike): this {
    this.#file = String(path);
    return this;
  }

  /**
   * What to report when the key is unset (`--default <value>`), which also
   * makes `--get` exit 0 instead of 1.
   */
  defaultValue(value: string): this {
    this.#default = value;
    return this;
  }

  /** Assemble the `git config` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#mode === undefined) {
      throw new Error(
        "GitTasks.config: no operation — call .get(key), .getAll(key), " +
          ".set(key, value), .add(key, value), .unset(key), or .list().",
      );
    }
    if (this.#scope !== undefined && this.#file !== undefined) {
      throw new Error(
        "GitTasks.config: .file(...) already names the file to use, so a " +
          "scope flag has nothing left to pick — drop one.",
      );
    }
    const argv = ["config"];
    if (this.#scope !== undefined) argv.push(`--${this.#scope}`);
    if (this.#file !== undefined) argv.push("--file", this.#file);
    if (this.#default !== undefined) argv.push("--default", this.#default);
    if (this.#mode !== "set") argv.push(`--${this.#mode}`);
    if (this.#key !== undefined) argv.push(this.#key);
    if (this.#value !== undefined) argv.push(this.#value);
    return argv;
  }
}

/**
 * Run `git config --get` and hand back the value, or `undefined` when the key
 * is unset. Backs {@link "./git.ts".GitTasks.configGet}.
 *
 * The lambda must pick the key with `.get(...)` or `.getAll(...)`; anything
 * that writes is refused, since there would be no value to return.
 */
export async function readConfigValue(
  configure?: Configure<GitConfigSettings>,
): Promise<string | undefined> {
  const settings = new GitConfigSettings();
  const configured = configure ? configure(settings) : settings;
  const argv = configured.argv();
  if (!argv.includes("--get") && !argv.includes("--get-all")) {
    throw new Error(
      "GitTasks.configGet: pick the key to read with .get(key) or " +
        ".getAll(key) — the other operations produce no value.",
    );
  }
  // `--get` exits 1 for an unset key, which is an answer, not a failure.
  const output = await configured.noThrow().run();
  if (output.code !== 0) return undefined;
  const value = output.stdout.replace(/\n$/, "");
  return value === "" ? undefined : value;
}

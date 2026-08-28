// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The commands that read or write the project's own files and npm's local
 * state: `npm init`, `pkg`, `config`, and `cache`.
 *
 * ```ts
 * import { NpmTasks } from "jsr:@zuke/npm";
 * const version = await NpmTasks.pkgGet("version");
 * await NpmTasks.pkg((s) => s.set(`version=${next}`));
 * await NpmTasks.cache((s) => s.verify());
 * ```
 *
 * {@link "./npm.ts".NpmTasks.pkgGet} is the value-returning form: one
 * `package.json` field as a string, so a build reads its own version without
 * parsing the file itself and without guessing where the manifest is in a
 * workspace.
 *
 * @module
 */

import type { Configure, PathLike } from "@zuke/core/tooling";
import { NpmSettings, NpmWorkspaceSettings } from "./settings.ts";
import { parseJsonRecord } from "./json.ts";

/** Settings for `npm init`. */
export class NpmInitSettings extends NpmWorkspaceSettings {
  #initializer?: string;
  #yes = false;
  #scope?: string;
  #initArgs: string[] = [];

  /**
   * The initializer package to run, e.g. `vite` for `npm init vite`
   * (positional). With none, npm writes a `package.json` itself.
   */
  initializer(spec: string): this {
    this.#initializer = spec;
    return this;
  }

  /** Accept the defaults instead of prompting (`--yes`). */
  yes(): this {
    this.#yes = true;
    return this;
  }

  /** Scope the created package (`--scope=<@scope>`). */
  scope(name: string): this {
    this.#scope = name;
    return this;
  }

  /** Arguments forwarded to the initializer (after `--`). */
  initArgs(...args: Array<string | number>): this {
    this.#initArgs.push(...args.map(String));
    return this;
  }

  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "init";

  /** Assemble the `npm init` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#initArgs.length > 0 && this.#initializer === undefined) {
      throw new Error(
        "NpmTasks.init: .initArgs(...) are passed to an initializer — call " +
          ".initializer(...), or drop them.",
      );
    }
    const argv = ["init"];
    if (this.#yes) argv.push("--yes");
    if (this.#scope !== undefined) argv.push(`--scope=${this.#scope}`);
    argv.push(...this.workspaceArgs());
    if (this.#initializer !== undefined) argv.push(this.#initializer);
    if (this.#initArgs.length > 0) argv.push("--", ...this.#initArgs);
    return argv;
  }
}

/** Which `npm pkg` subcommand a {@link NpmPkgSettings} runs. */
type PkgMode = "get" | "set" | "delete" | "fix";

/**
 * Settings for `npm pkg`. Pick the operation with {@link get}, {@link set},
 * {@link deleteKeys}, or {@link fix}.
 */
export class NpmPkgSettings extends NpmWorkspaceSettings {
  #mode?: PkgMode;
  #args: string[] = [];
  #force = false;

  /** Read one or more `package.json` fields (`pkg get <key>...`). */
  get(...keys: string[]): this {
    this.#mode = "get";
    this.#args = keys;
    return this;
  }

  /**
   * Write fields (`pkg set <key>=<value>...`). Each argument is npm's own
   * `key=value` form, which is also how it addresses arrays and nested keys.
   */
  set(...assignments: string[]): this {
    this.#mode = "set";
    this.#args = assignments;
    return this;
  }

  /** Remove fields (`pkg delete <key>...`). */
  deleteKeys(...keys: string[]): this {
    this.#mode = "delete";
    this.#args = keys;
    return this;
  }

  /** Repair what npm can correct automatically (`pkg fix`). */
  fix(): this {
    this.#mode = "fix";
    this.#args = [];
    return this;
  }

  /** Skip npm's confirmation for a destructive edit (`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "pkg";

  /** Assemble the `npm pkg` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#mode === undefined) {
      throw new Error(
        'NpmTasks.pkg: no operation — call .get(key), .set("key=value"), ' +
          ".deleteKeys(key), or .fix().",
      );
    }
    if (this.#mode !== "fix" && this.#args.length === 0) {
      throw new Error(
        `NpmTasks.pkg: .${
          this.#mode === "delete" ? "deleteKeys" : this.#mode
        }` +
          `(...) needs at least one key.`,
      );
    }
    if (this.#mode === "set") {
      const bare = this.#args.find((assignment) => !assignment.includes("="));
      if (bare !== undefined) {
        throw new Error(
          `NpmTasks.pkg: .set(...) takes npm's "key=value" form, but got ` +
            `"${bare}" — npm would read it as a key with no value.`,
        );
      }
    }
    const argv = ["pkg", this.#mode, ...this.#args];
    if (this.#force) argv.push("--force");
    argv.push(...this.workspaceArgs());
    return argv;
  }
}

/**
 * The scalar `npm pkg get <key>` reported, or `undefined` when the field is
 * unset or is not a scalar.
 *
 * npm answers with JSON, so a string field arrives quoted, a missing one
 * arrives as `{}`, and asking within a workspace (or for several keys) yields
 * an object keyed by what was asked for — this reads all three. An object or
 * array field yields `undefined`, because there is no single string to hand
 * back.
 *
 * Not part of the package's public surface — exported for its unit test.
 */
export function parsePkgField(
  stdout: string,
  key: string,
): string | undefined {
  const text = stdout.trim();
  if (text === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const scalar = asScalar(parsed);
  if (scalar !== undefined) return scalar;
  const record = parseJsonRecord(text);
  return record === undefined ? undefined : asScalar(record[key]);
}

/** A JSON scalar as a string; `undefined` for an object, array, or null. */
function asScalar(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

/**
 * Run `npm pkg get <key> --json` and read the field out of it. Backs
 * {@link "./npm.ts".NpmTasks.pkgGet}.
 */
export async function readPkgField(
  key: string,
  configure?: Configure<NpmPkgSettings>,
): Promise<string | undefined> {
  const settings = new NpmPkgSettings();
  const configured = (configure ? configure(settings) : settings).get(key);
  // An unset field, or a directory that is not a package, is an answer here.
  const output = await configured.json().noThrow().run();
  return output.code === 0 ? parsePkgField(output.stdout, key) : undefined;
}

/** Which `npm config` subcommand a {@link NpmConfigSettings} runs. */
type ConfigMode = "get" | "set" | "delete" | "list" | "fix";

/**
 * Settings for `npm config`. Pick the operation with {@link get}, {@link set},
 * {@link deleteKeys}, {@link list}, or {@link fix}.
 */
export class NpmConfigSettings extends NpmSettings {
  #mode?: ConfigMode;
  #args: string[] = [];
  #location?: string;
  #long = false;

  /** Read config keys (`config get <key>...`). */
  get(...keys: string[]): this {
    this.#mode = "get";
    this.#args = keys;
    return this;
  }

  /** Write config keys (`config set <key>=<value>...`). */
  set(...assignments: string[]): this {
    this.#mode = "set";
    this.#args = assignments;
    return this;
  }

  /** Remove config keys (`config delete <key>...`). */
  deleteKeys(...keys: string[]): this {
    this.#mode = "delete";
    this.#args = keys;
    return this;
  }

  /** List the effective configuration (`config list`). */
  list(): this {
    this.#mode = "list";
    this.#args = [];
    return this;
  }

  /** Repair invalid config entries (`config fix`). */
  fix(): this {
    this.#mode = "fix";
    this.#args = [];
    return this;
  }

  /** Which file to read or write (`--location=<global|user|project>`). */
  location(where: "global" | "user" | "project"): this {
    this.#location = where;
    return this;
  }

  /** Include defaults in a listing (`--long`). */
  long(): this {
    this.#long = true;
    return this;
  }

  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "config";

  /** Assemble the `npm config` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#mode === undefined) {
      throw new Error(
        "NpmTasks.config: no operation — call .get(key), " +
          '.set("key=value"), .deleteKeys(key), .list(), or .fix().',
      );
    }
    const argv = ["config", this.#mode, ...this.#args];
    if (this.#location !== undefined) argv.push(`--location=${this.#location}`);
    if (this.#long) argv.push("--long");
    return argv;
  }
}

/** Which `npm cache` subcommand a {@link NpmCacheSettings} runs. */
type CacheMode = "add" | "clean" | "ls" | "verify";

/**
 * Settings for `npm cache`. Pick the operation with {@link add},
 * {@link clean}, {@link ls}, or {@link verify}.
 */
export class NpmCacheSettings extends NpmSettings {
  #mode: CacheMode = "verify";
  #args: string[] = [];
  #cache?: string;
  #force = false;

  /** Add a package to the cache (`cache add <spec>`). */
  add(...specs: string[]): this {
    this.#mode = "add";
    this.#args = specs;
    return this;
  }

  /**
   * Empty the cache (`cache clean`). npm refuses this without `--force`, so
   * pair it with {@link force} — see the error this reports otherwise.
   */
  clean(key?: string): this {
    this.#mode = "clean";
    this.#args = key === undefined ? [] : [key];
    return this;
  }

  /** List what the cache holds (`cache ls`). */
  ls(...specs: string[]): this {
    this.#mode = "ls";
    this.#args = specs;
    return this;
  }

  /** Check and compact the cache (`cache verify`), the default. */
  verify(): this {
    this.#mode = "verify";
    this.#args = [];
    return this;
  }

  /** Use a specific cache directory (`--cache=<path>`). */
  cache(path: PathLike): this {
    this.#cache = String(path);
    return this;
  }

  /** Confirm a clean npm would otherwise refuse (`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "cache";

  /** Assemble the `npm cache` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#mode === "clean" && !this.#force) {
      throw new Error(
        "NpmTasks.cache: npm refuses to empty the cache without --force — " +
          "add .force(), which is what makes the removal deliberate.",
      );
    }
    if (this.#mode === "add" && this.#args.length === 0) {
      throw new Error(
        "NpmTasks.cache: .add(...) needs the package spec to cache.",
      );
    }
    const argv = ["cache", this.#mode, ...this.#args];
    if (this.#force) argv.push("--force");
    if (this.#cache !== undefined) argv.push(`--cache=${this.#cache}`);
    return argv;
  }
}

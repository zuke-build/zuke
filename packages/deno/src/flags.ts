// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The flag groups the `deno` CLI repeats across its subcommands, each holding
 * its own state and rendering its own argv fragment.
 *
 * These are composed into the settings classes as private fields rather than
 * inherited, because the CLI's groups do not nest: `deno task` takes the
 * lockfile and node-modules flags but not `--vendor`, `deno check` takes
 * `--vendor` but not `--cached-only`, and only `deno run` has `--watch-hmr`.
 * A base class granting a whole group would hand three subcommands flags they
 * reject.
 *
 * Composition puts the enforcement in the type system instead: a group holds
 * every flag in its CLI section, and each settings class exposes only the
 * setters its own subcommand accepts. The rendering has one implementation;
 * the public surface is what says which command may reach it.
 *
 * Nothing here is exported from `mod.ts` — these appear only in private
 * fields, never in a public signature.
 */

import type { PathLike } from "@zuke/core/tooling";

/** The node-modules management modes `--node-modules-dir` accepts. */
export type NodeModulesMode = "auto" | "manual" | "none";

/** The linker modes `--node-modules-linker` accepts. */
export type NodeModulesLinker = "isolated" | "hoisted";

/** How much `--check` type-checks, or how little `--no-check` skips. */
export type CheckScope = "all" | "remote";

/**
 * The lockfile and module-resolution flags from the CLI's "Dependency
 * management options" section.
 *
 * Every subcommand carrying that section takes a subset of these, so the
 * settings class decides which setters exist; this class only records and
 * renders them.
 */
export class DependencyFlags {
  #frozen = false;
  #noLock = false;
  #lock?: string;
  #importMap?: string;
  #noNpm = false;
  #noRemote = false;
  #cachedOnly = false;
  #vendor?: boolean;
  #nodeModulesDir?: NodeModulesMode;
  #nodeModulesLinker?: NodeModulesLinker;
  #reload: string[] = [];
  #reloadAll = false;

  /** Record `--frozen`. */
  frozen(): void {
    this.#frozen = true;
  }

  /** Record `--no-lock`. */
  noLock(): void {
    this.#noLock = true;
  }

  /** Record `--lock <file>`. */
  lock(path: PathLike): void {
    this.#lock = String(path);
  }

  /** Record `--import-map <file>`. */
  importMap(path: PathLike): void {
    this.#importMap = String(path);
  }

  /** Record `--no-npm`. */
  noNpm(): void {
    this.#noNpm = true;
  }

  /** Record `--no-remote`. */
  noRemote(): void {
    this.#noRemote = true;
  }

  /** Record `--cached-only`. */
  cachedOnly(): void {
    this.#cachedOnly = true;
  }

  /** Record `--vendor[=<bool>]`. */
  vendor(enabled: boolean): void {
    this.#vendor = enabled;
  }

  /** Record `--node-modules-dir=<mode>`. */
  nodeModulesDir(mode: NodeModulesMode): void {
    this.#nodeModulesDir = mode;
  }

  /** Record `--node-modules-linker=<mode>`. */
  nodeModulesLinker(mode: NodeModulesLinker): void {
    this.#nodeModulesLinker = mode;
  }

  /**
   * Record `--reload`, optionally scoped to specifiers. With no specifiers it
   * reloads everything; scoped calls accumulate, and a bare call anywhere
   * makes the whole thing unscoped, which is what deno does with the flag.
   */
  reload(specifiers: string[]): void {
    if (specifiers.length === 0) this.#reloadAll = true;
    else this.#reload.push(...specifiers);
  }

  /** The recorded flags, in the CLI's own order. */
  render(): string[] {
    const argv: string[] = [];
    if (this.#frozen) argv.push("--frozen");
    if (this.#noLock) argv.push("--no-lock");
    if (this.#lock !== undefined) argv.push("--lock", this.#lock);
    if (this.#importMap !== undefined) {
      argv.push("--import-map", this.#importMap);
    }
    if (this.#noNpm) argv.push("--no-npm");
    if (this.#noRemote) argv.push("--no-remote");
    if (this.#cachedOnly) argv.push("--cached-only");
    if (this.#vendor !== undefined) argv.push(`--vendor=${this.#vendor}`);
    if (this.#nodeModulesDir !== undefined) {
      argv.push(`--node-modules-dir=${this.#nodeModulesDir}`);
    }
    if (this.#nodeModulesLinker !== undefined) {
      argv.push(`--node-modules-linker=${this.#nodeModulesLinker}`);
    }
    if (this.#reloadAll) argv.push("--reload");
    else if (this.#reload.length > 0) {
      argv.push(`--reload=${this.#reload.join(",")}`);
    }
    return argv;
  }
}

/** The CLI's "File watching options" section. */
export class WatchFlags {
  #watch = false;
  #hmr = false;
  #exclude: string[] = [];
  #noClearScreen = false;

  /** Record `--watch`. */
  watch(): void {
    this.#watch = true;
  }

  /** Record `--watch-hmr`, which only `deno run` accepts. */
  watchHmr(): void {
    this.#hmr = true;
  }

  /** Record `--watch-exclude=<paths>`. */
  exclude(paths: string[]): void {
    this.#exclude.push(...paths);
  }

  /** Record `--no-clear-screen`. */
  noClearScreen(): void {
    this.#noClearScreen = true;
  }

  /** The recorded flags; hot-module reload implies watching, so it wins. */
  render(): string[] {
    const argv: string[] = [];
    if (this.#hmr) argv.push("--watch-hmr");
    else if (this.#watch) argv.push("--watch");
    if (this.#exclude.length > 0) {
      argv.push(`--watch-exclude=${this.#exclude.join(",")}`);
    }
    if (this.#noClearScreen) argv.push("--no-clear-screen");
    return argv;
  }
}

/** The CLI's "Type checking options" section. */
export class TypeCheckFlags {
  #check?: CheckScope | true;
  #noCheck?: CheckScope | true;

  /** Record `--check[=<scope>]`. */
  check(scope?: CheckScope): void {
    this.#check = scope ?? true;
  }

  /** Record `--no-check[=<scope>]`. */
  noCheck(scope?: CheckScope): void {
    this.#noCheck = scope ?? true;
  }

  /** Whether both `--check` and `--no-check` were asked for. */
  get contradictory(): boolean {
    return this.#check !== undefined && this.#noCheck !== undefined;
  }

  /** The recorded flags. */
  render(): string[] {
    const argv: string[] = [];
    if (this.#check !== undefined) {
      argv.push(this.#check === true ? "--check" : `--check=${this.#check}`);
    }
    if (this.#noCheck !== undefined) {
      argv.push(
        this.#noCheck === true ? "--no-check" : `--no-check=${this.#noCheck}`,
      );
    }
    return argv;
  }
}

/** The CLI's "Debugging options" section. */
export class DebugFlags {
  #flag?: string;

  /** Record `--inspect[=<host:port>]`. */
  inspect(hostPort?: string): void {
    this.#set("--inspect", hostPort);
  }

  /** Record `--inspect-brk[=<host:port>]`. */
  inspectBrk(hostPort?: string): void {
    this.#set("--inspect-brk", hostPort);
  }

  /** Record `--inspect-wait[=<host:port>]`. */
  inspectWait(hostPort?: string): void {
    this.#set("--inspect-wait", hostPort);
  }

  #set(name: string, hostPort: string | undefined): void {
    this.#flag = hostPort === undefined ? name : `${name}=${hostPort}`;
  }

  /** Whether any inspector was asked for. */
  get attached(): boolean {
    return this.#flag !== undefined;
  }

  /**
   * The recorded flag. Only one inspector can be attached, so a later call
   * replaces an earlier one rather than emitting two.
   */
  render(): string[] {
    return this.#flag === undefined ? [] : [this.#flag];
  }
}

/** The file-selection flags `fmt`, `lint`, `test` and `bench` share. */
export class FileSelectionFlags {
  #ext?: string;
  #ignore: string[] = [];
  #permitNoFiles = false;

  /** Record `--ext <ext>`. */
  ext(value: string): void {
    this.#ext = value;
  }

  /** Record `--ignore=<patterns>`. */
  ignore(patterns: string[]): void {
    this.#ignore.push(...patterns);
  }

  /** Record `--permit-no-files`. */
  permitNoFiles(): void {
    this.#permitNoFiles = true;
  }

  /** The recorded flags. */
  render(): string[] {
    const argv: string[] = [];
    if (this.#ext !== undefined) argv.push("--ext", this.#ext);
    if (this.#ignore.length > 0) {
      argv.push(`--ignore=${this.#ignore.join(",")}`);
    }
    if (this.#permitNoFiles) argv.push("--permit-no-files");
    return argv;
  }
}

/** The runtime flags the subcommands that execute code share. */
export class RuntimeFlags {
  #cert?: string;
  #envFile?: string;
  #location?: string;
  #seed?: number;
  #v8Flags: string[] = [];
  #conditions: string[] = [];
  #preload: string[] = [];
  #require: string[] = [];
  #allowScripts?: string[];
  #noCodeCache = false;

  /** Record `--cert <file>`. */
  cert(path: PathLike): void {
    this.#cert = String(path);
  }

  /** Record `--env-file=<file>`. */
  envFile(path: PathLike): void {
    this.#envFile = String(path);
  }

  /** Record `--location <href>`. */
  location(href: string): void {
    this.#location = href;
  }

  /** Record `--seed <number>`. */
  seed(value: number): void {
    this.#seed = value;
  }

  /** Record `--v8-flags=<flags>`. */
  v8Flags(flags: string[]): void {
    this.#v8Flags.push(...flags);
  }

  /** Record `--conditions <list>`. */
  conditions(values: string[]): void {
    this.#conditions.push(...values);
  }

  /** Record `--preload <file>`. */
  preload(paths: string[]): void {
    this.#preload.push(...paths);
  }

  /** Record `--require <file>`. */
  require(paths: string[]): void {
    this.#require.push(...paths);
  }

  /** Record `--allow-scripts[=<packages>]`. */
  allowScripts(packages: string[]): void {
    this.#allowScripts = packages;
  }

  /** Record `--no-code-cache`. */
  noCodeCache(): void {
    this.#noCodeCache = true;
  }

  /** The recorded flags. */
  render(): string[] {
    const argv: string[] = [];
    if (this.#cert !== undefined) argv.push("--cert", this.#cert);
    if (this.#envFile !== undefined) argv.push(`--env-file=${this.#envFile}`);
    if (this.#location !== undefined) argv.push("--location", this.#location);
    if (this.#seed !== undefined) argv.push("--seed", String(this.#seed));
    if (this.#conditions.length > 0) {
      argv.push("--conditions", this.#conditions.join(","));
    }
    for (const path of this.#preload) argv.push("--preload", path);
    for (const path of this.#require) argv.push("--require", path);
    if (this.#allowScripts !== undefined) {
      argv.push(
        this.#allowScripts.length === 0
          ? "--allow-scripts"
          : `--allow-scripts=${this.#allowScripts.join(",")}`,
      );
    }
    if (this.#noCodeCache) argv.push("--no-code-cache");
    if (this.#v8Flags.length > 0) {
      argv.push(`--v8-flags=${this.#v8Flags.join(",")}`);
    }
    return argv;
  }
}

/** The config-file flags nearly every subcommand shares. */
export class ConfigFlags {
  #config?: string;
  #noConfig = false;

  /** Record `--config <file>`. */
  config(path: PathLike): void {
    this.#config = String(path);
  }

  /** Record `--no-config`. */
  noConfig(): void {
    this.#noConfig = true;
  }

  /** Whether both an explicit config and `--no-config` were asked for. */
  get contradictory(): boolean {
    return this.#config !== undefined && this.#noConfig;
  }

  /** The recorded flags. */
  render(): string[] {
    const argv: string[] = [];
    if (this.#config !== undefined) argv.push("--config", this.#config);
    if (this.#noConfig) argv.push("--no-config");
    return argv;
  }
}

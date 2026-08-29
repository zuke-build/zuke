// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for the `deno` subcommands that execute code a project already
 * defines: `run` and `task`.
 */

import type { PathLike } from "@zuke/core/tooling";
import { DenoPermissionSettings, DenoSettings } from "./settings.ts";
import {
  ConfigFlags,
  DebugFlags,
  DependencyFlags,
  type NodeModulesLinker,
  type NodeModulesMode,
  RuntimeFlags,
  TypeCheckFlags,
  WatchFlags,
} from "./flags.ts";

/** Settings for `deno run`. */
export class DenoRunSettings extends DenoPermissionSettings {
  #script?: string;
  #scriptArgs: string[] = [];
  #config = new ConfigFlags();
  #deps = new DependencyFlags();
  #runtime = new RuntimeFlags();
  #types = new TypeCheckFlags();
  #debug = new DebugFlags();
  #watch = new WatchFlags();

  /** The script to run (required). */
  script(path: PathLike): this {
    this.#script = String(path);
    return this;
  }

  /** Arguments passed to the script (after the script path). */
  scriptArgs(...args: Array<string | number>): this {
    this.#scriptArgs.push(...args.map(String));
    return this;
  }

  /** Use an explicit config file (`--config`). */
  config(path: PathLike): this {
    this.#config.config(path);
    return this;
  }

  /** Discover no configuration file at all (`--no-config`). */
  noConfig(): this {
    this.#config.noConfig();
    return this;
  }

  /** Reload the module cache (`--reload`), optionally only these specifiers. */
  reload(...specifiers: string[]): this {
    this.#deps.reload(specifiers);
    return this;
  }

  /** Use an explicit lockfile (`--lock`). */
  lock(path: PathLike): this {
    this.#deps.lock(path);
    return this;
  }

  /** Ignore the lockfile entirely (`--no-lock`). */
  noLock(): this {
    this.#deps.noLock();
    return this;
  }

  /** Load an import map from a file or URL (`--import-map`). */
  importMap(path: PathLike): this {
    this.#deps.importMap(path);
    return this;
  }

  /** Resolve only from the cache (`--cached-only`), fetching nothing. */
  cachedOnly(): this {
    this.#deps.cachedOnly();
    return this;
  }

  /** Do not resolve npm modules (`--no-npm`). */
  noNpm(): this {
    this.#deps.noNpm();
    return this;
  }

  /** Do not resolve remote modules (`--no-remote`). */
  noRemote(): this {
    this.#deps.noRemote();
    return this;
  }

  /** Set the node-modules management mode (`--node-modules-dir`). */
  nodeModulesDir(mode: NodeModulesMode): this {
    this.#deps.nodeModulesDir(mode);
    return this;
  }

  /** Set the npm linker mode (`--node-modules-linker`). */
  nodeModulesLinker(mode: NodeModulesLinker): this {
    this.#deps.nodeModulesLinker(mode);
    return this;
  }

  /** Toggle the local vendor folder (`--vendor`). */
  vendor(enabled = true): this {
    this.#deps.vendor(enabled);
    return this;
  }

  /** Load environment variables from a file (`--env-file`). */
  envFile(path: PathLike): this {
    this.#runtime.envFile(path);
    return this;
  }

  /** Load a certificate authority from a PEM file (`--cert`). */
  cert(path: PathLike): this {
    this.#runtime.cert(path);
    return this;
  }

  /** Set `globalThis.location` (`--location`). */
  location(href: string): this {
    this.#runtime.location(href);
    return this;
  }

  /** Seed the random number generator (`--seed`). */
  seed(value: number): this {
    this.#runtime.seed(value);
    return this;
  }

  /** Pass flags through to V8 (`--v8-flags`). */
  v8Flags(...flags: string[]): this {
    this.#runtime.v8Flags(flags);
    return this;
  }

  /** Resolve npm package exports with these conditions (`--conditions`). */
  conditions(...values: string[]): this {
    this.#runtime.conditions(values);
    return this;
  }

  /** Execute these modules before the main one (`--preload`). */
  preload(...paths: PathLike[]): this {
    this.#runtime.preload(paths.map(String));
    return this;
  }

  /** Execute these CommonJS modules before the main one (`--require`). */
  require(...paths: PathLike[]): this {
    this.#runtime.require(paths.map(String));
    return this;
  }

  /** Disable the V8 code cache (`--no-code-cache`). */
  noCodeCache(): this {
    this.#runtime.noCodeCache();
    return this;
  }

  /** Permit npm lifecycle scripts, optionally only for these packages (`--allow-scripts`). */
  allowScripts(...packages: string[]): this {
    this.#runtime.allowScripts(packages);
    return this;
  }

  /** Type-check before running (`--check`), optionally including remote code. */
  typeCheck(scope?: "all" | "remote"): this {
    this.#types.check(scope);
    return this;
  }

  /** Skip type-checking (`--no-check`), optionally only for remote code. */
  noCheck(scope?: "all" | "remote"): this {
    this.#types.noCheck(scope);
    return this;
  }

  /** Activate the inspector (`--inspect`). */
  inspect(hostPort?: string): this {
    this.#debug.inspect(hostPort);
    return this;
  }

  /** Activate the inspector and break at the start (`--inspect-brk`). */
  inspectBrk(hostPort?: string): this {
    this.#debug.inspectBrk(hostPort);
    return this;
  }

  /** Activate the inspector and wait for a debugger (`--inspect-wait`). */
  inspectWait(hostPort?: string): this {
    this.#debug.inspectWait(hostPort);
    return this;
  }

  /** Restart when a watched file changes (`--watch`). */
  watch(): this {
    this.#watch.watch();
    return this;
  }

  /**
   * Watch with hot-module replacement (`--watch-hmr`), which only `deno run`
   * offers. It implies watching, so it replaces `--watch` rather than joining
   * it.
   */
  watchHmr(): this {
    this.#watch.watchHmr();
    return this;
  }

  /** Exclude paths from the watcher (`--watch-exclude`). */
  watchExclude(...paths: PathLike[]): this {
    this.#watch.exclude(paths.map(String));
    return this;
  }

  /** Keep previous output when re-running under `--watch` (`--no-clear-screen`). */
  noClearScreen(): this {
    this.#watch.noClearScreen();
    return this;
  }

  /** Assemble the `deno run` argv. */
  protected override buildArgs(): string[] {
    if (this.#script === undefined) {
      throw new Error("DenoTasks.run: .script() is required.");
    }
    if (this.#config.contradictory) {
      throw new Error(
        "DenoTasks.run: .config() names a configuration file and " +
          ".noConfig() discards it — pick one.",
      );
    }
    if (this.#types.contradictory) {
      throw new Error(
        "DenoTasks.run: .typeCheck() and .noCheck() are opposite answers to " +
          "whether the script is type-checked — pick one.",
      );
    }
    const argv = [
      "run",
      ...this.permissionArgs,
      ...this.frozenArgs,
      ...this.#config.render(),
      ...this.#deps.render(),
      ...this.#runtime.render(),
      ...this.#types.render(),
      ...this.#debug.render(),
      ...this.#watch.render(),
    ];
    argv.push(this.#script, ...this.#scriptArgs);
    return argv;
  }
}

/** Settings for `deno task`. */
export class DenoTaskSettings extends DenoSettings {
  #name?: string;
  #taskArgs: string[] = [];
  #recursive = false;
  #filter?: string;
  #noPrefix = false;
  #evalShell = false;
  #taskCwd?: string;
  #config = new ConfigFlags();
  #deps = new DependencyFlags();
  #runtime = new RuntimeFlags();

  /** The task name from deno.json (required). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** Arguments forwarded to the task. */
  taskArgs(...args: Array<string | number>): this {
    this.#taskArgs.push(...args.map(String));
    return this;
  }

  /** Run the task in every workspace member (`--recursive`). */
  recursive(): this {
    this.#recursive = true;
    return this;
  }

  /**
   * Select the workspace members to run the task in (`--filter`). It selects
   * on its own — {@link recursive} is not a prerequisite.
   */
  filter(pattern: string): this {
    this.#filter = pattern;
    return this;
  }

  /**
   * Drop the per-member name prefix from output (`--no-prefix`), which a
   * recursive run adds. Useful when the output is being parsed rather than
   * read.
   */
  noPrefix(): this {
    this.#noPrefix = true;
    return this;
  }

  /**
   * Treat the task name as a shell command to evaluate (`--eval`) instead of
   * a task defined in the configuration file.
   */
  evalShell(): this {
    this.#evalShell = true;
    return this;
  }

  /**
   * Run the task from this directory (`--cwd`).
   *
   * Distinct from the inherited `cwd`, which sets the directory the `deno`
   * process itself is spawned in: this one moves only the task, leaving
   * configuration discovery anchored where deno started.
   */
  taskCwd(path: PathLike): this {
    this.#taskCwd = String(path);
    return this;
  }

  /** Use an explicit config file (`--config`). */
  config(path: PathLike): this {
    this.#config.config(path);
    return this;
  }

  /**
   * Error out if the lockfile is out of date (`--frozen`). See
   * {@link DenoPermissionSettings.frozen} for why the name mirrors the real
   * Deno flag rather than `PnpmSettings.frozenLockfile()`'s naming.
   */
  frozen(): this {
    this.#deps.frozen();
    return this;
  }

  /** Use an explicit lockfile (`--lock`). */
  lock(path: PathLike): this {
    this.#deps.lock(path);
    return this;
  }

  /** Ignore the lockfile entirely (`--no-lock`). */
  noLock(): this {
    this.#deps.noLock();
    return this;
  }

  /** Set the node-modules management mode (`--node-modules-dir`). */
  nodeModulesDir(mode: NodeModulesMode): this {
    this.#deps.nodeModulesDir(mode);
    return this;
  }

  /** Set the npm linker mode (`--node-modules-linker`). */
  nodeModulesLinker(mode: NodeModulesLinker): this {
    this.#deps.nodeModulesLinker(mode);
    return this;
  }

  /** Load environment variables from a file (`--env-file`). */
  envFile(path: PathLike): this {
    this.#runtime.envFile(path);
    return this;
  }

  /** Assemble the `deno task` argv. */
  protected override buildArgs(): string[] {
    if (this.#name === undefined) {
      throw new Error("DenoTasks.task: .name() is required.");
    }
    const argv = [
      "task",
      ...this.#config.render(),
      ...this.#deps.render(),
      ...this.#runtime.render(),
    ];
    if (this.#taskCwd !== undefined) argv.push("--cwd", this.#taskCwd);
    if (this.#recursive) argv.push("--recursive");
    if (this.#filter !== undefined) argv.push("--filter", this.#filter);
    if (this.#noPrefix) argv.push("--no-prefix");
    if (this.#evalShell) argv.push("--eval");
    argv.push(this.#name, ...this.#taskArgs);
    return argv;
  }
}

/**
 * Settings for `deno serve`.
 *
 * A server runs until it is stopped, so a build target that awaits this task
 * blocks forever. Give it a bound with `.killAfter(ms)` — for a smoke test
 * that the server starts — or run it from a target the build is not waiting
 * on.
 */
export class DenoServeSettings extends DenoPermissionSettings {
  #script?: string;
  #scriptArgs: string[] = [];
  #port?: number;
  #host?: string;
  #parallel = false;
  #open = false;
  #watch = false;
  #config?: string;

  /** The module exporting the server's default handler (required). */
  script(path: PathLike): this {
    this.#script = String(path);
    return this;
  }

  /** Arguments passed to the server module (after the module path). */
  scriptArgs(...args: Array<string | number>): this {
    this.#scriptArgs.push(...args.map(String));
    return this;
  }

  /** The TCP port to serve on (`--port`); `0` picks a free one. */
  port(value: number): this {
    this.#port = value;
    return this;
  }

  /** The TCP address to serve on (`--host`), defaulting to all interfaces. */
  host(value: string): this {
    this.#host = value;
    return this;
  }

  /**
   * Run one server worker per available CPU (`--parallel`), or as many as
   * `DENO_JOBS` allows.
   */
  parallel(): this {
    this.#parallel = true;
    return this;
  }

  /** Open a browser on the served address (`--open`). */
  open(): this {
    this.#open = true;
    return this;
  }

  /** Restart the server when a watched file changes (`--watch`). */
  watch(): this {
    this.#watch = true;
    return this;
  }

  /** Use an explicit config file (`--config`). */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /** Assemble the `deno serve` argv. */
  protected override buildArgs(): string[] {
    if (this.#script === undefined) {
      throw new Error("DenoTasks.serve: .script() is required.");
    }
    const argv = ["serve", ...this.permissionArgs, ...this.frozenArgs];
    if (this.#config !== undefined) argv.push("--config", this.#config);
    if (this.#port !== undefined) argv.push("--port", String(this.#port));
    if (this.#host !== undefined) argv.push("--host", this.#host);
    if (this.#parallel) argv.push("--parallel");
    if (this.#open) argv.push("--open");
    if (this.#watch) argv.push("--watch");
    argv.push(this.#script, ...this.#scriptArgs);
    return argv;
  }
}

/** A content type `deno eval` and `deno bench` accept for `--ext`. */
export type DenoSourceExt =
  | "ts"
  | "tsx"
  | "js"
  | "jsx"
  | "mts"
  | "mjs"
  | "cts"
  | "cjs";

/**
 * Settings for `deno eval`.
 *
 * The code is passed as a single argv entry by the shell layer, never
 * interpolated into a command string, so a value built from build parameters
 * cannot break out of it.
 */
export class DenoEvalSettings extends DenoPermissionSettings {
  #code?: string;
  #print = false;
  #ext?: DenoSourceExt;
  #config?: string;

  /** The source to evaluate (required). */
  code(source: string): this {
    this.#code = source;
    return this;
  }

  /** Print the expression's result to stdout (`--print`). */
  print(): this {
    this.#print = true;
    return this;
  }

  /** Treat the source as this content type (`--ext`), rather than TypeScript. */
  ext(value: DenoSourceExt): this {
    this.#ext = value;
    return this;
  }

  /** Use an explicit config file (`--config`). */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /** Assemble the `deno eval` argv. */
  protected override buildArgs(): string[] {
    if (this.#code === undefined) {
      throw new Error("DenoTasks.eval: .code() is required.");
    }
    const argv = ["eval", ...this.permissionArgs, ...this.frozenArgs];
    if (this.#config !== undefined) argv.push("--config", this.#config);
    if (this.#ext !== undefined) argv.push("--ext", this.#ext);
    if (this.#print) argv.push("--print");
    argv.push(this.#code);
    return argv;
  }
}

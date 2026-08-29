// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for the `deno` subcommands that manage a project's dependencies and
 * the artifacts built from them: `cache`, `install` and `publish`.
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
} from "./flags.ts";

/** Settings for `deno cache`. */
export class DenoCacheSettings extends DenoSettings {
  #reload = false;
  #frozen = false;
  #paths: string[] = [];

  /** Reload remote modules instead of using the cache (`--reload`). */
  reload(): this {
    this.#reload = true;
    return this;
  }

  /**
   * Error out if the lockfile is out of date (`--frozen`). See
   * {@link DenoPermissionSettings.frozen} for why the name mirrors the real
   * Deno flag rather than `PnpmSettings.frozenLockfile()`'s naming.
   */
  frozen(): this {
    this.#frozen = true;
    return this;
  }

  /** The entry points to cache (at least one is required). */
  paths(...paths: PathLike[]): this {
    this.#paths.push(...paths.map(String));
    return this;
  }

  /** Assemble the `deno cache` argv. */
  protected override buildArgs(): string[] {
    if (this.#paths.length === 0) {
      throw new Error(
        "DenoTasks.cache: at least one path is required (use .paths()).",
      );
    }
    const argv = ["cache"];
    if (this.#frozen) argv.push("--frozen");
    if (this.#reload) argv.push("--reload");
    argv.push(...this.#paths);
    return argv;
  }
}

/** Settings for `deno install`. */
export class DenoInstallSettings extends DenoPermissionSettings {
  #global = false;
  #force = false;
  #root?: string;
  #name?: string;
  #module?: string;
  #moduleArgs: string[] = [];
  #dev = false;
  #prod = false;
  #saveExact = false;
  #lockfileOnly = false;
  #skipTypes = false;
  #packageJson = false;
  #compile = false;
  #registry?: "--jsr" | "--npm";
  #entrypoint?: string;
  #os?: string;
  #arch?: string;
  #config = new ConfigFlags();
  #deps = new DependencyFlags();
  #runtime = new RuntimeFlags();
  #types = new TypeCheckFlags();
  #debug = new DebugFlags();

  /** Install a global executable (`--global`/`-g`) instead of project deps. */
  global(): this {
    this.#global = true;
    return this;
  }

  /** Overwrite an existing installation (`--force`/`-f`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Install root; the binary lands in `<root>/bin` (`--root`). */
  root(path: PathLike): this {
    this.#root = String(path);
    return this;
  }

  /** Name the installed executable (`--name`/`-n`). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** The module to install, e.g. `npm:cspell@9` (required for a global install). */
  module(spec: string): this {
    this.#module = spec;
    return this;
  }

  /**
   * Arguments baked into the generated launcher, emitted after the `--`
   * separator deno requires for them.
   */
  moduleArgs(...args: Array<string | number>): this {
    this.#moduleArgs.push(...args.map(String));
    return this;
  }

  /** Install dev dependencies only alongside the rest (`--dev`). */
  dev(): this {
    this.#dev = true;
    return this;
  }

  /** Install production dependencies only (`--prod`). */
  prod(): this {
    this.#prod = true;
    return this;
  }

  /** Record exact versions, without a caret range (`--save-exact`). */
  saveExact(): this {
    this.#saveExact = true;
    return this;
  }

  /** Update the lockfile without installing (`--lockfile-only`). */
  lockfileOnly(): this {
    this.#lockfileOnly = true;
    return this;
  }

  /** Exclude `@types/*` packages (`--skip-types`). */
  skipTypes(): this {
    this.#skipTypes = true;
    return this;
  }

  /** Read unprefixed package names as JSR packages (`--jsr`). */
  jsr(): this {
    return this.#setRegistry("--jsr");
  }

  /** Read unprefixed package names as npm packages (`--npm`). */
  npm(): this {
    return this.#setRegistry("--npm");
  }

  /** Install into `package.json` rather than `deno.json` (`--package-json`). */
  packageJson(): this {
    this.#packageJson = true;
    return this;
  }

  /** Name the entrypoint the launcher runs (`--entrypoint`). */
  entrypoint(path: PathLike): this {
    this.#entrypoint = String(path);
    return this;
  }

  /**
   * Build a compiled launcher (`--compile`) rather than a script shim, and
   * cross-compile it with {@link os} and {@link arch}.
   */
  compile(): this {
    this.#compile = true;
    return this;
  }

  /** Target operating system for a compiled launcher (`--os`). */
  os(value: string): this {
    this.#os = value;
    return this;
  }

  /** Target architecture for a compiled launcher (`--arch`). */
  arch(value: string): this {
    this.#arch = value;
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

  /** Resolve only from the cache (`--cached-only`). */
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

  /** Reload the module cache (`--reload`), optionally only these specifiers. */
  reload(...specifiers: string[]): this {
    this.#deps.reload(specifiers);
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

  /** Permit npm lifecycle scripts, optionally only for these packages (`--allow-scripts`). */
  allowScripts(...packages: string[]): this {
    this.#runtime.allowScripts(packages);
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

  /** Type-check before installing (`--check`). */
  typeCheck(scope?: "all" | "remote"): this {
    this.#types.check(scope);
    return this;
  }

  /** Skip type-checking (`--no-check`). */
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

  #setRegistry(registry: "--jsr" | "--npm"): this {
    if (this.#registry !== undefined && this.#registry !== registry) {
      throw new Error(
        "DenoTasks.install: --jsr and --npm decide how an unprefixed name is " +
          "resolved and deno accepts only one — pick a registry, or prefix " +
          "the specifier instead.",
      );
    }
    this.#registry = registry;
    return this;
  }

  /** Assemble the `deno install` argv. */
  protected override buildArgs(): string[] {
    if (this.#config.contradictory) {
      throw new Error(
        "DenoTasks.install: .config() names a configuration file and " +
          ".noConfig() discards it — pick one.",
      );
    }
    if (this.#types.contradictory) {
      throw new Error(
        "DenoTasks.install: .typeCheck() and .noCheck() are opposite answers " +
          "to whether the module is type-checked — pick one.",
      );
    }
    if (this.#dev && this.#prod) {
      throw new Error(
        "DenoTasks.install: .dev() and .prod() are opposite answers to which " +
          "dependencies are installed — pick one.",
      );
    }
    if (
      (this.#os !== undefined || this.#arch !== undefined) && !this.#compile
    ) {
      throw new Error(
        "DenoTasks.install: deno accepts .os()/.arch() without .compile() " +
          "and silently ignores them — there is no binary to target without " +
          "a compiled launcher. Add .compile(), or drop them.",
      );
    }
    // deno declares these conflicts itself; the lists below are its own,
    // read off `deno install`'s clap errors rather than inferred. --global
    // installs an executable and --entrypoint names the module one wraps, so
    // neither combines with the flags that shape a project's dependency set.
    const dependencyFlags: Array<[string, boolean]> = [
      [".dev()", this.#dev],
      [".jsr()/.npm()", this.#registry !== undefined],
      [".packageJson()", this.#packageJson],
      [".saveExact()", this.#saveExact],
    ];
    if (this.#global) {
      // --global rejects two more than --entrypoint does: deno accepts
      // --entrypoint beside --prod and --lockfile-only.
      refuseWith("global", ".global()", [
        ...dependencyFlags,
        [".prod()", this.#prod],
        [".lockfileOnly()", this.#lockfileOnly],
        [".entrypoint()", this.#entrypoint !== undefined],
        [".os()/.arch()", this.#os !== undefined || this.#arch !== undefined],
      ]);
    }
    if (this.#entrypoint !== undefined) {
      refuseWith("entrypoint", ".entrypoint()", dependencyFlags);
    }
    const argv = [
      "install",
      ...this.permissionArgs,
      ...this.frozenArgs,
      ...this.#config.render(),
      ...this.#deps.render(),
      ...this.#runtime.render(),
      ...this.#types.render(),
      ...this.#debug.render(),
    ];
    if (this.#global) argv.push("--global");
    if (this.#force) argv.push("--force");
    if (this.#dev) argv.push("--dev");
    if (this.#prod) argv.push("--prod");
    if (this.#saveExact) argv.push("--save-exact");
    if (this.#lockfileOnly) argv.push("--lockfile-only");
    if (this.#skipTypes) argv.push("--skip-types");
    if (this.#registry !== undefined) argv.push(this.#registry);
    if (this.#packageJson) argv.push("--package-json");
    if (this.#compile) argv.push("--compile");
    if (this.#os !== undefined) argv.push("--os", this.#os);
    if (this.#arch !== undefined) argv.push("--arch", this.#arch);
    if (this.#entrypoint !== undefined) {
      argv.push("--entrypoint", this.#entrypoint);
    }
    if (this.#root !== undefined) argv.push("--root", this.#root);
    if (this.#name !== undefined) argv.push("--name", this.#name);
    if (this.#module !== undefined) argv.push(this.#module);
    // deno install takes launcher arguments only after a `--` separator:
    // its usage is `[cmd]... [-- [SCRIPT_ARG]...]`, and a flag-shaped
    // argument without it is rejected as an unexpected argument.
    if (this.#moduleArgs.length > 0) argv.push("--", ...this.#moduleArgs);
    return argv;
  }
}

/**
 * Refuse a `deno install` flag combination deno itself rejects, naming every
 * offending setter so the message says which call to drop.
 */
function refuseWith(
  flag: string,
  setter: string,
  conflicts: Array<[string, boolean]>,
): void {
  const used = conflicts.filter(([, set]) => set).map(([name]) => name);
  if (used.length === 0) return;
  throw new Error(
    `DenoTasks.install: deno refuses --${flag} with ${used.join(", ")} — ` +
      `${setter} builds or names an executable, while those shape a ` +
      `project's dependency set. Drop ${setter}, or drop them.`,
  );
}

/** Settings for `deno publish`. */
export class DenoPublishSettings extends DenoSettings {
  #allowDirty = false;
  #allowSlowTypes = false;
  #noCheck = false;
  #dryRun = false;
  #config?: string;
  #token?: string;
  #setVersion?: string;
  #noProvenance = false;
  #noConfig = false;
  #envFile?: string;
  #types = new TypeCheckFlags();

  /** Publish even with an uncommitted working tree (`--allow-dirty`). */
  allowDirty(): this {
    this.#allowDirty = true;
    return this;
  }

  /** Permit slow types in the published package (`--allow-slow-types`). */
  allowSlowTypes(): this {
    this.#allowSlowTypes = true;
    return this;
  }

  /** Skip type-checking before publishing (`--no-check`). */
  noCheck(): this {
    this.#noCheck = true;
    return this;
  }

  /** Validate without publishing (`--dry-run`). */
  dryRun(): this {
    this.#dryRun = true;
    return this;
  }

  /** Use an explicit config file (`--config`). */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /** Authenticate with a token instead of interactive/OIDC auth (`--token`). */
  token(value: string): this {
    this.#token = value;
    return this;
  }

  /**
   * Publish under an overridden version (`--set-version`) instead of the one
   * in the manifest — how a release job publishes a version it computed
   * without first committing it.
   */
  setVersion(version: string): this {
    this.#setVersion = version;
    return this;
  }

  /**
   * Disable provenance attestation (`--no-provenance`).
   *
   * Provenance is what lets a consumer verify the published artifact came from
   * this repository's CI, so turning it off is a deliberate weakening rather
   * than a default worth reaching for.
   */
  noProvenance(): this {
    this.#noProvenance = true;
    return this;
  }

  /** Type-check before publishing (`--check`), optionally including remote code. */
  typeCheck(scope?: "all" | "remote"): this {
    this.#types.check(scope);
    return this;
  }

  /** Discover no configuration file at all (`--no-config`). */
  noConfig(): this {
    this.#noConfig = true;
    return this;
  }

  /** Load environment variables from a file (`--env-file`). */
  envFile(path: PathLike): this {
    this.#envFile = String(path);
    return this;
  }

  /** Assemble the `deno publish` argv. */
  protected override buildArgs(): string[] {
    if (this.#config !== undefined && this.#noConfig) {
      throw new Error(
        "DenoTasks.publish: .config() names a configuration file and " +
          ".noConfig() discards it — pick one.",
      );
    }
    if (this.#noCheck && this.#types.render().length > 0) {
      throw new Error(
        "DenoTasks.publish: .typeCheck() and .noCheck() are opposite answers " +
          "to whether the package is type-checked — pick one.",
      );
    }
    const argv = ["publish"];
    if (this.#config !== undefined) argv.push("--config", this.#config);
    if (this.#noConfig) argv.push("--no-config");
    if (this.#envFile !== undefined) argv.push(`--env-file=${this.#envFile}`);
    argv.push(...this.#types.render());
    if (this.#allowDirty) argv.push("--allow-dirty");
    if (this.#allowSlowTypes) argv.push("--allow-slow-types");
    if (this.#noCheck) argv.push("--no-check");
    if (this.#dryRun) argv.push("--dry-run");
    if (this.#noProvenance) argv.push("--no-provenance");
    if (this.#setVersion !== undefined) {
      argv.push("--set-version", this.#setVersion);
    }
    if (this.#token !== undefined) argv.push("--token", this.#token);
    return argv;
  }
}

/**
 * Base for the `deno` subcommands that read and write the lockfile.
 *
 * The lockfile flags are a section the CLI repeats across every one of them,
 * so they live here once rather than being restated per subcommand.
 */
export abstract class DenoLockSettings extends DenoSettings {
  #frozen = false;
  #noLock = false;
  #lockFile?: string;

  /**
   * Error out if the lockfile is out of date (`--frozen`). See
   * {@link DenoPermissionSettings.frozen} for why the name mirrors the real
   * Deno flag.
   */
  frozen(): this {
    this.#frozen = true;
    return this;
  }

  /** Ignore the lockfile entirely (`--no-lock`), neither reading nor writing it. */
  noLock(): this {
    this.#noLock = true;
    return this;
  }

  /** Use an explicit lockfile (`--lock`) instead of the discovered `deno.lock`. */
  lock(path: PathLike): this {
    this.#lockFile = String(path);
    return this;
  }

  /** The shared lockfile flags; read by subclasses assembling their argv. */
  protected get lockArgs(): string[] {
    const argv: string[] = [];
    if (this.#frozen) argv.push("--frozen");
    if (this.#noLock) argv.push("--no-lock");
    if (this.#lockFile !== undefined) argv.push("--lock", this.#lockFile);
    return argv;
  }
}

/** Settings for `deno add`. */
export class DenoAddSettings extends DenoLockSettings {
  #packages: string[] = [];
  #dev = false;
  #registry?: "--jsr" | "--npm";
  #saveExact = false;
  #lockfileOnly = false;
  #packageJson = false;

  /** The packages to add, e.g. `jsr:@std/assert` or `npm:express` (required). */
  packages(...specs: string[]): this {
    this.#packages.push(...specs);
    return this;
  }

  /**
   * Add as a dev dependency (`--dev`). Deno only distinguishes the two in a
   * `package.json`; against a `deno.json` the flag has nothing to record.
   */
  dev(): this {
    this.#dev = true;
    return this;
  }

  /** Read unprefixed package names as JSR packages (`--jsr`). */
  jsr(): this {
    return this.#setRegistry("--jsr");
  }

  /** Read unprefixed package names as npm packages (`--npm`), deno's default. */
  npm(): this {
    return this.#setRegistry("--npm");
  }

  /** Record the exact version, without a caret range (`--save-exact`). */
  saveExact(): this {
    this.#saveExact = true;
    return this;
  }

  /** Update the lockfile without installing (`--lockfile-only`). */
  lockfileOnly(): this {
    this.#lockfileOnly = true;
    return this;
  }

  /** Record the dependency in `package.json` rather than `deno.json` (`--package-json`). */
  packageJson(): this {
    this.#packageJson = true;
    return this;
  }

  #setRegistry(registry: "--jsr" | "--npm"): this {
    if (this.#registry !== undefined && this.#registry !== registry) {
      throw new Error(
        "DenoTasks.add: --jsr and --npm decide how an unprefixed name is " +
          "resolved and deno accepts only one — pick a registry, or prefix " +
          "the specifiers instead.",
      );
    }
    this.#registry = registry;
    return this;
  }

  /** Assemble the `deno add` argv. */
  protected override buildArgs(): string[] {
    if (this.#packages.length === 0) {
      throw new Error(
        "DenoTasks.add: at least one package is required (use .packages()).",
      );
    }
    const argv = ["add", ...this.lockArgs];
    if (this.#dev) argv.push("--dev");
    if (this.#registry !== undefined) argv.push(this.#registry);
    if (this.#saveExact) argv.push("--save-exact");
    if (this.#lockfileOnly) argv.push("--lockfile-only");
    if (this.#packageJson) argv.push("--package-json");
    argv.push(...this.#packages);
    return argv;
  }
}

/** Settings for `deno remove`. */
export class DenoRemoveSettings extends DenoLockSettings {
  #packages: string[] = [];
  #lockfileOnly = false;
  #packageJson = false;

  /** The packages to remove, by the name they are recorded under (required). */
  packages(...names: string[]): this {
    this.#packages.push(...names);
    return this;
  }

  /** Update the lockfile without touching `node_modules` (`--lockfile-only`). */
  lockfileOnly(): this {
    this.#lockfileOnly = true;
    return this;
  }

  /** Remove from `package.json` rather than `deno.json` (`--package-json`). */
  packageJson(): this {
    this.#packageJson = true;
    return this;
  }

  /** Assemble the `deno remove` argv. */
  protected override buildArgs(): string[] {
    if (this.#packages.length === 0) {
      throw new Error(
        "DenoTasks.remove: at least one package is required (use .packages()).",
      );
    }
    const argv = ["remove", ...this.lockArgs];
    if (this.#lockfileOnly) argv.push("--lockfile-only");
    if (this.#packageJson) argv.push("--package-json");
    argv.push(...this.#packages);
    return argv;
  }
}

/** Settings for `deno uninstall`. */
export class DenoUninstallSettings extends DenoLockSettings {
  #packages: string[] = [];
  #global = false;
  #root?: string;
  #lockfileOnly = false;
  #packageJson = false;

  /** The dependency names, or the global executable name, to remove (required). */
  packages(...names: string[]): this {
    this.#packages.push(...names);
    return this;
  }

  /** Remove a globally installed executable (`--global`) rather than a project dependency. */
  global(): this {
    this.#global = true;
    return this;
  }

  /** The installation root the executable lives under (`--root`). */
  root(path: PathLike): this {
    this.#root = String(path);
    return this;
  }

  /** Update the lockfile without touching `node_modules` (`--lockfile-only`). */
  lockfileOnly(): this {
    this.#lockfileOnly = true;
    return this;
  }

  /** Remove from `package.json` rather than `deno.json` (`--package-json`). */
  packageJson(): this {
    this.#packageJson = true;
    return this;
  }

  /** Assemble the `deno uninstall` argv. */
  protected override buildArgs(): string[] {
    if (this.#packages.length === 0) {
      throw new Error(
        "DenoTasks.uninstall: at least one name is required (use .packages()).",
      );
    }
    if (this.#root !== undefined && !this.#global) {
      throw new Error(
        "DenoTasks.uninstall: .root() names the directory a global " +
          "executable was installed into, so deno requires --global with it " +
          "— add .global(), or drop .root().",
      );
    }
    const argv = ["uninstall", ...this.lockArgs];
    if (this.#global) argv.push("--global");
    if (this.#root !== undefined) argv.push("--root", this.#root);
    if (this.#lockfileOnly) argv.push("--lockfile-only");
    if (this.#packageJson) argv.push("--package-json");
    argv.push(...this.#packages);
    return argv;
  }
}

/** Settings for `deno outdated`. */
export class DenoOutdatedSettings extends DenoLockSettings {
  #filters: string[] = [];
  #range?: "--compatible" | "--latest";
  #recursive = false;
  #update = false;
  #lockfileOnly = false;

  /**
   * Restrict the report to dependencies matching these filters, which may
   * include `*` wildcards. Filters match the alias a dependency is declared
   * under, not the package it resolves to.
   */
  filters(...patterns: string[]): this {
    this.#filters.push(...patterns);
    return this;
  }

  /** Only consider versions satisfying the declared semver range (`--compatible`). */
  compatible(): this {
    return this.#setRange("--compatible");
  }

  /** Consider the latest version regardless of the declared range (`--latest`). */
  latest(): this {
    return this.#setRange("--latest");
  }

  /** Include every workspace member (`--recursive`). */
  recursive(): this {
    this.#recursive = true;
    return this;
  }

  /**
   * Write the newer versions back into the manifest (`--update`) instead of
   * only reporting them. Without it `deno outdated` reports and changes
   * nothing, which is what a freshness gate wants.
   */
  update(): this {
    this.#update = true;
    return this;
  }

  /** Update the lockfile without installing (`--lockfile-only`). */
  lockfileOnly(): this {
    this.#lockfileOnly = true;
    return this;
  }

  #setRange(range: "--compatible" | "--latest"): this {
    if (this.#range !== undefined && this.#range !== range) {
      throw new Error(
        "DenoTasks.outdated: --compatible and --latest are opposite answers " +
          "to which versions count and deno accepts only one — pick one.",
      );
    }
    this.#range = range;
    return this;
  }

  /** Assemble the `deno outdated` argv. */
  protected override buildArgs(): string[] {
    const argv = ["outdated", ...this.lockArgs];
    if (this.#range !== undefined) argv.push(this.#range);
    if (this.#recursive) argv.push("--recursive");
    if (this.#update) argv.push("--update");
    if (this.#lockfileOnly) argv.push("--lockfile-only");
    argv.push(...this.#filters);
    return argv;
  }
}

/** Settings for `deno why`. */
export class DenoWhySettings extends DenoLockSettings {
  #packageName?: string;

  /**
   * The package to explain, optionally with a version (`express@4.18.2`)
   * (required).
   */
  packageName(value: string): this {
    this.#packageName = value;
    return this;
  }

  /** Assemble the `deno why` argv. */
  protected override buildArgs(): string[] {
    if (this.#packageName === undefined) {
      throw new Error("DenoTasks.why: .packageName() is required.");
    }
    return ["why", ...this.lockArgs, this.#packageName];
  }
}

/** Settings for `deno ci`. */
export class DenoCiSettings extends DenoSettings {
  #prod = false;
  #skipTypes = false;
  #envFile?: string;

  /** Install production dependencies only, excluding dev ones (`--prod`). */
  prod(): this {
    this.#prod = true;
    return this;
  }

  /**
   * Exclude `@types/*` packages (`--skip-types`). Deno selects them by name,
   * so a package that ships runtime code under a `@types/` name is skipped
   * too.
   */
  skipTypes(): this {
    this.#skipTypes = true;
    return this;
  }

  /** Load environment variables from a file (`--env-file`). */
  envFile(path: PathLike): this {
    this.#envFile = String(path);
    return this;
  }

  /** Assemble the `deno ci` argv. */
  protected override buildArgs(): string[] {
    const argv = ["ci"];
    if (this.#prod) argv.push("--prod");
    if (this.#skipTypes) argv.push("--skip-types");
    if (this.#envFile !== undefined) argv.push(`--env-file=${this.#envFile}`);
    return argv;
  }
}

/** Settings for `deno approve-scripts`. */
export class DenoApproveScriptsSettings extends DenoSettings {
  #packages: string[] = [];
  #lockfileOnly = false;

  /** The npm specifiers whose lifecycle scripts to approve (required). */
  packages(...specs: string[]): this {
    this.#packages.push(...specs);
    return this;
  }

  /** Record the approval in the lockfile without installing (`--lockfile-only`). */
  lockfileOnly(): this {
    this.#lockfileOnly = true;
    return this;
  }

  /** Assemble the `deno approve-scripts` argv. */
  protected override buildArgs(): string[] {
    if (this.#packages.length === 0) {
      throw new Error(
        "DenoTasks.approveScripts: at least one package is required (use " +
          ".packages()). With none, deno prompts for a selection, and a " +
          "build target has nobody to answer the prompt.",
      );
    }
    const argv = ["approve-scripts"];
    if (this.#lockfileOnly) argv.push("--lockfile-only");
    argv.push(...this.#packages);
    return argv;
  }
}

/** A version increment `deno bump-version` understands. */
export type DenoVersionIncrement =
  | "major"
  | "minor"
  | "patch"
  | "premajor"
  | "preminor"
  | "prepatch"
  | "prerelease";

/**
 * Settings for `deno bump-version`.
 *
 * The subcommand is experimental — deno itself prints a notice saying so on
 * every run — so treat its output as subject to change between releases.
 */
export class DenoBumpVersionSettings extends DenoSettings {
  #increment?: DenoVersionIncrement;
  #dryRun = false;
  #workspace?: "--workspace" | "--no-workspace";
  #config?: string;
  #importMap?: string;
  #base?: string;
  #start?: string;
  #releaseNotes?: string;

  /**
   * The increment to apply. Omit it to derive the increment from the
   * conventional commits since {@link start}.
   */
  increment(kind: DenoVersionIncrement): this {
    this.#increment = kind;
    return this;
  }

  /** Print the planned changes without writing any files (`--dry-run`). */
  dryRun(): this {
    this.#dryRun = true;
    return this;
  }

  /** Bump every package in the workspace (`--workspace`). */
  workspace(): this {
    return this.#setWorkspace("--workspace");
  }

  /** Bump only the manifest in the current directory (`--no-workspace`). */
  noWorkspace(): this {
    return this.#setWorkspace("--no-workspace");
  }

  /** The manifest to bump (`--config`). */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /** The import map whose `jsr:` constraints to rewrite (`--import-map`). */
  importMap(path: PathLike): this {
    this.#importMap = String(path);
    return this;
  }

  /** Git ref to compare against in conventional-commits mode (`--base`). */
  base(ref: string): this {
    this.#base = ref;
    return this;
  }

  /** Git ref to start from in conventional-commits mode (`--start`). */
  start(ref: string): this {
    this.#start = ref;
    return this;
  }

  /** Release notes file to prepend to in conventional-commits mode (`--release-notes`). */
  releaseNotes(path: PathLike): this {
    this.#releaseNotes = String(path);
    return this;
  }

  #setWorkspace(mode: "--workspace" | "--no-workspace"): this {
    if (this.#workspace !== undefined && this.#workspace !== mode) {
      throw new Error(
        "DenoTasks.bumpVersion: --workspace and --no-workspace are opposite " +
          "answers to what gets bumped and deno accepts only one — pick one.",
      );
    }
    this.#workspace = mode;
    return this;
  }

  /** Assemble the `deno bump-version` argv. */
  protected override buildArgs(): string[] {
    const argv = ["bump-version"];
    if (this.#dryRun) argv.push("--dry-run");
    if (this.#workspace !== undefined) argv.push(this.#workspace);
    if (this.#config !== undefined) argv.push("--config", this.#config);
    if (this.#importMap !== undefined) {
      argv.push("--import-map", this.#importMap);
    }
    if (this.#base !== undefined) argv.push("--base", this.#base);
    if (this.#start !== undefined) argv.push("--start", this.#start);
    if (this.#releaseNotes !== undefined) {
      argv.push("--release-notes", this.#releaseNotes);
    }
    if (this.#increment !== undefined) argv.push(this.#increment);
    return argv;
  }
}

/** Settings for `deno pack`. */
export class DenoPackSettings extends DenoSettings {
  #files: string[] = [];
  #allowDirty = false;
  #allowSlowTypes = false;
  #dryRun = false;
  #noSourceMaps = false;
  #ignore: string[] = [];
  #output?: string;
  #setVersion?: string;
  #config?: string;

  /** File patterns to include in the tarball; defaults to the package's own. */
  files(...patterns: string[]): this {
    this.#files.push(...patterns);
    return this;
  }

  /** Pack even with an uncommitted working tree (`--allow-dirty`). */
  allowDirty(): this {
    this.#allowDirty = true;
    return this;
  }

  /**
   * Skip fast-check type extraction (`--allow-slow-types`). The tarball then
   * ships without `.d.ts` files, so consumers get no types from it.
   */
  allowSlowTypes(): this {
    this.#allowSlowTypes = true;
    return this;
  }

  /** Report what would be packed without writing the tarball (`--dry-run`). */
  dryRun(): this {
    this.#dryRun = true;
    return this;
  }

  /** Omit source maps from the tarball (`--no-source-maps`). */
  noSourceMaps(): this {
    this.#noSourceMaps = true;
    return this;
  }

  /** Exclude files matching these patterns (`--ignore`). */
  ignore(...patterns: string[]): this {
    this.#ignore.push(...patterns);
    return this;
  }

  /** Write the tarball here (`--output`) instead of `<name>-<version>.tgz`. */
  output(path: PathLike): this {
    this.#output = String(path);
    return this;
  }

  /** Override the version recorded in the tarball (`--set-version`). */
  setVersion(version: string): this {
    this.#setVersion = version;
    return this;
  }

  /** Use an explicit config file (`--config`). */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /** Assemble the `deno pack` argv. */
  protected override buildArgs(): string[] {
    const argv = ["pack"];
    if (this.#allowDirty) argv.push("--allow-dirty");
    if (this.#allowSlowTypes) argv.push("--allow-slow-types");
    if (this.#dryRun) argv.push("--dry-run");
    if (this.#noSourceMaps) argv.push("--no-source-maps");
    if (this.#output !== undefined) argv.push("--output", this.#output);
    if (this.#setVersion !== undefined) {
      argv.push("--set-version", this.#setVersion);
    }
    if (this.#config !== undefined) argv.push("--config", this.#config);
    if (this.#ignore.length > 0) {
      argv.push(`--ignore=${this.#ignore.join(",")}`);
    }
    argv.push(...this.#files);
    return argv;
  }
}

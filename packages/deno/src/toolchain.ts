// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for the `deno` subcommands that act on the toolchain and its caches
 * rather than on a project's dependencies: `compile`, `clean`, `info`, `init`
 * and `upgrade`.
 */

import type { PathLike } from "@zuke/core/tooling";
import { DenoPermissionSettings, DenoSettings } from "./settings.ts";

/**
 * A target triple `deno compile` can cross-compile to, as listed by
 * `deno compile --help`. Typed as a union so a typo in a release matrix is a
 * compile-time error rather than a build that fails minutes into CI.
 */
export type DenoCompileTarget =
  | "x86_64-unknown-linux-gnu"
  | "aarch64-unknown-linux-gnu"
  | "x86_64-pc-windows-msvc"
  | "x86_64-apple-darwin"
  | "aarch64-apple-darwin";

/** Settings for `deno compile`. */
export class DenoCompileSettings extends DenoPermissionSettings {
  #script?: string;
  #scriptArgs: string[] = [];
  #output?: string;
  #target?: DenoCompileTarget;
  #include: string[] = [];
  #exclude: string[] = [];
  #excludeUnusedNpm = false;
  #icon?: string;
  #noTerminal = false;
  #selfExtracting = false;
  #bundle = false;
  #minify = false;
  #config?: string;
  #noCheck = false;

  /** The entrypoint to compile (required). */
  script(path: PathLike): this {
    this.#script = String(path);
    return this;
  }

  /** Arguments baked into the executable, passed after the entrypoint. */
  scriptArgs(...args: Array<string | number>): this {
    this.#scriptArgs.push(...args.map(String));
    return this;
  }

  /** Output file (`--output`); defaults to a name inferred from the entrypoint. */
  output(path: PathLike): this {
    this.#output = String(path);
    return this;
  }

  /** Cross-compile for another platform (`--target`). */
  target(triple: DenoCompileTarget): this {
    this.#target = triple;
    return this;
  }

  /**
   * Embed an extra module, file or directory (`--include`, repeatable).
   *
   * Needed for anything the module graph cannot see statically — a
   * dynamically imported module, a worker entrypoint, or a data file the
   * program reads at runtime.
   */
  include(...paths: PathLike[]): this {
    this.#include.push(...paths.map(String));
    return this;
  }

  /** Exclude a file or directory from what {@link include} embedded (`--exclude`). */
  exclude(...paths: PathLike[]): this {
    this.#exclude.push(...paths.map(String));
    return this;
  }

  /**
   * Embed only the npm packages the module graph actually reaches
   * (`--exclude-unused-npm`), instead of the whole lockfile snapshot.
   *
   * Packages reached only through a dynamic import are not statically
   * traceable, so pass those to {@link include} explicitly.
   */
  excludeUnusedNpm(): this {
    this.#excludeUnusedNpm = true;
    return this;
  }

  /** Set the executable's Windows icon from a `.ico` file (`--icon`). */
  icon(path: PathLike): this {
    this.#icon = String(path);
    return this;
  }

  /** Hide the console window on Windows (`--no-terminal`). */
  noTerminal(): this {
    this.#noTerminal = true;
    return this;
  }

  /**
   * Produce a self-extracting binary (`--self-extracting`) that unpacks its
   * embedded file system to disk on first run and executes from there.
   */
  selfExtracting(): this {
    this.#selfExtracting = true;
    return this;
  }

  /**
   * Bundle the entrypoint before embedding it (`--bundle`), rather than
   * shipping the whole `node_modules` tree. Experimental: it produces a
   * smaller, faster-starting binary but drops dynamic `require`/`import`
   * patterns that cannot be traced statically.
   */
  bundle(): this {
    this.#bundle = true;
    return this;
  }

  /**
   * Minify the bundled output (`--minify`). Requires {@link bundle} — the CLI
   * rejects `--minify` on its own, and so does this wrapper, so the mistake
   * surfaces while the argv is being built rather than after the compile
   * starts.
   */
  minify(): this {
    this.#minify = true;
    return this;
  }

  /** Use an explicit config file (`--config`). */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /** Skip type-checking before compiling (`--no-check`). */
  noCheck(): this {
    this.#noCheck = true;
    return this;
  }

  /** Assemble the `deno compile` argv. */
  protected override buildArgs(): string[] {
    if (this.#script === undefined) {
      throw new Error("DenoTasks.compile: .script() is required.");
    }
    if (this.#minify && !this.#bundle) {
      throw new Error(
        "DenoTasks.compile: .minify() only applies to a bundled binary — " +
          "add .bundle(), or drop .minify().",
      );
    }
    if (this.#icon !== undefined && targetsElsewhere(this.#target)) {
      throw new Error(
        "DenoTasks.compile: .icon() sets the executable's Windows icon, and " +
          `.target("${this.#target}") builds for another platform, where it ` +
          "is ignored — drop one of them.",
      );
    }
    const argv = ["compile", ...this.permissionArgs, ...this.frozenArgs];
    if (this.#config !== undefined) argv.push("--config", this.#config);
    if (this.#noCheck) argv.push("--no-check");
    if (this.#output !== undefined) argv.push("--output", this.#output);
    if (this.#target !== undefined) argv.push("--target", this.#target);
    if (this.#bundle) argv.push("--bundle");
    if (this.#minify) argv.push("--minify");
    if (this.#selfExtracting) argv.push("--self-extracting");
    if (this.#excludeUnusedNpm) argv.push("--exclude-unused-npm");
    if (this.#noTerminal) argv.push("--no-terminal");
    if (this.#icon !== undefined) argv.push("--icon", this.#icon);
    for (const path of this.#include) argv.push("--include", path);
    for (const path of this.#exclude) argv.push("--exclude", path);
    argv.push(this.#script, ...this.#scriptArgs);
    return argv;
  }
}

/**
 * Whether a compile targets a platform the Windows-only flags do not apply to.
 *
 * An unset target means "build for this host", which may itself be Windows, so
 * only an explicit non-Windows target is grounds for refusing `--icon`.
 */
function targetsElsewhere(target: DenoCompileTarget | undefined): boolean {
  return target !== undefined && !target.includes("windows");
}

/** Settings for `deno clean`. */
export class DenoCleanSettings extends DenoSettings {
  #dryRun = false;
  #except: string[] = [];

  /** Report what would be removed without removing it (`--dry-run`). */
  dryRun(): this {
    this.#dryRun = true;
    return this;
  }

  /**
   * Keep the cache entries these files need (`--except`), clearing everything
   * else. Use it to drop stale dependencies without forcing the next build to
   * re-download the ones it still uses.
   */
  except(...paths: PathLike[]): this {
    this.#except.push(...paths.map(String));
    return this;
  }

  /** Assemble the `deno clean` argv. */
  protected override buildArgs(): string[] {
    const argv = ["clean"];
    if (this.#dryRun) argv.push("--dry-run");
    if (this.#except.length > 0) argv.push("--except", ...this.#except);
    return argv;
  }
}

/** Settings for `deno info`. */
export class DenoInfoSettings extends DenoSettings {
  #path?: string;
  #json = false;
  #config?: string;
  #importMap?: string;
  #reload = false;
  #frozen = false;
  #noLock = false;
  #noNpm = false;
  #noRemote = false;

  /**
   * The module to report on — a path, or any specifier `deno info` accepts,
   * including a `file://` URL. Prefer the URL form when the specifier is
   * built rather than typed: it is the same string on every OS, where a
   * constructed path is not.
   *
   * Omit it to report on the caches themselves — `deno info` with no module
   * prints the cache directories rather than a module graph, which is why
   * {@link DenoTasks.cacheInfo} and {@link DenoTasks.moduleGraph} are separate
   * readers.
   */
  path(file: PathLike): this {
    this.#path = String(file);
    return this;
  }

  /** Emit the report as JSON (`--json`). */
  json(): this {
    this.#json = true;
    return this;
  }

  /** Use an explicit config file (`--config`). */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /** Load an import map from a file or URL (`--import-map`). */
  importMap(path: PathLike): this {
    this.#importMap = String(path);
    return this;
  }

  /** Reload the module cache before reporting (`--reload`). */
  reload(): this {
    this.#reload = true;
    return this;
  }

  /**
   * Error out if the lockfile is out of date (`--frozen`). See
   * {@link DenoPermissionSettings.frozen} for why the name mirrors the real
   * Deno flag.
   */
  frozen(): this {
    this.#frozen = true;
    return this;
  }

  /** Ignore the lockfile entirely (`--no-lock`). */
  noLock(): this {
    this.#noLock = true;
    return this;
  }

  /** Do not resolve npm modules (`--no-npm`). */
  noNpm(): this {
    this.#noNpm = true;
    return this;
  }

  /** Do not resolve remote modules (`--no-remote`). */
  noRemote(): this {
    this.#noRemote = true;
    return this;
  }

  /**
   * The module {@link path} was set to, if any; read by
   * {@link DenoTasks.moduleGraph} and {@link DenoTasks.cacheInfo} to tell the
   * two reports apart. Reading the flag off the built argv would not do it:
   * `--import-map` and `--config` also leave a non-flag token at the end.
   */
  get modulePath(): string | undefined {
    return this.#path;
  }

  /** Assemble the `deno info` argv. */
  protected override buildArgs(): string[] {
    const argv = ["info"];
    if (this.#json) argv.push("--json");
    if (this.#config !== undefined) argv.push("--config", this.#config);
    if (this.#importMap !== undefined) {
      argv.push("--import-map", this.#importMap);
    }
    if (this.#reload) argv.push("--reload");
    if (this.#frozen) argv.push("--frozen");
    if (this.#noLock) argv.push("--no-lock");
    if (this.#noNpm) argv.push("--no-npm");
    if (this.#noRemote) argv.push("--no-remote");
    if (this.#path !== undefined) argv.push(this.#path);
    return argv;
  }
}

/** Settings for `deno init`. */
export class DenoInitSettings extends DenoSettings {
  #directory?: string;
  #shape?: "--lib" | "--serve" | "--empty";
  #registry?: "--jsr" | "--npm";
  #yes = false;

  /** The directory to create, or the package to scaffold from. */
  directory(name: string): this {
    this.#directory = name;
    return this;
  }

  /** Scaffold an example library project (`--lib`). */
  lib(): this {
    return this.#setShape("--lib");
  }

  /** Scaffold an example `deno serve` project (`--serve`). */
  serve(): this {
    return this.#setShape("--serve");
  }

  /** Scaffold a minimal project — just `main.ts` and `deno.json` (`--empty`). */
  empty(): this {
    return this.#setShape("--empty");
  }

  /** Scaffold from a JSR package (`--jsr`). */
  jsr(): this {
    return this.#setRegistry("--jsr");
  }

  /** Scaffold from an npm `create-*` package (`--npm`). */
  npm(): this {
    return this.#setRegistry("--npm");
  }

  /**
   * Answer the scaffolding prompts affirmatively and grant full permissions
   * (`--yes`). Required for an unattended run: without it `deno init` can stop
   * on a prompt no build target is there to answer.
   */
  yes(): this {
    this.#yes = true;
    return this;
  }

  #setShape(shape: "--lib" | "--serve" | "--empty"): this {
    if (this.#shape !== undefined && this.#shape !== shape) {
      throw new Error(
        `DenoTasks.init: ${this.#shape} and ${shape} are different project ` +
          "shapes and deno accepts only one — pick the one you want.",
      );
    }
    this.#shape = shape;
    return this;
  }

  #setRegistry(registry: "--jsr" | "--npm"): this {
    if (this.#registry !== undefined && this.#registry !== registry) {
      throw new Error(
        "DenoTasks.init: --jsr and --npm name different registries to " +
          "scaffold from and deno accepts only one — pick the one you want.",
      );
    }
    this.#registry = registry;
    return this;
  }

  /** Assemble the `deno init` argv. */
  protected override buildArgs(): string[] {
    const argv = ["init"];
    if (this.#shape !== undefined) argv.push(this.#shape);
    if (this.#registry !== undefined) argv.push(this.#registry);
    if (this.#yes) argv.push("--yes");
    if (this.#directory !== undefined) argv.push(this.#directory);
    return argv;
  }
}

/** Settings for `deno upgrade`. */
export class DenoUpgradeSettings extends DenoSettings {
  #version?: string;
  #dryRun = false;
  #force = false;
  #noDelta = false;
  #output?: string;
  #checksum?: string;

  /**
   * The version, channel (`alpha`, `beta`, `rc`, `canary`) or commit hash to
   * install. Omit it to move to the latest stable release.
   */
  version(value: string): this {
    this.#version = value;
    return this;
  }

  /** Run every check without replacing the executable (`--dry-run`). */
  dryRun(): this {
    this.#dryRun = true;
    return this;
  }

  /** Replace the executable even when it is already up to date (`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Download the full archive instead of a delta update (`--no-delta`). */
  noDelta(): this {
    this.#noDelta = true;
    return this;
  }

  /**
   * Write the upgraded executable somewhere else (`--output`), leaving the
   * running one in place. This is what makes `upgrade` usable from a build:
   * a target can fetch a second Deno without replacing the one executing it.
   */
  output(path: PathLike): this {
    this.#output = String(path);
    return this;
  }

  /** Verify the downloaded archive against a SHA-256 checksum (`--checksum`). */
  checksum(sha256: string): this {
    this.#checksum = sha256;
    return this;
  }

  /** Assemble the `deno upgrade` argv. */
  protected override buildArgs(): string[] {
    const argv = ["upgrade"];
    if (this.#dryRun) argv.push("--dry-run");
    if (this.#force) argv.push("--force");
    if (this.#noDelta) argv.push("--no-delta");
    if (this.#output !== undefined) argv.push("--output", this.#output);
    if (this.#checksum !== undefined) argv.push("--checksum", this.#checksum);
    if (this.#version !== undefined) argv.push(this.#version);
    return argv;
  }
}

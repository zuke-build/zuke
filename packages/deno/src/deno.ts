/**
 * `DenoTasks` — typed task functions for the `deno` CLI, in the
 * settings-lambda style: configure a fluent settings object in a lambda, and
 * the task function builds the command line and executes it.
 *
 * ```ts
 * import { DenoTasks } from "jsr:@zuke/deno";
 * await DenoTasks.test((s) => s.allowAll().coverage("cov_profile"));
 * ```
 *
 * The binary defaults to the currently running `deno` executable
 * (`Deno.execPath()`), so builds never depend on PATH lookup; override with
 * `.toolPath(...)`.
 */

import {
  type Configure,
  type PathLike,
  runSettings,
  ToolSettings,
} from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";
import { type CoverageThresholds, enforceCoverage } from "./coverage.ts";

/** A Deno permission domain, as used by `--allow-*` flags. */
export type DenoPermission =
  | "read"
  | "write"
  | "net"
  | "env"
  | "run"
  | "sys"
  | "ffi"
  | "import";

/** Base for all `deno` subcommand settings: binary is the running deno. */
abstract class DenoSettings extends ToolSettings {
  protected override defaultTool(): string {
    return Deno.execPath();
  }
}

/** Base for subcommands that accept `--allow-*` permission flags. */
abstract class DenoPermissionSettings extends DenoSettings {
  #permissions: string[] = [];

  /** Grant all permissions (`--allow-all`). */
  allowAll(): this {
    this.#permissions.push("--allow-all");
    return this;
  }

  /** Grant one permission, optionally scoped to values (`--allow-read=a,b`). */
  allow(permission: DenoPermission, ...values: string[]): this {
    this.#permissions.push(
      values.length > 0
        ? `--allow-${permission}=${values.join(",")}`
        : `--allow-${permission}`,
    );
    return this;
  }

  /** The accumulated permission flags, in declaration order. */
  protected get permissionArgs(): string[] {
    return [...this.#permissions];
  }
}

/** Settings for `deno run`. */
export class DenoRunSettings extends DenoPermissionSettings {
  #script?: string;
  #scriptArgs: string[] = [];
  #config?: string;
  #reload = false;

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
    this.#config = String(path);
    return this;
  }

  /** Reload the module cache (`--reload`). */
  reload(): this {
    this.#reload = true;
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#script === undefined) {
      throw new Error("DenoTasks.run: .script() is required.");
    }
    const argv = ["run", ...this.permissionArgs];
    if (this.#config !== undefined) argv.push("--config", this.#config);
    if (this.#reload) argv.push("--reload");
    argv.push(this.#script, ...this.#scriptArgs);
    return argv;
  }
}

/** Settings for `deno test`. */
export class DenoTestSettings extends DenoPermissionSettings {
  #paths: string[] = [];
  #coverage?: string;
  #filter?: string;
  #parallel = false;
  #failFast = false;

  /** Restrict the run to specific test files or directories. */
  paths(...paths: PathLike[]): this {
    this.#paths.push(...paths.map(String));
    return this;
  }

  /** Collect coverage into the given profile directory (`--coverage=`). */
  coverage(dir: PathLike): this {
    this.#coverage = String(dir);
    return this;
  }

  /** Only run tests whose name matches (`--filter`). */
  filter(pattern: string): this {
    this.#filter = pattern;
    return this;
  }

  /** Run test files in parallel (`--parallel`). */
  parallel(): this {
    this.#parallel = true;
    return this;
  }

  /** Stop on the first failure (`--fail-fast`). */
  failFast(): this {
    this.#failFast = true;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["test", ...this.permissionArgs];
    if (this.#coverage !== undefined) {
      argv.push(`--coverage=${this.#coverage}`);
    }
    if (this.#filter !== undefined) argv.push("--filter", this.#filter);
    if (this.#parallel) argv.push("--parallel");
    if (this.#failFast) argv.push("--fail-fast");
    argv.push(...this.#paths);
    return argv;
  }
}

/** Settings for `deno check`. */
export class DenoCheckSettings extends DenoSettings {
  #paths: string[] = [];

  /** The files to type-check (at least one is required). */
  paths(...paths: PathLike[]): this {
    this.#paths.push(...paths.map(String));
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#paths.length === 0) {
      throw new Error(
        "DenoTasks.check: at least one path is required (use .paths()).",
      );
    }
    return ["check", ...this.#paths];
  }
}

/** Settings for `deno fmt`. */
export class DenoFmtSettings extends DenoSettings {
  #check = false;
  #paths: string[] = [];

  /** Verify formatting without writing changes (`--check`). */
  check(): this {
    this.#check = true;
    return this;
  }

  /** Restrict formatting to specific files or directories. */
  paths(...paths: PathLike[]): this {
    this.#paths.push(...paths.map(String));
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["fmt"];
    if (this.#check) argv.push("--check");
    argv.push(...this.#paths);
    return argv;
  }
}

/** Settings for `deno lint`. */
export class DenoLintSettings extends DenoSettings {
  #fix = false;
  #paths: string[] = [];

  /** Apply automatic fixes (`--fix`). */
  fix(): this {
    this.#fix = true;
    return this;
  }

  /** Restrict linting to specific files or directories. */
  paths(...paths: PathLike[]): this {
    this.#paths.push(...paths.map(String));
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["lint"];
    if (this.#fix) argv.push("--fix");
    argv.push(...this.#paths);
    return argv;
  }
}

/** Settings for `deno doc`. */
export class DenoDocSettings extends DenoSettings {
  #paths: string[] = [];
  #flags: string[] = [];

  /** The source files (entry points) to document. */
  paths(...paths: PathLike[]): this {
    this.#paths.push(...paths.map(String));
    return this;
  }

  /** Output the documentation as JSON (`--json`). */
  json(): this {
    this.#flags.push("--json");
    return this;
  }

  /** Generate static HTML documentation (`--html`). */
  html(): this {
    this.#flags.push("--html");
    return this;
  }

  /** Title for the generated HTML documentation (`--name`). */
  name(title: string): this {
    this.#flags.push("--name", title);
    return this;
  }

  /** Output directory for HTML documentation (`--output`). */
  output(dir: PathLike): this {
    this.#flags.push("--output", String(dir));
    return this;
  }

  /** Include private and internal symbols (`--private`). */
  private(): this {
    this.#flags.push("--private");
    return this;
  }

  /** Document only the symbol at this dot-separated path (`--filter`). */
  filter(symbol: string): this {
    this.#flags.push("--filter", symbol);
    return this;
  }

  /** Report documentation diagnostics rather than rendering docs (`--lint`). */
  lint(): this {
    this.#flags.push("--lint");
    return this;
  }

  protected override buildArgs(): string[] {
    return ["doc", ...this.#flags, ...this.#paths];
  }
}

/** Settings for `deno cache`. */
export class DenoCacheSettings extends DenoSettings {
  #reload = false;
  #paths: string[] = [];

  /** Reload remote modules instead of using the cache (`--reload`). */
  reload(): this {
    this.#reload = true;
    return this;
  }

  /** The entry points to cache (at least one is required). */
  paths(...paths: PathLike[]): this {
    this.#paths.push(...paths.map(String));
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#paths.length === 0) {
      throw new Error(
        "DenoTasks.cache: at least one path is required (use .paths()).",
      );
    }
    const argv = ["cache"];
    if (this.#reload) argv.push("--reload");
    argv.push(...this.#paths);
    return argv;
  }
}

/** Settings for `deno coverage`. */
export class DenoCoverageSettings extends DenoSettings {
  #dir?: string;
  #lcov = false;
  #output?: string;
  #exclude?: string;
  #linesThreshold?: number;
  #branchesThreshold?: number;
  #perFileThreshold?: number;

  /** The coverage profile directory to report on. */
  dir(path: PathLike): this {
    this.#dir = String(path);
    return this;
  }

  /** Emit lcov instead of the table report (`--lcov`). */
  lcov(): this {
    this.#lcov = true;
    return this;
  }

  /** Write the report to a file (`--output=`). */
  output(path: PathLike): this {
    this.#output = String(path);
    return this;
  }

  /** Exclude files matching the pattern (`--exclude=`). */
  exclude(pattern: string): this {
    this.#exclude = pattern;
    return this;
  }

  /**
   * Fail the gate if line coverage is below `percent`. `deno coverage` has no
   * fail-under flag, so {@link DenoTasks.coverage} enforces this after parsing
   * the lcov report (and forces `--lcov` so a report exists to parse).
   */
  linesThreshold(percent: number): this {
    this.#linesThreshold = percent;
    return this;
  }

  /** Fail the gate if branch coverage is below `percent` (see {@link linesThreshold}). */
  branchesThreshold(percent: number): this {
    this.#branchesThreshold = percent;
    return this;
  }

  /** Fail the gate if either line or branch coverage is below `percent`. */
  threshold(percent: number): this {
    this.#linesThreshold = percent;
    this.#branchesThreshold = percent;
    return this;
  }

  /**
   * Fail the gate if any single instrumented file's line coverage is below
   * `percent` — a per-file floor, so an under-tested file can't hide inside a
   * healthy aggregate (see {@link CoverageThresholds.perFile}, which notes the
   * `deno coverage` limit for files no test loads).
   */
  perFileThreshold(percent: number): this {
    this.#perFileThreshold = percent;
    return this;
  }

  /** The configured thresholds; read by {@link DenoTasks.coverage}. */
  get thresholds(): CoverageThresholds {
    return {
      lines: this.#linesThreshold,
      branches: this.#branchesThreshold,
      perFile: this.#perFileThreshold,
    };
  }

  /** The `--output` file path, if {@link output} was set; read by the task. */
  get outputPath(): string | undefined {
    return this.#output;
  }

  #hasThreshold(): boolean {
    return this.#linesThreshold !== undefined ||
      this.#branchesThreshold !== undefined ||
      this.#perFileThreshold !== undefined;
  }

  protected override buildArgs(): string[] {
    const argv = ["coverage"];
    if (this.#dir !== undefined) argv.push(this.#dir);
    // A threshold needs an lcov report to parse, so force it on.
    if (this.#lcov || this.#hasThreshold()) argv.push("--lcov");
    if (this.#output !== undefined) argv.push(`--output=${this.#output}`);
    if (this.#exclude !== undefined) argv.push(`--exclude=${this.#exclude}`);
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

  /** Arguments baked into the generated launcher (after the module). */
  moduleArgs(...args: Array<string | number>): this {
    this.#moduleArgs.push(...args.map(String));
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["install", ...this.permissionArgs];
    if (this.#global) argv.push("--global");
    if (this.#force) argv.push("--force");
    if (this.#root !== undefined) argv.push("--root", this.#root);
    if (this.#name !== undefined) argv.push("--name", this.#name);
    if (this.#module !== undefined) argv.push(this.#module);
    argv.push(...this.#moduleArgs);
    return argv;
  }
}

/** Settings for `deno publish`. */
export class DenoPublishSettings extends DenoSettings {
  #allowDirty = false;
  #allowSlowTypes = false;
  #noCheck = false;
  #dryRun = false;
  #config?: string;
  #token?: string;

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

  protected override buildArgs(): string[] {
    const argv = ["publish"];
    if (this.#allowDirty) argv.push("--allow-dirty");
    if (this.#allowSlowTypes) argv.push("--allow-slow-types");
    if (this.#noCheck) argv.push("--no-check");
    if (this.#dryRun) argv.push("--dry-run");
    if (this.#config !== undefined) argv.push("--config", this.#config);
    if (this.#token !== undefined) argv.push("--token", this.#token);
    return argv;
  }
}

/** Settings for `deno task`. */
export class DenoTaskSettings extends DenoSettings {
  #name?: string;
  #taskArgs: string[] = [];

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

  protected override buildArgs(): string[] {
    if (this.#name === undefined) {
      throw new Error("DenoTasks.task: .name() is required.");
    }
    return ["task", this.#name, ...this.#taskArgs];
  }
}

/** The shape of {@link DenoTasks}. */
export interface DenoTasksApi {
  /** Run a script: `deno run`. */
  run(configure?: Configure<DenoRunSettings>): Promise<CommandOutput>;
  /** Run tests: `deno test`. */
  test(configure?: Configure<DenoTestSettings>): Promise<CommandOutput>;
  /** Type-check files: `deno check`. */
  check(configure?: Configure<DenoCheckSettings>): Promise<CommandOutput>;
  /** Format files: `deno fmt`. */
  fmt(configure?: Configure<DenoFmtSettings>): Promise<CommandOutput>;
  /** Lint files: `deno lint`. */
  lint(configure?: Configure<DenoLintSettings>): Promise<CommandOutput>;
  /** Generate documentation: `deno doc`. */
  doc(configure?: Configure<DenoDocSettings>): Promise<CommandOutput>;
  /** Warm the module cache: `deno cache`. */
  cache(configure?: Configure<DenoCacheSettings>): Promise<CommandOutput>;
  /** Report coverage: `deno coverage`. */
  coverage(configure?: Configure<DenoCoverageSettings>): Promise<CommandOutput>;
  /** Install a script or executable: `deno install`. */
  install(configure?: Configure<DenoInstallSettings>): Promise<CommandOutput>;
  /** Publish a package to JSR: `deno publish`. */
  publish(configure?: Configure<DenoPublishSettings>): Promise<CommandOutput>;
  /** Run a deno.json task: `deno task`. */
  task(configure?: Configure<DenoTaskSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `deno` CLI. */
export const DenoTasks: DenoTasksApi = {
  /** Run a script: `deno run`. */
  run(configure?: Configure<DenoRunSettings>): Promise<CommandOutput> {
    return runSettings(new DenoRunSettings(), configure);
  },
  /** Run tests: `deno test`. */
  test(configure?: Configure<DenoTestSettings>): Promise<CommandOutput> {
    return runSettings(new DenoTestSettings(), configure);
  },
  /** Type-check files: `deno check`. */
  check(configure?: Configure<DenoCheckSettings>): Promise<CommandOutput> {
    return runSettings(new DenoCheckSettings(), configure);
  },
  /** Format files: `deno fmt`. */
  fmt(configure?: Configure<DenoFmtSettings>): Promise<CommandOutput> {
    return runSettings(new DenoFmtSettings(), configure);
  },
  /** Lint files: `deno lint`. */
  lint(configure?: Configure<DenoLintSettings>): Promise<CommandOutput> {
    return runSettings(new DenoLintSettings(), configure);
  },
  /** Generate documentation: `deno doc`. */
  doc(configure?: Configure<DenoDocSettings>): Promise<CommandOutput> {
    return runSettings(new DenoDocSettings(), configure);
  },
  /** Warm the module cache: `deno cache`. */
  cache(configure?: Configure<DenoCacheSettings>): Promise<CommandOutput> {
    return runSettings(new DenoCacheSettings(), configure);
  },
  /**
   * Report coverage: `deno coverage`. When a threshold is configured
   * (`linesThreshold`/`branchesThreshold`/`threshold`), parse the lcov report
   * and enforce it — raising a {@link CoverageThresholdError} on a shortfall
   * unless `noThrow()` was set.
   */
  async coverage(
    configure?: Configure<DenoCoverageSettings>,
  ): Promise<CommandOutput> {
    const settings = new DenoCoverageSettings();
    const s = configure ? configure(settings) : settings;
    const { lines, branches, perFile } = s.thresholds;
    if (
      lines === undefined && branches === undefined && perFile === undefined
    ) {
      return await s.run(); // plain `deno coverage`, no gate
    }
    // Read the lcov from the output file when one is set, else capture it from
    // stdout (quietly, so the raw report doesn't flood the terminal).
    const output = s.outputPath;
    if (output === undefined) s.quiet();
    const result = await s.run();
    const lcov = output === undefined
      ? result.stdout
      : await Deno.readTextFile(output);
    enforceCoverage(lcov, { lines, branches, perFile }, s.throwsOnError);
    return result;
  },
  /** Install a script or executable: `deno install`. */
  install(configure?: Configure<DenoInstallSettings>): Promise<CommandOutput> {
    return runSettings(new DenoInstallSettings(), configure);
  },
  /** Publish a package to JSR: `deno publish`. */
  publish(configure?: Configure<DenoPublishSettings>): Promise<CommandOutput> {
    return runSettings(new DenoPublishSettings(), configure);
  },
  /** Run a deno.json task: `deno task`. */
  task(configure?: Configure<DenoTaskSettings>): Promise<CommandOutput> {
    return runSettings(new DenoTaskSettings(), configure);
  },
};

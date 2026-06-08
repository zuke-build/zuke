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

import { type Configure, runSettings, ToolSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

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
  script(path: string): this {
    this.#script = path;
    return this;
  }

  /** Arguments passed to the script (after the script path). */
  scriptArgs(...args: Array<string | number>): this {
    this.#scriptArgs.push(...args.map(String));
    return this;
  }

  /** Use an explicit config file (`--config`). */
  config(path: string): this {
    this.#config = path;
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
  paths(...paths: string[]): this {
    this.#paths.push(...paths);
    return this;
  }

  /** Collect coverage into the given profile directory (`--coverage=`). */
  coverage(dir: string): this {
    this.#coverage = dir;
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
  paths(...paths: string[]): this {
    this.#paths.push(...paths);
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
  paths(...paths: string[]): this {
    this.#paths.push(...paths);
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
  paths(...paths: string[]): this {
    this.#paths.push(...paths);
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["lint"];
    if (this.#fix) argv.push("--fix");
    argv.push(...this.#paths);
    return argv;
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
  paths(...paths: string[]): this {
    this.#paths.push(...paths);
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

  /** The coverage profile directory to report on. */
  dir(path: string): this {
    this.#dir = path;
    return this;
  }

  /** Emit lcov instead of the table report (`--lcov`). */
  lcov(): this {
    this.#lcov = true;
    return this;
  }

  /** Write the report to a file (`--output=`). */
  output(path: string): this {
    this.#output = path;
    return this;
  }

  /** Exclude files matching the pattern (`--exclude=`). */
  exclude(pattern: string): this {
    this.#exclude = pattern;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["coverage"];
    if (this.#dir !== undefined) argv.push(this.#dir);
    if (this.#lcov) argv.push("--lcov");
    if (this.#output !== undefined) argv.push(`--output=${this.#output}`);
    if (this.#exclude !== undefined) argv.push(`--exclude=${this.#exclude}`);
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
  /** Warm the module cache: `deno cache`. */
  cache(configure?: Configure<DenoCacheSettings>): Promise<CommandOutput>;
  /** Report coverage: `deno coverage`. */
  coverage(configure?: Configure<DenoCoverageSettings>): Promise<CommandOutput>;
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
  /** Warm the module cache: `deno cache`. */
  cache(configure?: Configure<DenoCacheSettings>): Promise<CommandOutput> {
    return runSettings(new DenoCacheSettings(), configure);
  },
  /** Report coverage: `deno coverage`. */
  coverage(
    configure?: Configure<DenoCoverageSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DenoCoverageSettings(), configure);
  },
  /** Run a deno.json task: `deno task`. */
  task(configure?: Configure<DenoTaskSettings>): Promise<CommandOutput> {
    return runSettings(new DenoTaskSettings(), configure);
  },
};

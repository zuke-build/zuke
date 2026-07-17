/**
 * Foundations for typed tool wrappers (settings-lambda task functions).
 *
 * A tool package (e.g. `@zuke/deno`, `@zuke/npm`) defines one settings class
 * per subcommand by extending {@link ToolSettings}: `buildArgs()` assembles
 * the subcommand argv purely (no I/O), while the base contributes the common
 * fluent chainers (`env`, `cwd`, `noThrow`, `quiet`, `toolPath`, `args`) and
 * the execution logic, which reuses {@link Command} so argv stays an array
 * end-to-end — there is no shell string and no injection surface.
 *
 * ```ts
 * class MyToolSettings extends ToolSettings {
 *   protected defaultTool() { return "mytool"; }
 *   protected buildArgs() { return ["build", "--fast"]; }
 * }
 * await runSettings(new MyToolSettings(), (s) => s.cwd("app"));
 * ```
 *
 * @module
 */

import { Command, type CommandOutput } from "./shell.ts";
import type { AbsolutePath, PathLike } from "./path.ts";

export type { PathLike };

/** Raised when a tool's binary cannot be found on the system. */
export class ToolNotFoundError extends Error {
  /** The error name. */
  override name = "ToolNotFoundError";
  /** Build the error naming the tool binary that could not be found. */
  constructor(
    /** The binary that could not be resolved. */
    readonly tool: string,
  ) {
    super(
      `Tool not found: "${tool}". Install it and make sure it is on PATH, ` +
        `or point at the binary explicitly with .toolPath(...).`,
    );
  }
}

/**
 * On Windows, wrap an argv in a `cmd /c` invocation so `.cmd`/`.bat` shims
 * (such as npm's) become spawnable; returns `null` on other platforms.
 */
export function shimFallbackArgv(
  argv: ReadonlyArray<string>,
  os: typeof Deno.build.os,
): string[] | null {
  return os === "windows" ? ["cmd", "/c", ...argv] : null;
}

/** A lambda that configures a settings instance and returns it. */
export type Configure<S> = (settings: S) => S;

/**
 * Abstract fluent base for tool settings. Subclasses provide the binary
 * ({@link defaultTool}) and the pure subcommand argv ({@link buildArgs});
 * the base provides the shared chainers and {@link run}.
 */
export abstract class ToolSettings {
  /**
   * The platform identifier used by {@link run} to decide whether to retry a
   * missing binary through the `cmd /c` shim path (Windows only).
   *
   * In production this is always `Deno.build.os`. It is exposed as a public
   * field — rather than read from `Deno.build.os` inline — so that tests can
   * pin a specific platform without spawning a subprocess or touching the
   * environment:
   *
   * ```ts
   * const s = new MyToolSettings();
   * s.os_ = "windows"; // exercise the cmd /c retry branch on any host
   * ```
   *
   * The trailing underscore signals an internal test seam: do not rely on this
   * field in production code.
   */
  os_: typeof Deno.build.os = Deno.build.os;

  #env: Record<string, string> = {};
  #cwd?: string;
  #throwOnError = true;
  #quiet = false;
  #timeoutMs?: number;
  #toolPath?: string;
  #extraArgs: string[] = [];

  /** The binary to spawn when {@link toolPath} is not set. */
  protected abstract defaultTool(): string;

  /** The subcommand argv. Must be pure — no I/O, no environment reads. */
  protected abstract buildArgs(): string[];

  /** Merge additional environment variables for the process. */
  env(record: Record<string, string>): this {
    this.#env = { ...this.#env, ...record };
    return this;
  }

  /** Set the working directory for the process. */
  cwd(path: PathLike): this {
    this.#cwd = String(path);
    return this;
  }

  /** Do not throw on a non-zero exit; inspect `code` on the output instead. */
  noThrow(): this {
    this.#throwOnError = false;
    return this;
  }

  /**
   * Whether a failure should throw — the default, or `false` after
   * {@link noThrow}. A task that layers its own validation on top of the
   * subprocess (e.g. a coverage-threshold gate) reads this to decide whether a
   * gate failure throws or is merely reported.
   */
  get throwsOnError(): boolean {
    return this.#throwOnError;
  }

  /** Suppress live stdout/stderr streaming to the terminal. */
  quiet(): this {
    this.#quiet = true;
    return this;
  }

  /**
   * Kill the tool if it runs longer than `ms` milliseconds, raising a
   * `CommandTimeoutError`. Fires even under {@link noThrow}.
   */
  killAfter(ms: number): this {
    this.#timeoutMs = ms;
    return this;
  }

  /** Override the binary to run (e.g. an absolute path to the tool). */
  toolPath(path: PathLike): this {
    this.#toolPath = String(path);
    return this;
  }

  /** Escape hatch: append raw arguments after all typed options. */
  args(...extra: Array<string | number | AbsolutePath>): this {
    this.#extraArgs.push(...extra.map(String));
    return this;
  }

  /** The full argv (binary first). Pure — useful for tests and diagnostics. */
  argv(): string[] {
    return [
      this.#toolPath ?? this.defaultTool(),
      ...this.buildArgs(),
      ...this.#extraArgs,
    ];
  }

  #command(argv: string[]): Command {
    const command = new Command(argv).env(this.#env);
    if (this.#cwd !== undefined) command.cwd(this.#cwd);
    if (!this.#throwOnError) command.noThrow();
    if (this.#quiet) command.quiet();
    if (this.#timeoutMs !== undefined) command.killAfter(this.#timeoutMs);
    return command;
  }

  /**
   * Run the configured tool. If the binary is missing and the platform is
   * Windows, retry once through `cmd /c` (covers `.cmd`/`.bat` shims);
   * otherwise raise a {@link ToolNotFoundError} naming the tool.
   */
  async run(): Promise<CommandOutput> {
    const argv = this.argv();
    const tool = argv[0] ?? "";
    try {
      return await this.#command(argv);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      const fallback = shimFallbackArgv(argv, this.os_);
      if (fallback === null) throw new ToolNotFoundError(tool);
      try {
        return await this.#command(fallback);
      } catch (retryError) {
        if (retryError instanceof Deno.errors.NotFound) {
          throw new ToolNotFoundError(tool);
        }
        throw retryError;
      }
    }
  }
}

/**
 * Construct-configure-run: the shared shape of every task function.
 *
 * ```ts
 * export const MyTasks = {
 *   build: (configure?: Configure<MyBuildSettings>) =>
 *     runSettings(new MyBuildSettings(), configure),
 * };
 * ```
 */
export function runSettings<S extends ToolSettings>(
  settings: S,
  configure?: Configure<S>,
): Promise<CommandOutput> {
  return (configure ? configure(settings) : settings).run();
}

/** Prefix a flag name with `--` unless it already starts with a dash. */
function dashed(name: string): string {
  return name.startsWith("-") ? name : `--${name}`;
}

/**
 * Fluent settings for a {@link defineTool} tool: build the argv with
 * {@link DynamicToolSettings.arg}/{@link DynamicToolSettings.flag}/{@link
 * DynamicToolSettings.option} (in call order), plus all the shared chainers
 * (`cwd`, `env`, `noThrow`, `quiet`, `toolPath`, `args`).
 */
export class DynamicToolSettings extends ToolSettings {
  readonly #tool: string;
  readonly #argv: string[];

  /** Build settings for `tool`, seeded with any `initial` subcommand tokens. */
  constructor(tool: string, initial: string[] = []) {
    super();
    this.#tool = tool;
    this.#argv = [...initial];
  }

  /** The configured tool binary. */
  protected override defaultTool(): string {
    return this.#tool;
  }

  /** Append raw positional/argument tokens. */
  arg(...values: Array<string | number>): this {
    this.#argv.push(...values.map(String));
    return this;
  }

  /** Append a boolean flag, e.g. `flag("verbose")` → `--verbose` (or `-v`). */
  flag(name: string): this {
    this.#argv.push(dashed(name));
    return this;
  }

  /** Append a flag and its value as two tokens, e.g. `--output dist`. */
  option(name: string, value: string | number): this {
    this.#argv.push(dashed(name), String(value));
    return this;
  }

  /** The argv assembled from the `arg`/`flag`/`option` calls, in order. */
  protected override buildArgs(): string[] {
    return [...this.#argv];
  }
}

/** A ready-to-run task for a {@link defineTool} tool. */
export type ToolTask = (
  configure?: Configure<DynamicToolSettings>,
) => Promise<CommandOutput>;

/** Options for {@link defineTool}. */
export interface DefineToolOptions {
  /** Leading subcommand token(s) prepended to every invocation. */
  subcommand?: string | string[];
}

/**
 * Define a fluent task for a CLI that has no dedicated `@zuke` wrapper. Returns
 * a task that runs the tool, configured through a {@link DynamicToolSettings}
 * lambda — the same settings-lambda style as the built-in wrappers, with
 * `arg`/`flag`/`option` for argv and the shared `cwd`/`env`/`noThrow`/… chainers.
 *
 * ```ts
 * import { defineTool } from "jsr:@zuke/core/tooling";
 *
 * const terraform = defineTool("terraform");
 * await terraform((s) => s.arg("plan").option("out", "plan.tfplan"));
 * // → terraform plan --out plan.tfplan
 *
 * const helmUpgrade = defineTool("helm", { subcommand: "upgrade" });
 * await helmUpgrade((s) => s.arg("api", "./chart").flag("install"));
 * // → helm upgrade api ./chart --install
 * ```
 */
export function defineTool(
  tool: string,
  options: DefineToolOptions = {},
): ToolTask {
  const sub = options.subcommand;
  const initial = sub === undefined ? [] : Array.isArray(sub) ? sub : [sub];
  return (configure?: Configure<DynamicToolSettings>) =>
    runSettings(new DynamicToolSettings(tool, initial), configure);
}

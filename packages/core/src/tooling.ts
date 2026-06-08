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
 */

import { Command, type CommandOutput } from "./shell.ts";

/** Raised when a tool's binary cannot be found on the system. */
export class ToolNotFoundError extends Error {
  override name = "ToolNotFoundError";
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
  cwd(path: string): this {
    this.#cwd = path;
    return this;
  }

  /** Do not throw on a non-zero exit; inspect `code` on the output instead. */
  noThrow(): this {
    this.#throwOnError = false;
    return this;
  }

  /** Suppress live stdout/stderr streaming to the terminal. */
  quiet(): this {
    this.#quiet = true;
    return this;
  }

  /** Override the binary to run (e.g. an absolute path to the tool). */
  toolPath(path: string): this {
    this.#toolPath = path;
    return this;
  }

  /** Escape hatch: append raw arguments after all typed options. */
  args(...extra: Array<string | number>): this {
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

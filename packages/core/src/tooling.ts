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
import { type AbsolutePath, absolutePath, type PathLike } from "./path.ts";

export type { PathLike };

/**
 * How {@link ToolSettings.run} locates a wrapper's binary when no explicit
 * {@link ToolSettings.toolPath} is set:
 *
 * - `"path"` — spawn the bare tool name and let the OS resolve it on `PATH`
 *   (the default, matching a native/global install);
 * - `"node_modules"` — npx-style: walk up from the working directory looking
 *   for `node_modules/.bin/<tool>`, falling back to `PATH` on a miss (so a
 *   package hoisted to a monorepo root runs with no `.toolPath()`).
 */
export type ToolResolution = "node_modules" | "path";

/** Process-lifetime memo of `node_modules/.bin` lookups, keyed by os+tool+cwd. */
const NODE_BIN_MEMO = new Map<string, NodeBinLookup>();

/** The outcome of a `node_modules/.bin` walk. */
interface NodeBinLookup {
  /** The resolved absolute shim path, or `null` when none was found. */
  bin: string | null;
  /** Whether any `node_modules` directory was seen during the walk. */
  sawNodeModules: boolean;
}

/** The ambient `ZUKE_TOOL_RESOLUTION` override, or `null` when unset/invalid. */
function envResolution(): ToolResolution | null {
  let value: string | undefined;
  try {
    value = Deno.env.get("ZUKE_TOOL_RESOLUTION");
  } catch {
    return null; // no --allow-env: behave as if unset
  }
  return value === "node_modules" || value === "path" ? value : null;
}

/** Whether `path` names an existing file (following symlinks). */
function isFile(path: string): boolean {
  try {
    return Deno.statSync(path).isFile;
  } catch {
    return false;
  }
}

/**
 * Search `node_modules/.bin` for `tool`, walking up from `cwd` to the
 * filesystem root. On Windows the spawnable `.cmd`/`.bat` shim variants are
 * matched (a batch shim is launched via {@link windowsCmdShim}). The result is
 * memoized for the process, keyed by os+tool+cwd.
 */
function findNodeModulesBin(
  tool: string,
  cwd: string,
  os: typeof Deno.build.os,
): NodeBinLookup {
  const key = `${os}\0${tool}\0${cwd}`;
  const cached = NODE_BIN_MEMO.get(key);
  if (cached !== undefined) return cached;
  // On Windows only the batch shims can be spawned (via `cmd /c`); the bare
  // shim (no extension) is a POSIX shell script and the `.ps1` needs PowerShell,
  // so resolving to either would return a path Windows cannot launch — skip
  // them and let the PATH fallback handle those (rare) cases.
  const names = os === "windows" ? [`${tool}.cmd`, `${tool}.bat`] : [tool];
  let dir = /^(\/|[A-Za-z]:)/.test(cwd)
    ? absolutePath(cwd)
    : absolutePath(Deno.cwd(), cwd);
  let sawNodeModules = false;
  while (true) {
    const binDir = dir("node_modules", ".bin");
    if (existsDir(dir("node_modules").path)) sawNodeModules = true;
    for (const name of names) {
      const candidate = binDir(name);
      if (isFile(candidate.path)) {
        return remember(key, { bin: candidate.path, sawNodeModules: true });
      }
    }
    if (dir.isRoot) break;
    dir = dir.parent();
  }
  return remember(key, { bin: null, sawNodeModules });
}

/** Whether `path` names an existing directory. */
function existsDir(path: string): boolean {
  try {
    return Deno.statSync(path).isDirectory;
  } catch {
    return false;
  }
}

/** Store `lookup` under `key` and return it. */
function remember(key: string, lookup: NodeBinLookup): NodeBinLookup {
  NODE_BIN_MEMO.set(key, lookup);
  return lookup;
}

/** Raised when a tool's binary cannot be found on the system. */
export class ToolNotFoundError extends Error {
  /** The error name. */
  override name = "ToolNotFoundError";
  /** Build the error naming the tool binary that could not be found. */
  constructor(
    /** The binary that could not be resolved. */
    readonly tool: string,
    /**
     * Whether a `node_modules` directory was seen during resolution but lacked
     * the binary — when `true`, the message suggests `npm ci` / `toolchain()`.
     */
    sawNodeModules = false,
  ) {
    super(
      `Tool not found: "${tool}". Install it and make sure it is on PATH, ` +
        `or point at the binary explicitly with .toolPath(...).` +
        (sawNodeModules
          ? ` A node_modules directory was found but did not contain ` +
            `"${tool}" — run \`npm ci\`, or provision it via toolchain().`
          : ""),
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

/**
 * On Windows, spawn a resolved `.cmd`/`.bat` shim (such as npm's `node_modules`
 * shims) through `cmd /c` — a batch shim is not a PE executable, so
 * `Deno.Command` cannot launch it directly. Returns `argv` unchanged on other
 * platforms or when the binary is not a batch shim.
 */
export function windowsCmdShim(
  argv: ReadonlyArray<string>,
  os: typeof Deno.build.os,
): string[] {
  const first = argv[0];
  return os === "windows" && first !== undefined && /\.(cmd|bat)$/i.test(first)
    ? ["cmd", "/c", ...argv]
    : [...argv];
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
  #resolution?: ToolResolution;
  #extraArgs: string[] = [];

  /** The binary to spawn when {@link toolPath} is not set. */
  protected abstract defaultTool(): string;

  /** The subcommand argv. Must be pure — no I/O, no environment reads. */
  protected abstract buildArgs(): string[];

  /**
   * The wrapper's default binary-resolution strategy. The base returns
   * `"path"` (bare name on `PATH`); a JS-ecosystem wrapper whose binary is
   * almost always installed under `node_modules` overrides this to
   * `"node_modules"`. A per-call {@link fromNodeModules}/{@link fromPath} and
   * the ambient `ZUKE_TOOL_RESOLUTION` both take precedence over this default.
   */
  protected defaultResolution(): ToolResolution {
    return "path";
  }

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

  /**
   * Resolve the binary npx-style: walk up from the working directory looking
   * for `node_modules/.bin/<tool>`, falling back to `PATH` on a miss. Overrides
   * both the wrapper default and the ambient `ZUKE_TOOL_RESOLUTION`. Has no
   * effect once {@link toolPath} is set (an explicit path always wins).
   */
  fromNodeModules(): this {
    this.#resolution = "node_modules";
    return this;
  }

  /** Resolve the binary from `PATH` only, ignoring any `node_modules/.bin`. */
  fromPath(): this {
    this.#resolution = "path";
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

  /** The effective resolution: per-call override, else ambient, else default. */
  #effectiveResolution(): ToolResolution {
    return this.#resolution ?? envResolution() ?? this.defaultResolution();
  }

  /**
   * The argv {@link run} will actually spawn — like {@link argv}, but with the
   * `node_modules/.bin` resolution applied (so it performs I/O). Useful for
   * tests and diagnostics: it reveals whether a wrapper resolved to a local
   * shim or fell back to the bare name on `PATH`.
   */
  resolvedArgv(): string[] {
    return this.#resolveBinary().argv;
  }

  /**
   * The argv to spawn, plus whether a `node_modules` directory was seen. When
   * no explicit {@link toolPath} is set and resolution is `"node_modules"`,
   * argv[0] is rewritten to the resolved `node_modules/.bin` shim (or left as
   * the bare name to fall back to `PATH`).
   */
  #resolveBinary(): { argv: string[]; sawNodeModules: boolean } {
    const base = this.argv();
    if (this.#toolPath !== undefined || base[0] === undefined) {
      return { argv: base, sawNodeModules: false };
    }
    if (this.#effectiveResolution() !== "node_modules") {
      return { argv: base, sawNodeModules: false };
    }
    const cwd = this.#cwd ?? Deno.cwd();
    const { bin, sawNodeModules } = findNodeModulesBin(
      this.defaultTool(),
      cwd,
      this.os_,
    );
    const argv = bin === null ? base : [bin, ...base.slice(1)];
    return { argv, sawNodeModules };
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
    const { argv, sawNodeModules } = this.#resolveBinary();
    const tool = argv[0] ?? "";
    // A resolved `node_modules/.bin/*.cmd` shim must go through `cmd /c` up
    // front — it is not directly spawnable — rather than relying on the
    // NotFound retry below (which only fires for a bare name missing on PATH).
    const primary = windowsCmdShim(argv, this.os_);
    try {
      return await this.#command(primary);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      const fallback = shimFallbackArgv(argv, this.os_);
      if (fallback === null) throw new ToolNotFoundError(tool, sawNodeModules);
      try {
        return await this.#command(fallback);
      } catch (retryError) {
        if (retryError instanceof Deno.errors.NotFound) {
          throw new ToolNotFoundError(tool, sawNodeModules);
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

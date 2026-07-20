/**
 * `DpdmTasks` — a typed task function for the [dpdm](https://github.com/acrazing/dpdm)
 * CLI, which analyzes a project's module dependency graph and reports circular
 * imports. Settings-lambda style: configure a fluent settings object in a
 * lambda, and the task builds the command line and executes it.
 *
 * dpdm is a single-command tool; {@link DpdmTasks.analyze} maps to
 * `dpdm <flags> <entries...>`.
 *
 * ```ts
 * import { DpdmTasks } from "jsr:@zuke/dpdm";
 *
 * // Fail the build on any circular dependency among the entry files.
 * await DpdmTasks.analyze((s) =>
 *   s.noTree().noWarning().exitCode("circular:1").entries("src/index.ts")
 * );
 * ```
 *
 * Arguments stay a discrete argv array end-to-end — never a concatenated shell
 * string — so command construction is injection-free.
 *
 * @module
 */

import {
  type Configure,
  type PathLike,
  runSettings,
  type ToolResolution,
  ToolSettings,
} from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/** Settings for a `dpdm` analysis run. */
export class DpdmAnalyzeSettings extends ToolSettings {
  #transform = false;
  #noTree = false;
  #noCircular = false;
  #noWarning = false;
  #noProgress = false;
  #output?: string;
  #tsconfig?: string;
  #context?: string;
  #extensions: string[] = [];
  #js: string[] = [];
  #include?: string;
  #exclude?: string;
  #skipDynamicImports?: string;
  #detectUnusedFilesFrom?: string;
  #exitCode?: string;
  #entries: string[] = [];

  /** The command this settings object runs (`dpdm`). */
  protected override defaultTool(): string {
    return "dpdm";
  }

  /** Resolve the binary from `node_modules/.bin` by default — dpdm is an npm-distributed tool. */
  protected override defaultResolution(): ToolResolution {
    return "node_modules";
  }

  /** Transform TypeScript modules to JavaScript before analysis (`--transform`). */
  transform(): this {
    this.#transform = true;
    return this;
  }

  /** Suppress the dependency tree output (`--no-tree`). */
  noTree(): this {
    this.#noTree = true;
    return this;
  }

  /** Suppress the circular-dependency output (`--no-circular`). */
  noCircular(): this {
    this.#noCircular = true;
    return this;
  }

  /** Suppress warnings about unresolved/missing modules (`--no-warning`). */
  noWarning(): this {
    this.#noWarning = true;
    return this;
  }

  /** Disable the progress bar (`--no-progress`). */
  noProgress(): this {
    this.#noProgress = true;
    return this;
  }

  /** Write the analysis as JSON to a file (`--output`). */
  output(path: PathLike): this {
    this.#output = String(path);
    return this;
  }

  /** Use an explicit tsconfig for module resolution (`--tsconfig`). */
  tsconfig(path: PathLike): this {
    this.#tsconfig = String(path);
    return this;
  }

  /** Set the context directory used to shorten printed paths (`--context`). */
  context(path: PathLike): this {
    this.#context = String(path);
    return this;
  }

  /** Extensions to resolve, e.g. `.ts`, `.tsx` (`--extensions`). */
  extensions(...exts: string[]): this {
    this.#extensions.push(...exts);
    return this;
  }

  /** Extensions treated as JavaScript-like (`--js`). */
  js(...exts: string[]): this {
    this.#js.push(...exts);
    return this;
  }

  /** Only analyze files matching this regular expression (`--include`). */
  include(pattern: string): this {
    this.#include = pattern;
    return this;
  }

  /** Skip files matching this regular expression (`--exclude`). */
  exclude(pattern: string): this {
    this.#exclude = pattern;
    return this;
  }

  /** Skip dynamic imports when detecting `circular` or `tree` (`--skip-dynamic-imports`). */
  skipDynamicImports(mode: "circular" | "tree"): this {
    this.#skipDynamicImports = mode;
    return this;
  }

  /** Detect unused files starting from this glob (`--detect-unused-files-from`). */
  detectUnusedFilesFrom(glob: string): this {
    this.#detectUnusedFilesFrom = glob;
    return this;
  }

  /** Exit with a code when a case occurs, e.g. `circular:1` (`--exit-code`). */
  exitCode(rule: string): this {
    this.#exitCode = rule;
    return this;
  }

  /** The entry files or globs to analyze (appended after all options). */
  entries(...paths: PathLike[]): this {
    this.#entries.push(...paths.map(String));
    return this;
  }

  /** Assemble the `dpdm <flags> <entries...>` argv. */
  protected override buildArgs(): string[] {
    const argv: string[] = [];
    if (this.#transform) argv.push("--transform");
    if (this.#noTree) argv.push("--no-tree");
    if (this.#noCircular) argv.push("--no-circular");
    if (this.#noWarning) argv.push("--no-warning");
    if (this.#noProgress) argv.push("--no-progress");
    if (this.#output !== undefined) argv.push("--output", this.#output);
    if (this.#tsconfig !== undefined) argv.push("--tsconfig", this.#tsconfig);
    if (this.#context !== undefined) argv.push("--context", this.#context);
    if (this.#extensions.length > 0) {
      argv.push("--extensions", this.#extensions.join(","));
    }
    if (this.#js.length > 0) argv.push("--js", this.#js.join(","));
    if (this.#include !== undefined) argv.push("--include", this.#include);
    if (this.#exclude !== undefined) argv.push("--exclude", this.#exclude);
    if (this.#skipDynamicImports !== undefined) {
      argv.push("--skip-dynamic-imports", this.#skipDynamicImports);
    }
    if (this.#detectUnusedFilesFrom !== undefined) {
      argv.push("--detect-unused-files-from", this.#detectUnusedFilesFrom);
    }
    if (this.#exitCode !== undefined) argv.push("--exit-code", this.#exitCode);
    argv.push(...this.#entries);
    return argv;
  }
}

/** The shape of {@link DpdmTasks}. */
export interface DpdmTasksApi {
  /** Analyze dependencies and circular imports: `dpdm <flags> <entries...>`. */
  analyze(configure?: Configure<DpdmAnalyzeSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `dpdm` CLI. */
export const DpdmTasks: DpdmTasksApi = {
  analyze(configure?: Configure<DpdmAnalyzeSettings>): Promise<CommandOutput> {
    return runSettings(new DpdmAnalyzeSettings(), configure);
  },
};

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for the `deno` subcommands that run tests and report on their
 * coverage: `test` and `coverage`.
 */

import type { PathLike } from "@zuke/core/tooling";
import { DenoPermissionSettings, DenoSettings } from "./settings.ts";
import type { CoverageThresholds } from "./coverage.ts";
import {
  ConfigFlags,
  DebugFlags,
  DependencyFlags,
  FileSelectionFlags,
  type NodeModulesLinker,
  type NodeModulesMode,
  RuntimeFlags,
  TypeCheckFlags,
  WatchFlags,
} from "./flags.ts";

/** The report formats `deno test --reporter` accepts. */
export type DenoTestReporter = "pretty" | "dot" | "junit" | "tap";

/** Settings for `deno test`. */
export class DenoTestSettings extends DenoPermissionSettings {
  #paths: string[] = [];
  #coverage?: string;
  #coverageRawDataOnly = false;
  #clean = false;
  #filter?: string;
  #parallel = false;
  #failFast?: number | true;
  #doc = false;
  #noRun = false;
  #shuffle?: number | true;
  #traceLeaks = false;
  #sanitizeOps = false;
  #sanitizeResources = false;
  #hideStacktraces = false;
  #reporter?: DenoTestReporter;
  #junitPath?: string;
  #files = new FileSelectionFlags();
  #config = new ConfigFlags();
  #watch = new WatchFlags();
  #types = new TypeCheckFlags();
  #debug = new DebugFlags();
  #runtime = new RuntimeFlags();
  #deps = new DependencyFlags();

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

  /** Collect raw coverage data without generating a report (`--coverage-raw-data-only`). */
  coverageRawDataOnly(): this {
    this.#coverageRawDataOnly = true;
    return this;
  }

  /**
   * Empty the coverage profile directory before running (`--clean`), so a run
   * reports on its own tests rather than on whatever a previous run left.
   *
   * The directory need not come from {@link coverage}: `DENO_COVERAGE_DIR`
   * sets it too, which is why this is not tied to that setter.
   */
  clean(): this {
    this.#clean = true;
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

  /** Stop after `count` failures (`--fail-fast`), or after the first. */
  failFast(count?: number): this {
    this.#failFast = count ?? true;
    return this;
  }

  /** Evaluate the code blocks in JSDoc and Markdown as tests (`--doc`). */
  doc(): this {
    this.#doc = true;
    return this;
  }

  /** Cache the test modules without running them (`--no-run`). */
  noRun(): this {
    this.#noRun = true;
    return this;
  }

  /**
   * Randomise test order (`--shuffle`), optionally with a fixed seed so a
   * failing order can be replayed.
   */
  shuffle(seed?: number): this {
    this.#shuffle = seed ?? true;
    return this;
  }

  /**
   * Trace the ops a test leaks (`--trace-leaks`). It costs run time and is
   * the only practical way to find which test leaked a pending op — the
   * flakiest class of failure a suite has.
   */
  traceLeaks(): this {
    this.#traceLeaks = true;
    return this;
  }

  /** Require every async op started in a test to finish in it (`--sanitize-ops`). */
  sanitizeOps(): this {
    this.#sanitizeOps = true;
    return this;
  }

  /** Require every resource opened in a test to be closed in it (`--sanitize-resources`). */
  sanitizeResources(): this {
    this.#sanitizeResources = true;
    return this;
  }

  /** Omit stack traces from failure output (`--hide-stacktraces`). */
  hideStacktraces(): this {
    this.#hideStacktraces = true;
    return this;
  }

  /** Select the console reporter (`--reporter`). */
  reporter(kind: DenoTestReporter): this {
    this.#reporter = kind;
    return this;
  }

  /**
   * Also write a JUnit XML report to `path` (`--junit-path`), whatever the
   * console reporter is — this is the file a CI test-report UI ingests.
   */
  junitPath(path: PathLike): this {
    this.#junitPath = String(path);
    return this;
  }

  /** Treat the inputs as this content type (`--ext`). */
  ext(value: string): this {
    this.#files.ext(value);
    return this;
  }

  /** Skip files matching these patterns (`--ignore`). */
  ignore(...patterns: string[]): this {
    this.#files.ignore(patterns);
    return this;
  }

  /** Succeed when no test files matched (`--permit-no-files`). */
  permitNoFiles(): this {
    this.#files.permitNoFiles();
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

  /** Seed the random number generator (`--seed`), making a run reproducible. */
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

  /** Permit npm lifecycle scripts, optionally only for these packages (`--allow-scripts`). */
  allowScripts(...packages: string[]): this {
    this.#runtime.allowScripts(packages);
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

  /** Re-run when a watched file changes (`--watch`). */
  watch(): this {
    this.#watch.watch();
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

  /** Assemble the `deno test` argv. */
  protected override buildArgs(): string[] {
    if (this.#config.contradictory) {
      throw new Error(
        "DenoTasks.test: .config() names a configuration file and " +
          ".noConfig() discards it — pick one.",
      );
    }
    if (this.#types.contradictory) {
      throw new Error(
        "DenoTasks.test: .typeCheck() and .noCheck() are opposite answers to " +
          "whether the tests are type-checked — pick one.",
      );
    }
    if (this.#coverage !== undefined && this.#watch.render().length > 0) {
      throw new Error(
        "DenoTasks.test: deno refuses --coverage alongside the watch flags " +
          "— a watched run re-executes, and the profile would accumulate " +
          "across runs. Drop one of them.",
      );
    }
    if (this.#debug.attached && this.#coverage !== undefined) {
      throw new Error(
        "DenoTasks.test: deno refuses an inspector alongside --coverage — " +
          "the coverage collector and the debugger both want the V8 " +
          "inspector session. Drop .coverage(), or debug without it.",
      );
    }
    const argv = [
      "test",
      ...this.permissionArgs,
      ...this.frozenArgs,
      ...this.#config.render(),
      ...this.#deps.render(),
      ...this.#runtime.render(),
      ...this.#types.render(),
      ...this.#debug.render(),
    ];
    if (this.#coverage !== undefined) {
      argv.push(`--coverage=${this.#coverage}`);
    }
    if (this.#clean) argv.push("--clean");
    if (this.#coverageRawDataOnly) argv.push("--coverage-raw-data-only");
    if (this.#filter !== undefined) argv.push("--filter", this.#filter);
    if (this.#parallel) argv.push("--parallel");
    if (this.#failFast !== undefined) {
      argv.push(
        this.#failFast === true
          ? "--fail-fast"
          : `--fail-fast=${this.#failFast}`,
      );
    }
    if (this.#doc) argv.push("--doc");
    if (this.#noRun) argv.push("--no-run");
    if (this.#shuffle !== undefined) {
      argv.push(
        this.#shuffle === true ? "--shuffle" : `--shuffle=${this.#shuffle}`,
      );
    }
    if (this.#traceLeaks) argv.push("--trace-leaks");
    if (this.#sanitizeOps) argv.push("--sanitize-ops");
    if (this.#sanitizeResources) argv.push("--sanitize-resources");
    if (this.#hideStacktraces) argv.push("--hide-stacktraces");
    if (this.#reporter !== undefined) argv.push("--reporter", this.#reporter);
    if (this.#junitPath !== undefined) {
      argv.push("--junit-path", this.#junitPath);
    }
    argv.push(...this.#files.render(), ...this.#watch.render(), ...this.#paths);
    return argv;
  }
}

/** Settings for `deno coverage`. */
export class DenoCoverageSettings extends DenoSettings {
  #dir?: string;
  #lcov = false;
  #html = false;
  #detailed = false;
  #output?: string;
  #exclude?: string;
  #include?: string;
  #ignore: string[] = [];
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

  /** Report only on files matching the pattern (`--include=`). */
  include(pattern: string): this {
    this.#include = pattern;
    return this;
  }

  /** Skip files matching these patterns (`--ignore=`). */
  ignore(...patterns: string[]): this {
    this.#ignore.push(...patterns);
    return this;
  }

  /**
   * Write an HTML report into the profile directory (`--html`).
   *
   * Mutually exclusive with {@link lcov} and with any threshold: given both,
   * deno emits the lcov and silently produces no HTML, so asking for both is
   * refused rather than quietly honoured in half.
   */
  html(): this {
    this.#html = true;
    return this;
  }

  /** Report per-line detail alongside the summary table (`--detailed`). */
  detailed(): this {
    this.#detailed = true;
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

  /** Assemble the `deno coverage` argv. */
  protected override buildArgs(): string[] {
    if (this.#html && this.#lcov) {
      throw new Error(
        "DenoTasks.coverage: deno emits the lcov report and silently skips " +
          "the HTML one when asked for both — pick .html() or .lcov().",
      );
    }
    if (this.#html && this.#hasThreshold()) {
      throw new Error(
        "DenoTasks.coverage: a threshold is enforced by parsing the lcov " +
          "report, which deno will not emit alongside .html() — run the " +
          "gate and the HTML report as two calls.",
      );
    }
    const argv = ["coverage"];
    if (this.#dir !== undefined) argv.push(this.#dir);
    // A threshold needs an lcov report to parse, so force it on.
    if (this.#lcov || this.#hasThreshold()) argv.push("--lcov");
    if (this.#html) argv.push("--html");
    if (this.#detailed) argv.push("--detailed");
    if (this.#output !== undefined) argv.push(`--output=${this.#output}`);
    if (this.#exclude !== undefined) argv.push(`--exclude=${this.#exclude}`);
    if (this.#include !== undefined) argv.push(`--include=${this.#include}`);
    if (this.#ignore.length > 0) {
      argv.push(`--ignore=${this.#ignore.join(",")}`);
    }
    return argv;
  }
}

/** Settings for `deno bench`. */
export class DenoBenchSettings extends DenoPermissionSettings {
  #paths: string[] = [];
  #filter?: string;
  #json = false;
  #noRun = false;
  #permitNoFiles = false;
  #ignore: string[] = [];
  #config?: string;

  /** Restrict the run to specific benchmark files or directories. */
  paths(...paths: PathLike[]): this {
    this.#paths.push(...paths.map(String));
    return this;
  }

  /** Only run benchmarks whose name matches (`--filter`). */
  filter(pattern: string): this {
    this.#filter = pattern;
    return this;
  }

  /**
   * Report results as JSON (`--json`) rather than the table. Deno marks the
   * flag unstable, so treat the shape as subject to change between releases.
   */
  json(): this {
    this.#json = true;
    return this;
  }

  /**
   * Cache the benchmark modules without running them (`--no-run`) — a cheap
   * way to prove the benchmarks still compile without paying to run them.
   */
  noRun(): this {
    this.#noRun = true;
    return this;
  }

  /**
   * Succeed when no benchmark files matched (`--permit-no-files`) instead of
   * failing the target.
   */
  permitNoFiles(): this {
    this.#permitNoFiles = true;
    return this;
  }

  /** Skip files matching these patterns (`--ignore`). */
  ignore(...patterns: string[]): this {
    this.#ignore.push(...patterns);
    return this;
  }

  /** Use an explicit config file (`--config`). */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /** Assemble the `deno bench` argv. */
  protected override buildArgs(): string[] {
    const argv = ["bench", ...this.permissionArgs, ...this.frozenArgs];
    if (this.#config !== undefined) argv.push("--config", this.#config);
    if (this.#filter !== undefined) argv.push("--filter", this.#filter);
    if (this.#json) argv.push("--json");
    if (this.#noRun) argv.push("--no-run");
    if (this.#permitNoFiles) argv.push("--permit-no-files");
    if (this.#ignore.length > 0) {
      argv.push(`--ignore=${this.#ignore.join(",")}`);
    }
    argv.push(...this.#paths);
    return argv;
  }
}

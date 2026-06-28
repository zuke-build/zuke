/**
 * `NodeTasks` — typed task functions for the Node.js runtime `node`, in the
 * same settings-lambda style as the other Zuke tool wrappers: configure a
 * fluent settings object in a lambda, and the task function builds the command
 * line and executes it.
 *
 * The task names mirror common `node` invocations: {@link NodeTasks.run}
 * executes a script (`node [options] <script> [args]`),
 * {@link NodeTasks.eval} evaluates inline code (`node --eval <code>`), and
 * {@link NodeTasks.test} runs the built-in test runner (`node --test`).
 *
 * ```ts
 * import { NodeTasks } from "jsr:@zuke/node";
 * await NodeTasks.run((s) => s.script("server.js").enableSourceMaps());
 * await NodeTasks.eval((s) => s.code("console.log(process.version)"));
 * await NodeTasks.test((s) => s.paths("test/").experimentalTestCoverage());
 * ```
 *
 * Node runtime options always precede the script (or positional) arguments, as
 * Node requires. Arguments stay a discrete argv array end-to-end — never a
 * concatenated shell string — so command construction is injection-free.
 *
 * @module
 */

import {
  type Configure,
  type PathLike,
  runSettings,
  ToolSettings,
} from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/** Shared base for every `node` task: it pins the binary to `node`. */
abstract class NodeSettings extends ToolSettings {
  protected override defaultTool(): string {
    return "node";
  }
}

/** Settings for `node [options] <script> [args]`. */
export class NodeRunSettings extends NodeSettings {
  #script?: string;
  #scriptArgs: string[] = [];
  #requires: string[] = [];
  #imports: string[] = [];
  #conditions: string[] = [];
  #envFile?: string;
  #watch = false;
  #watchPaths: string[] = [];
  #enableSourceMaps = false;
  #inspect = false;
  #inspectBrk = false;
  #maxOldSpaceSize?: number;

  /** The script to execute (required). */
  script(path: PathLike): this {
    this.#script = String(path);
    return this;
  }

  /** Arguments passed to the script (after the script path). */
  scriptArgs(...args: Array<string | number>): this {
    this.#scriptArgs.push(...args.map(String));
    return this;
  }

  /** Preload a CommonJS module before the script (`--require <m>`); repeatable. */
  requireModule(...modules: string[]): this {
    for (const module of modules) this.#requires.push("--require", module);
    return this;
  }

  /** Preload an ES module before the script (`--import <m>`); repeatable. */
  importModule(...modules: string[]): this {
    for (const module of modules) this.#imports.push("--import", module);
    return this;
  }

  /** Custom export conditions to resolve (`--conditions <c>`); repeatable. */
  conditions(...names: string[]): this {
    for (const name of names) this.#conditions.push("--conditions", name);
    return this;
  }

  /** Load environment variables from a file (`--env-file=<p>`). */
  envFile(path: PathLike): this {
    this.#envFile = String(path);
    return this;
  }

  /** Restart the process on file changes (`--watch`). */
  watch(): this {
    this.#watch = true;
    return this;
  }

  /** Additional paths to watch (`--watch-path <p>`); repeatable. */
  watchPath(...paths: PathLike[]): this {
    for (const path of paths) {
      this.#watchPaths.push("--watch-path", String(path));
    }
    return this;
  }

  /** Enable Source Map V3 support for stack traces (`--enable-source-maps`). */
  enableSourceMaps(): this {
    this.#enableSourceMaps = true;
    return this;
  }

  /** Activate the inspector (`--inspect`). */
  inspect(): this {
    this.#inspect = true;
    return this;
  }

  /** Activate the inspector and break before user code starts (`--inspect-brk`). */
  inspectBrk(): this {
    this.#inspectBrk = true;
    return this;
  }

  /** Set the V8 old-space memory limit in MiB (`--max-old-space-size=<n>`). */
  maxOldSpaceSize(megabytes: number): this {
    this.#maxOldSpaceSize = megabytes;
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#script === undefined) {
      throw new Error("NodeTasks.run: .script() is required.");
    }
    const argv: string[] = [];
    argv.push(...this.#requires, ...this.#imports, ...this.#conditions);
    if (this.#envFile !== undefined) argv.push(`--env-file=${this.#envFile}`);
    if (this.#watch) argv.push("--watch");
    argv.push(...this.#watchPaths);
    if (this.#enableSourceMaps) argv.push("--enable-source-maps");
    if (this.#inspect) argv.push("--inspect");
    if (this.#inspectBrk) argv.push("--inspect-brk");
    if (this.#maxOldSpaceSize !== undefined) {
      argv.push(`--max-old-space-size=${this.#maxOldSpaceSize}`);
    }
    argv.push(this.#script, ...this.#scriptArgs);
    return argv;
  }
}

/** Settings for `node [options] --eval <code>`. */
export class NodeEvalSettings extends NodeSettings {
  #code?: string;
  #requires: string[] = [];
  #imports: string[] = [];
  #print = false;

  /** The JavaScript source to evaluate (required). */
  code(source: string): this {
    this.#code = source;
    return this;
  }

  /** Preload a CommonJS module before evaluating (`--require <m>`); repeatable. */
  requireModule(...modules: string[]): this {
    for (const module of modules) this.#requires.push("--require", module);
    return this;
  }

  /** Preload an ES module before evaluating (`--import <m>`); repeatable. */
  importModule(...modules: string[]): this {
    for (const module of modules) this.#imports.push("--import", module);
    return this;
  }

  /** Print the result of the evaluated code (`--print` instead of `--eval`). */
  print(): this {
    this.#print = true;
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#code === undefined) {
      throw new Error("NodeTasks.eval: .code() is required.");
    }
    return [
      ...this.#requires,
      ...this.#imports,
      this.#print ? "--print" : "--eval",
      this.#code,
    ];
  }
}

/** Settings for `node --test [paths] [flags]`. */
export class NodeTestSettings extends NodeSettings {
  #paths: string[] = [];
  #testNamePattern?: string;
  #testReporter?: string;
  #testConcurrency?: number;
  #only = false;
  #watch = false;
  #experimentalTestCoverage = false;

  /** Test files or directories to run (positional); repeatable. */
  paths(...values: PathLike[]): this {
    this.#paths.push(...values.map(String));
    return this;
  }

  /** Run only tests whose name matches the pattern (`--test-name-pattern <v>`). */
  testNamePattern(value: string): this {
    this.#testNamePattern = value;
    return this;
  }

  /** Select the test reporter (`--test-reporter <v>`). */
  testReporter(value: string): this {
    this.#testReporter = value;
    return this;
  }

  /** Maximum number of test files to run concurrently (`--test-concurrency <n>`). */
  testConcurrency(value: number): this {
    this.#testConcurrency = value;
    return this;
  }

  /** Run only tests marked with the `only` option (`--test-only`). */
  only(): this {
    this.#only = true;
    return this;
  }

  /** Re-run tests on file changes (`--watch`). */
  watch(): this {
    this.#watch = true;
    return this;
  }

  /** Collect and report test coverage (`--experimental-test-coverage`). */
  experimentalTestCoverage(): this {
    this.#experimentalTestCoverage = true;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["--test"];
    if (this.#testNamePattern !== undefined) {
      argv.push("--test-name-pattern", this.#testNamePattern);
    }
    if (this.#testReporter !== undefined) {
      argv.push("--test-reporter", this.#testReporter);
    }
    if (this.#testConcurrency !== undefined) {
      argv.push("--test-concurrency", String(this.#testConcurrency));
    }
    if (this.#only) argv.push("--test-only");
    if (this.#watch) argv.push("--watch");
    if (this.#experimentalTestCoverage) {
      argv.push("--experimental-test-coverage");
    }
    argv.push(...this.#paths);
    return argv;
  }
}

/** The shape of {@link NodeTasks}. */
export interface NodeTasksApi {
  /** Run a script: `node [options] <script> [args]`. */
  run(configure?: Configure<NodeRunSettings>): Promise<CommandOutput>;
  /** Evaluate inline code: `node --eval <code>`. */
  eval(configure?: Configure<NodeEvalSettings>): Promise<CommandOutput>;
  /** Run the built-in test runner: `node --test`. */
  test(configure?: Configure<NodeTestSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the Node.js runtime `node`. */
export const NodeTasks: NodeTasksApi = {
  /** Run a script: `node [options] <script> [args]`. */
  run(configure?: Configure<NodeRunSettings>): Promise<CommandOutput> {
    return runSettings(new NodeRunSettings(), configure);
  },
  /** Evaluate inline code: `node --eval <code>`. */
  eval(configure?: Configure<NodeEvalSettings>): Promise<CommandOutput> {
    return runSettings(new NodeEvalSettings(), configure);
  },
  /** Run the built-in test runner: `node --test`. */
  test(configure?: Configure<NodeTestSettings>): Promise<CommandOutput> {
    return runSettings(new NodeTestSettings(), configure);
  },
};

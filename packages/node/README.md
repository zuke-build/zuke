# @zuke/node

Typed [Node.js](https://nodejs.org) task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. The task names mirror common `node` invocations: `run`
executes a script, `eval` evaluates inline code, and `test` runs the built-in
test runner. Node runtime options always precede the script (or positional)
arguments, and arguments stay a discrete argv array, so command construction is
injection-free.

```ts
import { NodeTasks } from "jsr:@zuke/node";

await NodeTasks.run((s) =>
  s.script("server.js").enableSourceMaps().scriptArgs("--port", 3000)
);
await NodeTasks.test((s) => s.paths("test/").experimentalTestCoverage());
```

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/node` — typed Node.js task wrappers for Zuke builds.

Configure a fluent settings object in a lambda; the task builds the argv and
runs it. The task names mirror common `node` invocations: `run` executes a
script, `eval` evaluates inline code, and `test` runs the built-in test
runner.

```ts
import { NodeTasks } from "jsr:@zuke/node";
await NodeTasks.run((s) => s.script("server.js").enableSourceMaps());
```
@module

const NodeTasks: NodeTasksApi
  Typed task functions for the Node.js runtime `node`.

class NodeEvalSettings extends NodeSettings
  Settings for `node [options] --eval <code>`.

  code(source: string): this
    The JavaScript source to evaluate (required).
  requireModule(...modules: string[]): this
    Preload a CommonJS module before evaluating (`--require <m>`); repeatable.
  importModule(...modules: string[]): this
    Preload an ES module before evaluating (`--import <m>`); repeatable.
  print(): this
    Print the result of the evaluated code (`--print` instead of `--eval`).
  override protected buildArgs(): string[]
    Assemble the `node --eval <code>` (or `--print`) argv.

class NodeRunSettings extends NodeSettings
  Settings for `node [options] <script> [args]`.

  script(path: PathLike): this
    The script to execute (required).
  scriptArgs(...args: Array<string | number>): this
    Arguments passed to the script (after the script path).
  requireModule(...modules: string[]): this
    Preload a CommonJS module before the script (`--require <m>`); repeatable.
  importModule(...modules: string[]): this
    Preload an ES module before the script (`--import <m>`); repeatable.
  conditions(...names: string[]): this
    Custom export conditions to resolve (`--conditions <c>`); repeatable.
  envFile(path: PathLike): this
    Load environment variables from a file (`--env-file=<p>`).
  watch(): this
    Restart the process on file changes (`--watch`).
  watchPath(...paths: PathLike[]): this
    Additional paths to watch (`--watch-path <p>`); repeatable.
  enableSourceMaps(): this
    Enable Source Map V3 support for stack traces (`--enable-source-maps`).
  inspect(): this
    Activate the inspector (`--inspect`).
  inspectBrk(): this
    Activate the inspector and break before user code starts (`--inspect-brk`).
  maxOldSpaceSize(megabytes: number): this
    Set the V8 old-space memory limit in MiB (`--max-old-space-size=<n>`).
  override protected buildArgs(): string[]
    Assemble the `node [options] <script> [args]` argv.

abstract class NodeSettings extends ToolSettings
  Shared base for every `node` task: it pins the binary to `node`.

  override protected defaultTool(): string
    Pin the tool binary to `node`.

class NodeTestSettings extends NodeSettings
  Settings for `node --test [paths] [flags]`.

  paths(...values: PathLike[]): this
    Test files or directories to run (positional); repeatable.
  testNamePattern(value: string): this
    Run only tests whose name matches the pattern (`--test-name-pattern <v>`).
  testReporter(value: string): this
    Select the test reporter (`--test-reporter <v>`).
  testConcurrency(value: number): this
    Maximum number of test files to run concurrently (`--test-concurrency <n>`).
  only(): this
    Run only tests marked with the `only` option (`--test-only`).
  watch(): this
    Re-run tests on file changes (`--watch`).
  experimentalTestCoverage(): this
    Collect and report test coverage (`--experimental-test-coverage`).
  override protected buildArgs(): string[]
    Assemble the `node --test [paths] [flags]` argv.

interface NodeTasksApi
  The shape of {@link NodeTasks}.

  run(configure?: Configure<NodeRunSettings>): Promise<CommandOutput>
    Run a script: `node [options] <script> [args]`.
  eval(configure?: Configure<NodeEvalSettings>): Promise<CommandOutput>
    Evaluate inline code: `node --eval <code>`.
  test(configure?: Configure<NodeTestSettings>): Promise<CommandOutput>
    Run the built-in test runner: `node --test`.
````

</details>

<!-- ZUKE:API:END -->

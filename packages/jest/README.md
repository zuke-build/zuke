# @zuke/jest

Typed [`jest`](https://jestjs.io/) task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. Arguments stay a discrete argv array, so command
construction is injection-free.

```ts
import { JestTasks } from "jsr:@zuke/jest";

await JestTasks.run((s) => s.ci().coverage().maxWorkers("50%").bail());
```

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/jest` — typed `jest` task wrappers for Zuke builds.

Configure a fluent settings object in a lambda; the task builds the argv and
runs it.

```ts
import { JestTasks } from "jsr:@zuke/jest";
await JestTasks.run((s) => s.ci().coverage().maxWorkers(2));
```
@module

const JestTasks: JestTasksApi
  Typed task functions for the `jest` test runner.

class JestSettings extends ToolSettings
  Settings for a `jest` run.

  override protected defaultTool(): string
    The underlying tool binary is `jest`.
  override protected defaultResolution(): ToolResolution
    Resolve the binary from `node_modules/.bin` by default — jest is an npm-distributed tool.
  paths(...values: PathLike[]): this
    Regex patterns matched against test paths (positional); repeatable.
  config(path: PathLike): this
    Use an explicit config file (`-c`/`--config`).
  coverage(): this
    Collect test coverage (`--coverage`).
  watch(): this
    Watch files related to changed files (`--watch`).
  watchAll(): this
    Watch all files (`--watchAll`).
  ci(): this
    Run in CI mode, failing on new snapshots (`--ci`).
  runInBand(): this
    Run all tests serially in the current process (`-i`/`--runInBand`).
  maxWorkers(value: string | number): this
    Limit worker count, e.g. `2` or `50%` (`--maxWorkers`).
  updateSnapshot(): this
    Re-record snapshots (`-u`/`--updateSnapshot`).
  bail(suites: number): this
    Stop after N failing test suites (`--bail`).
  verbose(): this
    Report each individual test (`--verbose`).
  silent(): this
    Prevent tests from printing to the console (`--silent`).
  testNamePattern(pattern: string): this
    Run only tests whose name matches the pattern (`-t`/`--testNamePattern`).
  onlyChanged(): this
    Run only tests affected by changed files (`-o`/`--onlyChanged`).
  passWithNoTests(): this
    Pass when no tests are found (`--passWithNoTests`).
  detectOpenHandles(): this
    Detect handles keeping the process open (`--detectOpenHandles`).
  selectProjects(...names: string[]): this
    Restrict to named projects (`--selectProjects`); repeatable.
  reporters(...names: string[]): this
    Use the named reporters (`--reporters`); repeatable.
  override protected buildArgs(): string[]
    Assemble the `jest` argv from the configured flags and patterns.

interface JestTasksApi
  The shape of {@link JestTasks}.

  run(configure?: Configure<JestSettings>): Promise<CommandOutput>
    Run tests with `jest`.
````

</details>

<!-- ZUKE:API:END -->

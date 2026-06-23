# @zuke/vitest

Typed [`vitest`](https://vitest.dev/) task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. Arguments stay a discrete argv array, so command
construction is injection-free.

Vitest defaults to watch mode when invoked bare; this wrapper emits the one-shot
`run` subcommand by default (CI-friendly) and switches to `watch` with
`.watch()`.

```ts
import { VitestTasks } from "jsr:@zuke/vitest";

await VitestTasks.run((s) => s.coverage().reporter("dot").bail(1));
```

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/vitest` — typed `vitest` task wrappers for Zuke builds.

Configure a fluent settings object in a lambda; the task builds the argv and
runs it. The one-shot `run` subcommand is emitted by default; switch to
watch mode with `.watch()`.

```ts
import { VitestTasks } from "jsr:@zuke/vitest";
await VitestTasks.run((s) => s.coverage().reporter("dot"));
```
@module

const VitestTasks: VitestTasksApi
  Typed task functions for the `vitest` test runner.

class VitestSettings extends ToolSettings
  Settings for a `vitest` run.

  override protected defaultTool(): string
  filters(...values: string[]): this
    Filename filters matched against test files (positional); repeatable.
  watch(): this
    Use watch mode (`watch`) instead of the default one-shot `run`.
  config(path: PathLike): this
    Use an explicit config file (`-c`/`--config`).
  root(path: PathLike): this
    Project root (`--root`).
  dir(path: PathLike): this
    Restrict the scanned directory (`--dir`).
  coverage(): this
    Collect test coverage (`--coverage`).
  ui(): this
    Open the Vitest UI (`--ui`).
  update(): this
    Update snapshots (`-u`/`--update`).
  forceRun(): this
    Force one-shot mode even under watch (`--run`).
  bail(count: number): this
    Stop after N failed tests (`--bail`).
  retry(count: number): this
    Retry failed tests up to N times (`--retry`).
  shard(value: string): this
    Run a shard of the suite, e.g. `1/4` (`--shard`).
  reporter(...names: string[]): this
    Use the named reporters (`--reporter`); repeatable.
  outputFile(path: PathLike): this
    Write report output to a file (`--outputFile`).
  testNamePattern(pattern: string): this
    Run only tests whose name matches the pattern (`-t`/`--testNamePattern`).
  environment(value: string): this
    Test environment, e.g. `jsdom`, `node` (`--environment`).
  globals(): this
    Enable global test APIs (`--globals`).
  passWithNoTests(): this
    Pass when no tests are found (`--passWithNoTests`).
  silent(): this
    Suppress test console output (`--silent`).
  override protected buildArgs(): string[]

interface VitestTasksApi
  The shape of {@link VitestTasks}.

  run(configure?: Configure<VitestSettings>): Promise<CommandOutput>
    Run tests with `vitest` (one-shot `run` unless {@link VitestSettings.watch}).
````

</details>

<!-- ZUKE:API:END -->

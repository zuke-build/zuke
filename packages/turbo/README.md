# @zuke/turbo

Typed [Turborepo](https://turbo.build) CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `run` and `prune`.

```ts
import { TurboTasks } from "jsr:@zuke/turbo";

await TurboTasks.run((s) => s.tasks("build", "test").filter("web").parallel());
await TurboTasks.prune((s) => s.package("web").docker().outDir("out"));
```

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/turbo` — typed `TurboTasks` wrappers for the
Turborepo (https://turbo.build) CLI, for use in Zuke builds.

```ts
import { TurboTasks } from "jsr:@zuke/turbo";

await TurboTasks.run((s) => s.tasks("build", "test").filter("web"));
```
@module

const TurboTasks: TurboTasksApi
  Typed task functions for the `turbo` CLI.

class TurboPruneSettings extends TurboSettings
  Settings for `turbo prune`.

  package(name: string): this
    The package to prune the workspace down to (required).
  docker(): this
    Produce a Docker-friendly layout (`--docker`).
  outDir(path: PathLike): this
    Output directory (`--out-dir`).
  override protected buildArgs(): string[]

class TurboRunSettings extends TurboSettings
  Settings for `turbo run`.

  tasks(...names: string[]): this
    The package.json task(s) to run (positional; at least one required).
  filter(pattern: string): this
    Restrict to matching packages (`--filter`); repeatable.
  parallel(): this
    Run tasks in parallel, ignoring dependencies (`--parallel`).
  concurrency(value: string): this
    Limit concurrency, e.g. `10` or `50%` (`--concurrency`).
  force(): this
    Ignore cache hits and force execution (`--force`).
  noCache(): this
    Disable reading and writing the cache (`--no-cache`).
  continue(): this
    Continue running tasks even after one fails (`--continue`).
  dryRun(): this
    List what would run without executing (`--dry-run`).
  outputLogs(mode: string): this
    Output-log mode, e.g. `full`, `hash-only`, `errors-only` (`--output-logs`).
  override protected buildArgs(): string[]

interface TurboTasksApi
  The shape of {@link TurboTasks}.

  run(configure?: Configure<TurboRunSettings>): Promise<CommandOutput>
    Run workspace tasks: `turbo run`.
  prune(configure?: Configure<TurboPruneSettings>): Promise<CommandOutput>
    Prune the workspace to a package: `turbo prune`.
````

</details>

<!-- ZUKE:API:END -->

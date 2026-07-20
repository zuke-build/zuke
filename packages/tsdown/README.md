# @zuke/tsdown

Typed [`tsdown`](https://tsdown.dev) task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. `tsdown` is a Rolldown-powered, tsup-like bundler for
TypeScript and JavaScript libraries. Arguments stay a discrete argv array, so
command construction is injection-free.

```ts
import { TsdownTasks } from "jsr:@zuke/tsdown";

await TsdownTasks.build((s) =>
  s.entry("src/index.ts").format("esm", "cjs").dts().minify().clean()
);
```

`TsdownTasks.migrate` wraps `tsdown migrate`, which migrates an existing project
(for example a tsup project) over to tsdown:

```ts
await TsdownTasks.migrate((s) => s.from("tsup").dryRun());
```

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/tsdown` — a typed `TsdownTasks` wrapper for the
tsdown (https://tsdown.dev) bundler, for use in Zuke builds.

```ts
import { TsdownTasks } from "jsr:@zuke/tsdown";

await TsdownTasks.build((s) =>
  s.entry("src/index.ts").format("esm", "cjs").dts().minify().clean()
);
```
@module

const TsdownTasks: TsdownTasksApi
  Typed task functions for the `tsdown` bundler.

class TsdownBuildSettings extends ToolSettings
  Settings for a `tsdown` bundle run (`tsdown [entries] [flags]`).

  override protected defaultTool(): string
    The default executable to run: `tsdown`.
  entry(...paths: PathLike[]): this
    Entry point(s) to bundle (positional); repeatable.
  format(...formats: TsdownFormat[]): this
    Output format(s), joined into `--format` (e.g. `esm,cjs`).
  dts(): this
    Emit TypeScript declaration files (`--dts`).
  minify(): this
    Minify the output (`--minify`).
  sourcemap(): this
    Emit source maps (`--sourcemap`).
  clean(): this
    Clean the output directory before building (`--clean`).
  watch(): this
    Rebuild on change (`--watch`).
  outDir(path: PathLike): this
    Output directory (`--out-dir`).
  target(value: string): this
    Compilation target, e.g. `es2022` or `node18` (`--target`).
  tsconfig(path: PathLike): this
    Path to a tsconfig file (`--tsconfig`).
  config(path: PathLike): this
    Path to a tsdown config file (`--config`).
  platform(value: string): this
    Target platform, e.g. `node`, `browser`, or `neutral` (`--platform`).
  treeshake(): this
    Enable tree-shaking of the output (`--treeshake`).
  override protected buildArgs(): string[]
    Assemble the `tsdown [entries] [flags]` argv.

class TsdownMigrateSettings extends ToolSettings
  Settings for a `tsdown migrate` run (`tsdown migrate [flags]`).

  override protected defaultTool(): string
    The default executable to run: `tsdown`.
  from(value: string): this
    The tool to migrate from, e.g. `tsup` (`--from`).
  dryRun(): this
    Preview the migration without writing any files (`--dry-run`).
  override protected buildArgs(): string[]
    Assemble the `tsdown migrate [flags]` argv.

interface TsdownTasksApi
  The shape of {@link TsdownTasks}.

  build(configure?: Configure<TsdownBuildSettings>): Promise<CommandOutput>
    Bundle the entry points: `tsdown`.
  migrate(configure?: Configure<TsdownMigrateSettings>): Promise<CommandOutput>
    Migrate an existing project to tsdown: `tsdown migrate`.

type TsdownFormat = "esm" | "cjs" | "iife" | "umd"
  An output format accepted by tsdown's `--format`.
````

</details>

<!-- ZUKE:API:END -->

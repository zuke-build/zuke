# @zuke/tsup

Typed [tsup](https://tsup.egoist.dev) CLI task wrapper for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — bundle
TypeScript/JavaScript with formats, declarations, minification, and more.

```ts
import { TsupTasks } from "jsr:@zuke/tsup";

await TsupTasks.build((s) =>
  s.entry("src/index.ts").format("esm", "cjs").dts().minify().clean()
);
```

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/tsup` — a typed `TsupTasks` wrapper for the
tsup (https://tsup.egoist.dev) bundler, for use in Zuke builds.

```ts
import { TsupTasks } from "jsr:@zuke/tsup";

await TsupTasks.build((s) =>
  s.entry("src/index.ts").format("esm", "cjs").dts().minify().clean()
);
```
@module

const TsupTasks: TsupTasksApi
  Typed task functions for the `tsup` bundler.

class TsupBuildSettings extends ToolSettings
  Settings for a `tsup` bundle run.

  override protected defaultTool(): string
  entry(...paths: PathLike[]): this
    Entry point(s) to bundle (positional); repeatable.
  format(...formats: TsupFormat[]): this
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
    Path to a tsup config file (`--config`).
  override protected buildArgs(): string[]

interface TsupTasksApi
  The shape of {@link TsupTasks}.

  build(configure?: Configure<TsupBuildSettings>): Promise<CommandOutput>
    Bundle the entry points: `tsup`.

type TsupFormat = "esm" | "cjs" | "iife"
  An output format accepted by tsup's `--format`.
````

</details>

<!-- ZUKE:API:END -->

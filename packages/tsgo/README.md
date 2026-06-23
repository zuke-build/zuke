# @zuke/tsgo

Typed [`tsgo`](https://github.com/microsoft/typescript-go) task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. `tsgo` is the native TypeScript compiler (TypeScript 7 /
`@typescript/native-preview`); it mirrors the `tsc` command line. Arguments stay
a discrete argv array, so command construction is injection-free.

```ts
import { TsgoTasks } from "jsr:@zuke/tsgo";

await TsgoTasks.tsgo((s) =>
  s.project("tsconfig.json").noEmit().strict().pretty()
);
```

> [!NOTE]
> `tsgo` is a preview. Within this repo, `deno check` remains the authoritative
> type-checker — see [`CLAUDE.md`](../../CLAUDE.md). This wrapper is for
> projects that drive `tsgo` directly.

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/tsgo` — typed `tsgo` task wrappers for Zuke builds.

`tsgo` is the native TypeScript compiler (TypeScript 7 /
`@typescript/native-preview`). Configure a fluent settings object in a
lambda; the task builds the argv and runs it.

```ts
import { TsgoTasks } from "jsr:@zuke/tsgo";
await TsgoTasks.tsgo((s) => s.project("tsconfig.json").noEmit());
```
@module

const TsgoTasks: TsgoTasksApi
  Typed task functions for the `tsgo` TypeScript compiler.

class TsgoSettings extends ToolSettings
  Settings for a `tsgo` run.

  override protected defaultTool(): string
  paths(...values: PathLike[]): this
    Source files to compile (positional); repeatable.
  project(path: PathLike): this
    Compile the project at the given config or directory (`-p`/`--project`).
  noEmit(): this
    Type-check without emitting output (`--noEmit`).
  outDir(path: PathLike): this
    Directory for emitted files (`--outDir`).
  declaration(): this
    Generate `.d.ts` declaration files (`--declaration`).
  emitDeclarationOnly(): this
    Emit declarations only, no JavaScript (`--emitDeclarationOnly`).
  incremental(): this
    Reuse prior build information for faster rebuilds (`--incremental`).
  watch(): this
    Recompile on file changes (`--watch`).
  strict(): this
    Enable all strict type-checking options (`--strict`).
  pretty(): this
    Colourise and format diagnostics (`--pretty`).
  listFiles(): this
    Print the names of files included in the compilation (`--listFiles`).
  skipLibCheck(): this
    Skip type-checking of declaration files (`--skipLibCheck`).
  noEmitOnError(): this
    Do not emit output if any errors are reported (`--noEmitOnError`).
  target(value: string): this
    Target ECMAScript version, e.g. `es2022` (`--target`).
  module(value: string): this
    Module system, e.g. `esnext`, `nodenext` (`--module`).
  override protected buildArgs(): string[]

interface TsgoTasksApi
  The shape of {@link TsgoTasks}.

  tsgo(configure?: Configure<TsgoSettings>): Promise<CommandOutput>
    Type-check (or compile) with `tsgo`.
````

</details>

<!-- ZUKE:API:END -->

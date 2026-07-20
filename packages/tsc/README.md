# @zuke/tsc

Typed [`tsc`](https://www.typescriptlang.org) task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. `tsc` is the TypeScript compiler; this package wraps both a
standard compile or type-check and a `tsc --build` project-references build.
Arguments stay a discrete argv array, so command construction is injection-free.

```ts
import { TscTasks } from "jsr:@zuke/tsc";

await TscTasks.tsc((s) =>
  s.project("tsconfig.json").noEmit().strict().pretty()
);

await TscTasks.build((s) => s.projects("packages/a", "packages/b").verbose());
```

> [!NOTE]
> Within this repo, `deno check` remains the authoritative type-checker — see
> [`CLAUDE.md`](../../CLAUDE.md). This wrapper is for projects that drive `tsc`
> directly.

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/tsc` — typed `tsc` task wrappers for Zuke builds.

`tsc` is the TypeScript compiler. Configure a fluent settings object in a
lambda; the task builds the argv and runs it. Two tasks are exposed: a
standard {@link TscTasks.tsc} compile/type-check and a
{@link TscTasks.build} project-references build (`tsc --build`).

```ts
import { TscTasks } from "jsr:@zuke/tsc";
await TscTasks.tsc((s) => s.project("tsconfig.json").noEmit());
await TscTasks.build((s) => s.projects("packages/a", "packages/b"));
```
@module

const TscTasks: TscTasksApi
  Typed task functions for the `tsc` TypeScript compiler.

abstract class TscBaseSettings extends ToolSettings
  Shared base for `tsc` settings; resolves the `tsc` binary.

  override protected defaultTool(): string
    The default binary these settings invoke: `tsc`.

class TscBuildSettings extends TscBaseSettings
  Settings for a `tsc --build` project-references run.

  projects(...values: PathLike[]): this
    Project config files or directories to build (positional); repeatable.
  clean(): this
    Delete the outputs of all projects (`--clean`).
  force(): this
    Build all projects, even those that appear up to date (`--force`).
  dry(): this
    Show what would be built without building it (`--dry`).
  watch(): this
    Rebuild projects on file changes (`--watch`).
  verbose(): this
    Print verbose logging about the build (`--verbose`).
  incremental(): this
    Reuse prior build information for faster rebuilds (`--incremental`).
  override protected buildArgs(): string[]
    Assemble the `tsc --build` argv from the configured options.

class TscSettings extends TscBaseSettings
  Settings for a standard `tsc` run.

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
    Assemble the `tsc` argv from the configured compile options.

interface TscTasksApi
  The shape of {@link TscTasks}.

  tsc(configure?: Configure<TscSettings>): Promise<CommandOutput>
    Type-check (or compile) with `tsc`.
  build(configure?: Configure<TscBuildSettings>): Promise<CommandOutput>
    Run a project-references build with `tsc --build`.
````

</details>

<!-- ZUKE:API:END -->

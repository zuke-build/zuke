# @zuke/tsx

Typed [`tsx`](https://tsx.is/) task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. The task names mirror the CLI: `tsx` runs an entry point
and `watch` re-runs it on changes. Arguments stay a discrete argv array, so
command construction is injection-free.

```ts
import { TsxTasks } from "jsr:@zuke/tsx";

await TsxTasks.tsx((s) =>
  s.script("src/main.ts").tsconfig("tsconfig.json").scriptArgs("--port", 3000)
);

// Watch mode:
await TsxTasks.watch((s) => s.script("src/main.ts").noClearScreen());
```

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/tsx` — typed `tsx` task wrappers for Zuke builds.

Configure a fluent settings object in a lambda; the task builds the argv and
runs it. The task names mirror the CLI: `tsx` runs an entry point and `watch`
re-runs it on changes.

```ts
import { TsxTasks } from "jsr:@zuke/tsx";
await TsxTasks.tsx((s) => s.script("src/main.ts").tsconfig("tsconfig.json"));
```
@module

const TsxTasks: TsxTasksApi
  Typed task functions for the `tsx` TypeScript runner.

abstract class TsxCommonSettings extends ToolSettings
  Options shared by every `tsx` invocation: the entry point and how to load it.

  override protected defaultTool(): string
    The underlying executable: `tsx`.
  override protected defaultResolution(): ToolResolution
    Resolve the binary from `node_modules/.bin` by default — tsx is an npm-distributed tool.
  script(path: PathLike): this
    The entry point to execute (required).
  scriptArgs(...args: Array<string | number>): this
    Arguments passed to the script (after the entry point).
  tsconfig(path: PathLike): this
    Use an explicit `tsconfig.json` (`--tsconfig`).
  envFile(path: PathLike): this
    Load environment variables from a file (`--env-file`).
  noCache(): this
    Disable the file-system transpile cache (`--no-cache`).
  noWarnings(): this
    Suppress Node warnings (`--no-warnings`).
  conditions(...names: string[]): this
    Custom export conditions to resolve (`--conditions`); repeatable.
  importModule(...modules: string[]): this
    Preload a module before the entry point (`--import`); repeatable.
  protected entryArgs(): string[]
    The option flags, then the required entry point and its arguments.

class TsxSettings extends TsxCommonSettings
  Settings for `tsx <file>`.

  override protected buildArgs(): string[]
    Assemble the `tsx <file>` argv.

class TsxWatchSettings extends TsxCommonSettings
  Settings for `tsx watch <file>`.

  noClearScreen(): this
    Keep prior output between reruns (`--clear-screen=false`).
  include(...paths: PathLike[]): this
    Additional paths to watch (`--include`); repeatable.
  exclude(...paths: PathLike[]): this
    Paths to ignore while watching (`--exclude`); repeatable.
  override protected buildArgs(): string[]
    Assemble the `tsx watch <file>` argv.

interface TsxTasksApi
  The shape of {@link TsxTasks}.

  tsx(configure?: Configure<TsxSettings>): Promise<CommandOutput>
    Run a TypeScript entry point: `tsx <file>`.
  watch(configure?: Configure<TsxWatchSettings>): Promise<CommandOutput>
    Re-run an entry point on changes: `tsx watch <file>`.
````

</details>

<!-- ZUKE:API:END -->

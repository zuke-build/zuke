# @zuke/tsc-alias

Typed [`tsc-alias`](https://github.com/justkey007/tsc-alias) task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. `tsc-alias` rewrites the TypeScript path aliases declared
in your `tsconfig.json` `paths` mapping into plain relative imports in the
compiled output, so the JavaScript emitted by `tsc` runs without a path
resolver. Arguments stay a discrete argv array, so command construction is
injection-free.

```ts
import { TscAliasTasks } from "jsr:@zuke/tsc-alias";

await TscAliasTasks.run((s) => s.project("tsconfig.json").resolveFullPaths());
```

Run it after `tsc` (or alongside it with `.watch()`) to fix up the alias imports
in the freshly compiled files.

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/tsc-alias` — typed `tsc-alias` task wrappers for Zuke builds.

`tsc-alias` rewrites TypeScript path aliases (the `paths` mapping in
`tsconfig.json`) into relative imports in the compiled output, so the emitted
JavaScript runs without a path resolver. Configure a fluent settings object in
a lambda; the task builds the argv and runs it.

```ts
import { TscAliasTasks } from "jsr:@zuke/tsc-alias";
await TscAliasTasks.run((s) => s.project("tsconfig.json").resolveFullPaths());
```
@module

const TscAliasTasks: TscAliasTasksApi
  Typed task functions for the `tsc-alias` path-alias rewriter.

class TscAliasRunSettings extends ToolSettings
  Settings for a `tsc-alias` run.

  override protected defaultTool(): string
    The executable this settings object drives (`tsc-alias`).
  override protected defaultResolution(): ToolResolution
    Resolve the binary from `node_modules/.bin` by default — tsc-alias is an npm-distributed tool.
  project(path: PathLike): this
    Path to the `tsconfig.json` to read aliases from (`-p`/`--project`).
  watch(): this
    Re-run on file changes (`--watch`).
  outDir(path: PathLike): this
    Output directory of the compiled files to rewrite (`--outDir`).
  declarationDir(path: PathLike): this
    Output directory of the emitted declaration files (`--declarationDir`).
  resolveFullPaths(): this
    Attempt to fully resolve alias paths, including extensions (`--resolveFullPaths`).
  resolveFullExtension(ext: string): this
    Extension to append when resolving full paths, e.g. `.js` (`--resolveFullExtension`).
  replacers(...files: PathLike[]): this
    Additional replacer module file(s); repeatable (`-f`/`--replacers`).
  dir(path: PathLike): this
    Base directory to resolve relative paths against (`--dir`).
  fileExtensions(list: string): this
    Comma-separated list of file extensions to process (`--fileExtensions`).
  verbose(): this
    Print verbose output (`--verbose`).
  debug(): this
    Print debug output (`--debug`).
  silent(): this
    Suppress all output (`--silent`).
  override protected buildArgs(): string[]
    Assemble the `tsc-alias` argv from the configured settings.

interface TscAliasTasksApi
  The shape of {@link TscAliasTasks}.

  run(configure?: Configure<TscAliasRunSettings>): Promise<CommandOutput>
    Rewrite TypeScript path aliases in compiled output with `tsc-alias`.
````

</details>

<!-- ZUKE:API:END -->

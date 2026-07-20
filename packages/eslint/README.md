# @zuke/eslint

Typed [`eslint`](https://eslint.org/) task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. Arguments stay a discrete argv array, so command
construction is injection-free.

```ts
import { EslintTasks } from "jsr:@zuke/eslint";

await EslintTasks.lint((s) =>
  s.paths("src").ext(".ts", ".tsx").fix().maxWarnings(0)
);
```

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/eslint` — typed `eslint` task wrappers for Zuke builds.

Configure a fluent settings object in a lambda; the task builds the argv and
runs it.

```ts
import { EslintTasks } from "jsr:@zuke/eslint";
await EslintTasks.lint((s) => s.paths("src").ext(".ts", ".tsx").fix());
```
@module

const EslintTasks: EslintTasksApi
  Typed task functions for the `eslint` linter.

class EslintSettings extends ToolSettings
  Settings for an `eslint` run.

  override protected defaultTool(): string
    The default executable this settings object runs (`eslint`).
  paths(...values: PathLike[]): this
    Files, directories, or globs to lint (positional); repeatable.
  config(path: PathLike): this
    Use an explicit config file (`-c`/`--config`).
  ext(...extensions: string[]): this
    Additional file extensions to lint (`--ext`); repeatable.
  fix(): this
    Apply automatic fixes (`--fix`).
  fixDryRun(): this
    Compute fixes without writing them (`--fix-dry-run`).
  fixType(...types: string[]): this
    Restrict fixes to the given types (`--fix-type`); repeatable.
  quietWarnings(): this
    Report errors only, suppressing warnings (`--quiet`).
  maxWarnings(count: number): this
    Fail once this many warnings are reached (`--max-warnings`).
  format(value: string): this
    Output format, e.g. `stylish`, `json` (`-f`/`--format`).
  outputFile(path: PathLike): this
    Write the report to a file (`-o`/`--output-file`).
  cache(): this
    Cache results between runs (`--cache`).
  cacheLocation(path: PathLike): this
    Where to store the cache (`--cache-location`).
  ignorePath(path: PathLike): this
    Read ignore globs from a file (`--ignore-path`).
  ignorePattern(glob: string): this
    Ignore files matching a glob (`--ignore-pattern`); repeatable.
  noIgnore(): this
    Disable all ignore handling (`--no-ignore`).
  noConfigLookup(): this
    Do not search for a config file (`--no-config-lookup`).
  reportUnusedDisableDirectives(): this
    Report unused `eslint-disable` directives (`--report-unused-disable-directives`).
  override protected buildArgs(): string[]
    Assemble the `eslint` argv from the configured settings.

interface EslintTasksApi
  The shape of {@link EslintTasks}.

  lint(configure?: Configure<EslintSettings>): Promise<CommandOutput>
    Lint with `eslint`.
````

</details>

<!-- ZUKE:API:END -->

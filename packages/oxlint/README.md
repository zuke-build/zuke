# @zuke/oxlint

Typed [`oxlint`](https://oxc.rs/docs/guide/usage/linter.html) task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. Arguments stay a discrete argv array, so command
construction is injection-free.

```ts
import { OxlintTasks } from "jsr:@zuke/oxlint";

await OxlintTasks.lint((s) =>
  s.paths("src").config(".oxlintrc.json").fix().denyWarnings()
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
`@zuke/oxlint` — typed `oxlint` task wrappers for Zuke builds.

Configure a fluent settings object in a lambda; the task builds the argv and
runs it.

```ts
import { OxlintTasks } from "jsr:@zuke/oxlint";
await OxlintTasks.lint((s) => s.paths("src").fix().denyWarnings());
```
@module

const OxlintTasks: OxlintTasksApi
  Typed task functions for the `oxlint` linter.

class OxlintSettings extends ToolSettings
  Settings for an `oxlint` run.

  override protected defaultTool(): string
  paths(...values: PathLike[]): this
    Files or directories to lint (positional); repeatable.
  config(path: PathLike): this
    Use an explicit config file (`-c`/`--config`).
  tsconfig(path: PathLike): this
    Point at a `tsconfig.json` for type-aware rules (`--tsconfig`).
  fix(): this
    Apply automatic fixes (`--fix`).
  fixSuggestions(): this
    Apply suggestion fixes too (`--fix-suggestions`).
  deny(rule: string): this
    Raise a rule or category to error (`-D`/`--deny`); repeatable.
  warn(rule: string): this
    Set a rule or category to warning (`-W`/`--warn`); repeatable.
  allow(rule: string): this
    Turn a rule or category off (`-A`/`--allow`); repeatable.
  ignorePath(path: PathLike): this
    Read ignore globs from a file (`--ignore-path`).
  ignorePattern(glob: string): this
    Ignore files matching a glob (`--ignore-pattern`); repeatable.
  maxWarnings(count: number): this
    Fail once this many warnings are reached (`--max-warnings`).
  quietWarnings(): this
    Report errors only, suppressing warnings (`--quiet`).
  denyWarnings(): this
    Exit non-zero if any warnings are found (`--deny-warnings`).
  format(value: string): this
    Output format, e.g. `default`, `json`, `github` (`-f`/`--format`).
  threads(count: number): this
    Number of threads to use (`--threads`).
  override protected buildArgs(): string[]

interface OxlintTasksApi
  The shape of {@link OxlintTasks}.

  lint(configure?: Configure<OxlintSettings>): Promise<CommandOutput>
    Lint with `oxlint`.
````

</details>

<!-- ZUKE:API:END -->

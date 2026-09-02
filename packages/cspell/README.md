# @zuke/cspell

Typed [`cspell`](https://cspell.org/) task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. Arguments stay a discrete argv array, so command
construction is injection-free.

```ts
import { CspellTasks } from "jsr:@zuke/cspell";

await CspellTasks.lint((s) =>
  s.files("**").config("cspell.json").noProgress().showSuggestions()
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
`@zuke/cspell` — typed `cspell` task wrappers for Zuke builds.

Configure a fluent settings object in a lambda; the task builds the argv and
runs it.

```ts
import { CspellTasks } from "jsr:@zuke/cspell";
await CspellTasks.lint((s) => s.files("**").noProgress().showSuggestions());
```
@module

const CspellTasks: CspellTasksApi
  Typed task functions for the `cspell` spell-checker.

class CspellSettings extends ToolSettings
  Settings for a `cspell lint` run.

  override protected defaultTool(): string
    The default executable name (`cspell`).
  override protected defaultResolution(): ToolResolution
    Resolve the binary from `node_modules/.bin` by default — cspell is an npm-distributed tool.
  files(...globs: PathLike[]): this
    Files or globs to check (positional); repeatable.
  config(path: PathLike): this
    Use an explicit config file (`-c`/`--config`).
  noProgress(): this
    Suppress the progress output (`--no-progress`).
  noSummary(): this
    Suppress the summary line (`--no-summary`).
  showSuggestions(): this
    Print spelling suggestions for each issue (`--show-suggestions`).
  showContext(): this
    Print the surrounding line for each issue (`--show-context`).
  quietOutput(): this
    Only emit issues, hiding informational output (`--quiet`).
  cache(): this
    Cache results between runs (`--cache`).
  dot(): this
    Include dotfiles and dot-directories (`--dot`).
  gitignore(): this
    Honour `.gitignore` files (`--gitignore`).
  gitignoreRoot(path: PathLike): this
    Stop the `.gitignore` search at this directory (`--gitignore-root`).

    Without it cspell keeps walking up past the repository root and can pick up
    an unrelated `.gitignore` from a parent directory — so a run inside a git
    worktree, whose checkout lives outside the main working tree, sees ignore
    rules that do not belong to it. Point this at the repository root to bound
    the search.
  noMustFindFiles(): this
    Exit successfully when a glob matches nothing (`--no-must-find-files`).

    cspell fails by default if any file argument matched no files. A run scoped
    to a computed file list — the staged files, the files a diff touched — can
    legitimately be empty, so a file-scoped run wants this.
  unique(): this
    Report each unique issue only once (`--unique`).
  locale(value: string): this
    Restrict to a locale, e.g. `en,en-GB` (`--locale`).
  exclude(glob: string): this
    Exclude files matching a glob (`-e`/`--exclude`); repeatable.
  maxDuplicateProblems(count: number): this
    Cap the number of duplicate problems reported (`--max-duplicate-problems`).
  override protected onOutput(output: CommandOutput): void
    Report `Files` checked and `Issues` found onto the build summary.
  override protected buildArgs(): string[]
    Assemble the `cspell lint` argv.

interface CspellTasksApi
  The shape of {@link CspellTasks}.

  lint(configure?: Configure<CspellSettings>): Promise<CommandOutput>
    Spell-check with `cspell lint`.
````

</details>

<!-- ZUKE:API:END -->

# @zuke/dprint

Typed [`dprint`](https://dprint.dev/) task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. `fmt` formats files in place; `check` verifies formatting.
Arguments stay a discrete argv array, so command construction is injection-free.

```ts
import { DprintTasks } from "@zuke/dprint";

await DprintTasks.check((s) => s.config("dprint.json"));
await DprintTasks.fmt((s) => s.files("src").excludes("**/*.md").incremental());
```

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/dprint` — typed `dprint` task wrappers for Zuke builds.

Configure a fluent settings object in a lambda; the task builds the argv and
runs it. `fmt` formats files in place; `check` verifies formatting.

```ts
import { DprintTasks } from "@zuke/dprint";
await DprintTasks.check((s) => s.config("dprint.json"));
```
@module

const DprintTasks: DprintTasksApi
  Typed task functions for the `dprint` code formatter.

class DprintCheckSettings extends DprintSettings
  Settings for `dprint check` (verify formatting without writing).

  override protected subcommand(): string
    The dprint subcommand this settings class runs: `check`.
  override protected onOutput(output: CommandOutput): void
    Report `Unformatted`, the files that need formatting, onto the build summary.

class DprintFmtSettings extends DprintSettings
  Settings for `dprint fmt` (format files in place).

  override protected subcommand(): string
    The dprint subcommand this settings class runs: `fmt`.
  stdin(name: string, text: string): this
    Format `text` instead of files, as the file `name` would be formatted
    (`--stdin`): `name` is a file name, a path, or just an extension such as
    `ts`, and picks the plugin and the config's rules. The result is the
    command's stdout, and nothing is written.
  override protected buildArgs(): string[]
    Assemble the argv, with `--stdin <name>` when formatting given text.
  override protected stdinInput(): string | undefined
    The text {@link stdin} formats, written to the tool's standard input.
  override protected onOutput(output: CommandOutput): void
    Report `Formatted`, the files the run changed, onto the build summary.
    Formatting given text changes no file, and its stdout is the result.

abstract class DprintSettings extends ToolSettings
  Shared options for a `dprint` subcommand (`fmt` or `check`).

  override protected defaultTool(): string
    The default executable this settings class invokes: `dprint`.
  override protected defaultResolution(): ToolResolution
    Resolve the binary from `node_modules/.bin` by default — dprint is an npm-distributed tool.
  abstract protected subcommand(): string
    The dprint subcommand this settings class runs.
  config(path: PathLike): this
    Use an explicit config file (`-c`/`--config`).
  files(...patterns: PathLike[]): this
    File paths or globs to format/check (positional); repeatable.
  excludes(...patterns: string[]): this
    Exclude files matching a pattern (`--excludes`); repeatable.
  incremental(): this
    Only process files that changed since the last run (`--incremental`).
  allowNoFiles(): this
    Do not error when no files are matched (`--allow-no-files`).
  override protected buildArgs(): string[]
    Assemble the `dprint <subcommand>` argv from the configured options.

interface DprintTasksApi
  The shape of {@link DprintTasks}.

  fmt(configure?: Configure<DprintFmtSettings>): Promise<CommandOutput>
    Format files in place: `dprint fmt`.
  check(configure?: Configure<DprintCheckSettings>): Promise<CommandOutput>
    Verify formatting: `dprint check`.
````

</details>

<!-- ZUKE:API:END -->

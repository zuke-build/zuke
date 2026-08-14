# @zuke/redocly

Typed [Redocly CLI](https://redocly.com/docs/cli) task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `lint`, `bundle`, and
`split` for OpenAPI descriptions.

```ts
import { RedoclyTasks } from "jsr:@zuke/redocly";

await RedoclyTasks.lint((s) =>
  s.paths("openapi.yaml").skipRule("no-empty-servers").format("summary")
);
await RedoclyTasks.bundle((s) =>
  s.paths("openapi.yaml").output("dist/openapi.yaml").dereferenced()
);
await RedoclyTasks.split((s) => s.api("openapi.yaml").outDir("docs/api"));
```

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/redocly` — typed Redocly CLI (https://redocly.com/docs/cli) task
wrappers for Zuke builds.

Configure a fluent settings object in a lambda; the task builds the argv and
runs it.

```ts
import { RedoclyTasks } from "jsr:@zuke/redocly";
await RedoclyTasks.lint((s) => s.paths("openapi.yaml").format("summary"));
```
@module

const RedoclyTasks: RedoclyTasksApi
  Typed task functions for the `redocly` CLI.

class RedoclyBundleSettings extends RedoclySettings
  Settings for `redocly bundle`.

  paths(...values: PathLike[]): this
    The API descriptions to bundle — paths or aliases from the config (positional); repeatable.
  output(path: PathLike): this
    Write the bundle to this file or directory (`--output`).
  dereferenced(): this
    Inline every `$ref` instead of keeping the components (`--dereferenced`).
  ext(value: "json" | "yaml" | "yml"): this
    The output file extension, `json`, `yaml`, or `yml` (`--ext`).
  override protected buildArgs(): string[]
    Assemble the `redocly bundle` argv.

class RedoclyLintSettings extends RedoclySettings
  Settings for `redocly lint`.

  paths(...values: PathLike[]): this
    The API descriptions to lint — paths or aliases from the config (positional); repeatable.
  skipRule(...rules: string[]): this
    Skip a rule for this run (`--skip-rule`); repeatable.

    Use it for a rule the description cannot satisfy yet, so the rest of the
    ruleset still gates the build instead of the whole lint being turned off.
  format(value: RedoclyLintFormat): this
    Select the output format (`--format`).
  override protected buildArgs(): string[]
    Assemble the `redocly lint` argv.

abstract class RedoclySettings extends ToolSettings
  Base for all `redocly` subcommand settings: the binary is `redocly`, with
  the `--config` option every subcommand accepts.

  override protected defaultTool(): string
    The default binary this wrapper invokes: `redocly`.
  override protected defaultResolution(): ToolResolution
    Resolve the binary from `node_modules/.bin` by default — Redocly CLI is an npm-distributed tool.
  config(path: PathLike): this
    Use an explicit config file (`--config`) instead of the discovered `redocly.yaml`.
  protected baseArgs(): string[]
    The shared option arguments.

class RedoclySplitSettings extends RedoclySettings
  Settings for `redocly split`.

  api(path: PathLike): this
    The API description to split into a multi-file structure (positional; required).
  outDir(path: PathLike): this
    The directory the split files are written to (`--outDir`; required).
  separator(value: string): this
    The separator used in the generated path item file names (`--separator`).
  override protected buildArgs(): string[]
    Assemble the `redocly split` argv.

interface RedoclyTasksApi
  The shape of {@link RedoclyTasks}.

  lint(configure?: Configure<RedoclyLintSettings>): Promise<CommandOutput>
    Lint API descriptions: `redocly lint`.
  bundle(configure?: Configure<RedoclyBundleSettings>): Promise<CommandOutput>
    Bundle an API description into one file: `redocly bundle`.
  split(configure?: Configure<RedoclySplitSettings>): Promise<CommandOutput>
    Split an API description into a multi-file structure: `redocly split`.

type RedoclyLintFormat = "codeframe" | "stylish" | "json" | "checkstyle" | "markdown" | "summary"
  The output format of a `redocly lint` run (`--format`).
````

</details>

<!-- ZUKE:API:END -->

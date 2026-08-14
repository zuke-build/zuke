# @zuke/storybook

Typed [Storybook](https://storybook.js.org) CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `dev` and `build`.

```ts
import { StorybookTasks } from "jsr:@zuke/storybook";

await StorybookTasks.dev((s) => s.port(6006).noOpen().ci());
await StorybookTasks.build((s) =>
  s.outputDir("storybook-static").quietOutput()
);
```

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/storybook` — typed Storybook (https://storybook.js.org) CLI task
wrappers for Zuke builds.

Configure a fluent settings object in a lambda; the task builds the argv and
runs it.

```ts
import { StorybookTasks } from "jsr:@zuke/storybook";
await StorybookTasks.build((s) => s.outputDir("storybook-static"));
```
@module

const StorybookTasks: StorybookTasksApi
  Typed task functions for the `storybook` CLI.

class StorybookBuildSettings extends StorybookSettings
  Settings for `storybook build` (the static build).

  outputDir(path: PathLike): this
    Write the static build to this directory (`--output-dir`).
  quietOutput(): this
    Suppress the progress output, leaving warnings and errors (`--quiet`).

    Named `quietOutput` because `ToolSettings.quiet()` already means "do not
    stream the process output to the terminal", which is a different thing.
  override protected buildArgs(): string[]
    Assemble the `storybook build` argv.

class StorybookDevSettings extends StorybookSettings
  Settings for `storybook dev` (the development server).

  port(value: number): this
    Serve on a specific port (`--port`).
  host(value: string): this
    Bind to a host/IP (`--host`).
  noOpen(): this
    Do not open the browser on start (`--no-open`).
  ci(): this
    Never prompt and never open a browser (`--ci`).

    A build step is not a terminal someone is watching: without this Storybook
    can stop on an interactive question and hang the run.
  override protected buildArgs(): string[]
    Assemble the `storybook dev` argv.

abstract class StorybookSettings extends ToolSettings
  Base for all `storybook` subcommand settings: the binary is `storybook`,
  with the `--config-dir` option every subcommand accepts.

  override protected defaultTool(): string
    The default binary this wrapper invokes: `storybook`.
  override protected defaultResolution(): ToolResolution
    Resolve the binary from `node_modules/.bin` by default — Storybook is an npm-distributed tool.
  configDir(path: PathLike): this
    Read the configuration from this directory instead of `.storybook` (`--config-dir`).
  protected baseArgs(): string[]
    The shared option arguments.

interface StorybookTasksApi
  The shape of {@link StorybookTasks}.

  dev(configure?: Configure<StorybookDevSettings>): Promise<CommandOutput>
    Start the development server: `storybook dev`.
  build(configure?: Configure<StorybookBuildSettings>): Promise<CommandOutput>
    Build the static Storybook: `storybook build`.
````

</details>

<!-- ZUKE:API:END -->

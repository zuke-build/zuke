# @zuke/gcloud

Typed [`gcloud`](https://cloud.google.com/sdk/gcloud) (Google Cloud SDK) task
wrapper for [Zuke](https://github.com/zuke-build/zuke#readme) builds, in a
fluent settings-lambda API. `gcloud` is vast, so this is a flexible command
builder: name the command with `.command(...)`, set the common global flags
fluently, and pass anything else with `.flag(...)`. Arguments stay a discrete
argv array, so command construction is injection-free.

```ts
import { GcloudTasks } from "jsr:@zuke/gcloud";

await GcloudTasks.run((s) =>
  s.command("run", "deploy", "api")
    .project("my-project")
    .flag("region", "us-central1")
    .flag("source", ".")
    .noPrompt()
);

await GcloudTasks.run((s) => s.command("auth", "list").format("json"));
```

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/gcloud` — a typed `gcloud` (Google Cloud SDK) task wrapper for Zuke
builds.

A flexible command builder: name the command with `.command(...)`, set common
global flags fluently, and pass anything else with `.flag(...)`.

```ts
import { GcloudTasks } from "jsr:@zuke/gcloud";
await GcloudTasks.run((s) => s.command("auth", "list").format("json"));
```
@module

const GcloudTasks: GcloudTasksApi
  Typed task functions for the `gcloud` CLI.

class GcloudSettings extends ToolSettings
  Settings for a `gcloud` invocation.

  override protected defaultTool(): string
  command(...parts: Array<string | number>): this
    The command path and verb, e.g. `command("run", "deploy", "api")`.
  project(id: string): this
    Target Google Cloud project (`--project`).
  account(email: string): this
    Account to run as (`--account`).
  configuration(name: string): this
    Named gcloud configuration to use (`--configuration`).
  format(value: string): this
    Output format, e.g. `json`, `yaml`, `value(name)` (`--format`).
  verbosity(level: string): this
    Logging verbosity: `debug`, `info`, `warning`, `error`, … (`--verbosity`).
  noPrompt(): this
    Disable interactive prompts, accepting defaults (gcloud's `--quiet`). Named
    `noPrompt` to avoid clashing with the base `.quiet()`, which suppresses
    Zuke's own output streaming.
  flag(name: string, value?: string | number): this
    Add an arbitrary flag. With a value it renders `--name value`; without one
    it renders the bare `--name`. Repeatable.
  override protected buildArgs(): string[]

interface GcloudTasksApi
  The shape of {@link GcloudTasks}.

  run(configure?: Configure<GcloudSettings>): Promise<CommandOutput>
    Run a `gcloud` command.
````

</details>

<!-- ZUKE:API:END -->

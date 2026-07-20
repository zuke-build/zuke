# @zuke/gemini

Typed [Gemini CLI](https://github.com/google-gemini/gemini-cli) (`gemini`) task
wrapper for [Zuke](https://github.com/zuke-build/zuke#readme) builds, in a
fluent settings-lambda API. The flagship task is `run` — a non-interactive
(`--prompt`) invocation for builds and CI — alongside `mcp`/`extensions` command
builders. Arguments stay a discrete argv array, so command construction is
injection-free.

```ts
import { GeminiTasks } from "jsr:@zuke/gemini";

// Headless prompt: capture a structured response.
const out = await GeminiTasks.run((s) =>
  s.prompt("Summarise the staged diff in one line")
    .model("gemini-2.5-pro")
    .outputFormat("json")
    .allowedTools("read_file")
);
console.log(out.stdout);

// Manage MCP servers and extensions with flexible command builders.
await GeminiTasks.mcp((s) => s.command("add", "fs").flag("transport", "stdio"));
await GeminiTasks.extensions((s) => s.command("list"));
```

Authenticate through the shared `.env(...)` chainer (e.g. `GEMINI_API_KEY`),
backed by a `parameter().secret()` build input so Zuke masks it in CI output:

```ts
await GeminiTasks.run((s) =>
  s.prompt("Review the diff").env({ GEMINI_API_KEY: this.apiKey.value })
);
```

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/gemini` — a typed Gemini CLI (https://github.com/google-gemini/gemini-cli)
(`gemini`) task wrapper for Zuke builds.

Drive a prompt non-interactively with `run` and manage MCP servers and
extensions with the `mcp`/`extensions` builders — all in the settings-lambda
style shared by every Zuke tool wrapper.

```ts
import { GeminiTasks } from "jsr:@zuke/gemini";

await GeminiTasks.run((s) =>
  s.prompt("Draft a release note for the staged diff").model("gemini-2.5-pro")
);
```
@module

const GeminiTasks: GeminiTasksApi
  Typed task functions for the Gemini CLI.

abstract class GeminiCommandSettings extends ToolSettings
  Shared builder for `gemini <group> …` subcommand groups (`mcp`,
  `extensions`): name the verb and operands with `.command(...)` and pass
  anything else with `.flag(...)`.

  override protected defaultTool(): string
    The underlying executable — `gemini`.
  abstract protected group(): string
    The leading subcommand group token, e.g. `"mcp"`.
  command(...parts: Array<string | number>): this
    The verb and operands, e.g. `command("add", "my-server")`.
  flag(name: string, value?: string | number): this
    Add an arbitrary flag. With a value it renders `--name value`; without one
    it renders the bare `--name`. Repeatable.
  override protected buildArgs(): string[]
    Assemble the `gemini <group> …` argv.

class GeminiExtensionsSettings extends GeminiCommandSettings
  Settings for a `gemini extensions …` invocation (manage extensions).

  override protected group(): string
    The subcommand group token — `extensions`.

class GeminiMcpSettings extends GeminiCommandSettings
  Settings for a `gemini mcp …` invocation (manage MCP servers).

  override protected group(): string
    The subcommand group token — `mcp`.

class GeminiRunSettings extends ToolSettings
  Settings for a non-interactive `gemini --prompt` run — the build-friendly
  way to send a single prompt and capture the response.

  override protected defaultTool(): string
    The underlying executable — `gemini`.
  prompt(text: string): this
    The prompt to run non-interactively (`--prompt`). Required.
  model(id: string): this
    Pin the model, e.g. `model("gemini-2.5-pro")` (`--model`).
  sandbox(): this
    Run tools inside a sandbox (`--sandbox`).
  sandboxImage(image: string): this
    Container image to use for the sandbox (`--sandbox-image`).
  allFiles(): this
    Include all files in the context (`--all-files`).
  yolo(): this
    Automatically approve all tool calls (`--yolo`).
  approvalMode(mode: GeminiApprovalMode): this
    How tool calls are approved (`--approval-mode`).
  includeDirectories(...dirs: string[]): this
    Add directories to the workspace context (`--include-directories`). Repeatable.
  extensions(...names: string[]): this
    Restrict to these extensions (`--extensions`). Repeatable.
  allowedTools(...names: string[]): this
    Allow only these tools (`--allowed-tools`). Repeatable.
  allowedMcpServerNames(...names: string[]): this
    Allow only these MCP servers (`--allowed-mcp-server-names`). Repeatable.
  outputFormat(format: GeminiOutputFormat): this
    Shape of the printed response (`--output-format`).
  debug(): this
    Emit debug output (`--debug`).
  checkpointing(): this
    Enable checkpointing of file edits (`--checkpointing`).
  showMemoryUsage(): this
    Report memory usage in the status bar (`--show-memory-usage`).
  override protected buildArgs(): string[]
    Assemble the `gemini --prompt` argv.

interface GeminiTasksApi
  The shape of {@link GeminiTasks}.

  run(configure?: Configure<GeminiRunSettings>): Promise<CommandOutput>
    Run a prompt non-interactively (`gemini --prompt`).
  mcp(configure?: Configure<GeminiMcpSettings>): Promise<CommandOutput>
    Manage MCP servers (`gemini mcp …`).
  extensions(configure?: Configure<GeminiExtensionsSettings>): Promise<CommandOutput>
    Manage extensions (`gemini extensions …`).

type GeminiApprovalMode = "default" | "auto_edit" | "yolo" | "plan"
  Approval mode for tool calls (`--approval-mode`).

type GeminiOutputFormat = "text" | "json" | "stream-json"
  Output format for a non-interactive run (`--output-format`).
````

</details>

<!-- ZUKE:API:END -->

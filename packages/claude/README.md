# @zuke/claude

Typed [Claude Code](https://docs.claude.com/en/docs/claude-code) CLI (`claude`)
task wrapper for [Zuke](https://github.com/zuke-build/zuke#readme) builds, in a
fluent settings-lambda API. The flagship task is `run` — a non-interactive
(`--print`) invocation for builds and CI — alongside `mcp`/`config` command
builders and `update`. Arguments stay a discrete argv array, so command
construction is injection-free.

```ts
import { ClaudeTasks } from "jsr:@zuke/claude";

// Headless prompt: capture a structured response.
const out = await ClaudeTasks.run((s) =>
  s.prompt("Summarise the staged diff in one line")
    .model("sonnet")
    .outputFormat("json")
    .allowedTools("Read", "Grep")
);
console.log(out.stdout);

// Manage MCP servers and config with flexible command builders.
await ClaudeTasks.mcp((s) => s.command("add", "fs").flag("transport", "stdio"));
await ClaudeTasks.config((s) => s.command("set", "-g", "theme", "dark"));

// Keep the CLI current in CI provisioning.
await ClaudeTasks.update();
```

Pass the API key (or any secret) through the shared `.env(...)` chainer, backed
by a `parameter().secret()` build input so Zuke masks it in CI output:

```ts
await ClaudeTasks.run((s) =>
  s.prompt("Review the diff").env({ ANTHROPIC_API_KEY: this.apiKey.value })
);
```

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/claude` — a typed Claude Code (https://docs.claude.com/en/docs/claude-code)
CLI (`claude`) task wrapper for Zuke builds.

Drive a prompt non-interactively with `run`, manage MCP servers and config
with the `mcp`/`config` builders, and self-update with `update` — all in the
settings-lambda style shared by every Zuke tool wrapper.

```ts
import { ClaudeTasks } from "jsr:@zuke/claude";

await ClaudeTasks.run((s) =>
  s.prompt("Draft a release note for the staged diff").model("sonnet")
);
```
@module

const ClaudeTasks: ClaudeTasksApi
  Typed task functions for the Claude Code CLI.

class ClaudeConfigSettings extends ClaudeCommandSettings
  Settings for a `claude config …` invocation (manage configuration).

  override protected group(): string

class ClaudeMcpSettings extends ClaudeCommandSettings
  Settings for a `claude mcp …` invocation (manage MCP servers).

  override protected group(): string

class ClaudeRunSettings extends ToolSettings
  Settings for a non-interactive `claude --print` run — the build-friendly
  way to send a single prompt and capture the response.

  override protected defaultTool(): string
  prompt(text: string): this
    The prompt to run non-interactively. Required.
  model(id: string): this
    Pin the model by name or alias, e.g. `model("sonnet")` (`--model`).
  fallbackModel(id: string): this
    Model to fall back to when the primary is overloaded (`--fallback-model`).
  outputFormat(format: ClaudeOutputFormat): this
    Shape of the printed response (`--output-format`).
  inputFormat(format: ClaudeInputFormat): this
    Shape of the supplied input (`--input-format`).
  allowedTools(...tools: string[]): this
    Allow only these tools, comma-joined into `--allowedTools`. Repeatable.
  disallowedTools(...tools: string[]): this
    Deny these tools, comma-joined into `--disallowedTools`. Repeatable.
  addDir(...dirs: string[]): this
    Grant the session access to extra directories (`--add-dir`). Repeatable.
  permissionMode(mode: ClaudePermissionMode): this
    How tool permissions are handled for the run (`--permission-mode`).
  dangerouslySkipPermissions(): this
    Bypass all permission prompts (`--dangerously-skip-permissions`).
  appendSystemPrompt(text: string): this
    Append text to the system prompt (`--append-system-prompt`).
  maxTurns(turns: number): this
    Cap the number of agentic turns (`--max-turns`).
  mcpConfig(pathOrJson: string): this
    MCP server configuration, as a file path or inline JSON (`--mcp-config`).
  settings(pathOrJson: string): this
    Settings, as a file path or inline JSON (`--settings`).
  sessionId(id: string): this
    Run under a specific session id (`--session-id`).
  continueSession(): this
    Continue the most recent conversation (`--continue`).
  resume(sessionId?: string): this
    Resume a conversation, optionally by session id (`--resume`).
  verbose(): this
    Emit verbose logging (`--verbose`).
  override protected buildArgs(): string[]

class ClaudeUpdateSettings extends ToolSettings
  Settings for `claude update` (self-update the CLI).

  override protected defaultTool(): string
  override protected buildArgs(): string[]

interface ClaudeTasksApi
  The shape of {@link ClaudeTasks}.

  run(configure?: Configure<ClaudeRunSettings>): Promise<CommandOutput>
    Run a prompt non-interactively (`claude --print`).
  mcp(configure?: Configure<ClaudeMcpSettings>): Promise<CommandOutput>
    Manage MCP servers (`claude mcp …`).
  config(configure?: Configure<ClaudeConfigSettings>): Promise<CommandOutput>
    Manage configuration (`claude config …`).
  update(configure?: Configure<ClaudeUpdateSettings>): Promise<CommandOutput>
    Self-update the CLI (`claude update`).

type ClaudeInputFormat = "text" | "stream-json"
  Input format for a headless `claude --print` run (`--input-format`).

type ClaudeOutputFormat = "text" | "json" | "stream-json"
  Output format for a headless `claude --print` run (`--output-format`).

type ClaudePermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan"
  Permission mode for a run (`--permission-mode`).
````

</details>

<!-- ZUKE:API:END -->

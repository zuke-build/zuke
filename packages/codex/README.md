# @zuke/codex

Typed [OpenAI Codex](https://developers.openai.com/codex/cli) CLI (`codex`) task
wrapper for [Zuke](https://github.com/zuke-build/zuke#readme) builds, in a
fluent settings-lambda API. The flagship task is `exec` — a non-interactive
(`codex exec`) invocation for builds and CI — alongside an `mcp` command
builder. Arguments stay a discrete argv array, so command construction is
injection-free.

```ts
import { CodexTasks } from "jsr:@zuke/codex";

// Headless prompt: capture machine-readable output.
const out = await CodexTasks.exec((s) =>
  s.prompt("Summarise the staged diff in one line")
    .model("gpt-5-codex")
    .sandbox("read-only")
    .json()
    .outputLastMessage("last.txt")
);
console.log(out.stdout);

// Manage MCP servers with a flexible command builder.
await CodexTasks.mcp((s) => s.command("add", "fs").flag("yes"));
```

Authenticate through the shared `.env(...)` chainer (e.g. `OPENAI_API_KEY`),
backed by a `parameter().secret()` build input so Zuke masks it in CI output:

```ts
await CodexTasks.exec((s) =>
  s.prompt("Review the diff").env({ OPENAI_API_KEY: this.apiKey.value })
);
```

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/codex` — a typed OpenAI Codex (https://developers.openai.com/codex/cli)
CLI (`codex`) task wrapper for Zuke builds.

Drive a prompt non-interactively with `exec` and manage MCP servers with the
`mcp` builder — both in the settings-lambda style shared by every Zuke tool
wrapper.

```ts
import { CodexTasks } from "jsr:@zuke/codex";

await CodexTasks.exec((s) =>
  s.prompt("Draft a release note for the staged diff").sandbox("read-only")
);
```
@module

const CodexTasks: CodexTasksApi
  Typed task functions for the OpenAI Codex CLI.

class CodexExecSettings extends ToolSettings
  Settings for a non-interactive `codex exec` run — the build-friendly way to
  send a single prompt and capture the response.

  override protected defaultTool(): string
  prompt(text: string): this
    The prompt to run non-interactively. Omit to read from stdin.
  model(id: string): this
    Pin the model, e.g. `model("gpt-5-codex")` (`--model`).
  image(...paths: string[]): this
    Attach an image to the prompt (`--image`). Repeatable.
  config(key: string, value: string): this
    Override a config value as `key=value` (`--config`). Repeatable.
  sandbox(mode: CodexSandboxMode): this
    Sandbox policy for model-generated commands (`--sandbox`).
  cd(dir: string): this
    Run as if `codex` was started in this directory (`--cd`).
  askForApproval(policy: CodexApprovalPolicy): this
    Approval policy for the run (`--ask-for-approval`).
  fullAuto(): this
    Low-friction sandboxed automatic execution (`--full-auto`).
  dangerouslyBypassApprovalsAndSandbox(): this
    Skip all confirmation prompts and sandboxing (`--dangerously-bypass-approvals-and-sandbox`).
  skipGitRepoCheck(): this
    Allow running outside a Git repository (`--skip-git-repo-check`).
  json(): this
    Emit events as newline-delimited JSON (`--json`).
  outputLastMessage(file: string): this
    Write the agent's final message to a file (`--output-last-message`).
  outputSchema(file: string): this
    Constrain the final message to a JSON schema file (`--output-schema`).
  color(mode: CodexColor): this
    When to colourise output (`--color`).
  profile(name: string): this
    Use a named configuration profile (`--profile`).
  oss(): this
    Use a local open-source model provider (`--oss`).
  override protected buildArgs(): string[]

class CodexMcpSettings extends ToolSettings
  Settings for a `codex mcp …` invocation (manage MCP servers): name the verb
  and operands with `.command(...)` and pass anything else with `.flag(...)`.

  override protected defaultTool(): string
  command(...parts: Array<string | number>): this
    The verb and operands, e.g. `command("add", "my-server")`.
  flag(name: string, value?: string | number): this
    Add an arbitrary flag. With a value it renders `--name value`; without one
    it renders the bare `--name`. Repeatable.
  override protected buildArgs(): string[]

interface CodexTasksApi
  The shape of {@link CodexTasks}.

  exec(configure?: Configure<CodexExecSettings>): Promise<CommandOutput>
    Run a prompt non-interactively (`codex exec`).
  mcp(configure?: Configure<CodexMcpSettings>): Promise<CommandOutput>
    Manage MCP servers (`codex mcp …`).

type CodexApprovalPolicy = "untrusted" | "on-failure" | "on-request" | "never"
  Approval policy for a run (`--ask-for-approval`).

type CodexColor = "always" | "never" | "auto"
  When to colourise output (`--color`).

type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access"
  Sandbox policy for model-generated commands (`--sandbox`).
````

</details>

<!-- ZUKE:API:END -->

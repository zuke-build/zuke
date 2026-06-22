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

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

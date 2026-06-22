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

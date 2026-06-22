/**
 * `@zuke/codex` — a typed [OpenAI Codex](https://developers.openai.com/codex/cli)
 * CLI (`codex`) task wrapper for Zuke builds.
 *
 * Drive a prompt non-interactively with `exec` and manage MCP servers with the
 * `mcp` builder — both in the settings-lambda style shared by every Zuke tool
 * wrapper.
 *
 * ```ts
 * import { CodexTasks } from "jsr:@zuke/codex";
 *
 * await CodexTasks.exec((s) =>
 *   s.prompt("Draft a release note for the staged diff").sandbox("read-only")
 * );
 * ```
 *
 * @module
 */

export * from "./src/codex.ts";

/**
 * `@zuke/claude` — a typed [Claude Code](https://docs.claude.com/en/docs/claude-code)
 * CLI (`claude`) task wrapper for Zuke builds.
 *
 * Drive a prompt non-interactively with `run`, manage MCP servers and config
 * with the `mcp`/`config` builders, and self-update with `update` — all in the
 * settings-lambda style shared by every Zuke tool wrapper.
 *
 * ```ts
 * import { ClaudeTasks } from "jsr:@zuke/claude";
 *
 * await ClaudeTasks.run((s) =>
 *   s.prompt("Draft a release note for the staged diff").model("sonnet")
 * );
 * ```
 *
 * @module
 */

export * from "./src/claude.ts";

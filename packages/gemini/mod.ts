/**
 * `@zuke/gemini` — a typed [Gemini CLI](https://github.com/google-gemini/gemini-cli)
 * (`gemini`) task wrapper for Zuke builds.
 *
 * Drive a prompt non-interactively with `run` and manage MCP servers and
 * extensions with the `mcp`/`extensions` builders — all in the settings-lambda
 * style shared by every Zuke tool wrapper.
 *
 * ```ts
 * import { GeminiTasks } from "jsr:@zuke/gemini";
 *
 * await GeminiTasks.run((s) =>
 *   s.prompt("Draft a release note for the staged diff").model("gemini-2.5-pro")
 * );
 * ```
 *
 * @module
 */

export * from "./src/gemini.ts";

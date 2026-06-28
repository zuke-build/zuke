/**
 * `@zuke/node` — typed Node.js task wrappers for Zuke builds.
 *
 * Configure a fluent settings object in a lambda; the task builds the argv and
 * runs it. The task names mirror common `node` invocations: `run` executes a
 * script, `eval` evaluates inline code, and `test` runs the built-in test
 * runner.
 *
 * ```ts
 * import { NodeTasks } from "jsr:@zuke/node";
 * await NodeTasks.run((s) => s.script("server.js").enableSourceMaps());
 * ```
 *
 * @module
 */

export * from "./src/node.ts";

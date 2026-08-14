// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/node` — typed Node.js task wrappers for Zuke builds.
 *
 * Configure a fluent settings object in a lambda; the task builds the argv and
 * runs it. The task names mirror common `node` invocations: `run` executes a
 * script, `eval` evaluates inline code, and `test` runs the built-in test
 * runner. `evaluate` is the exception — it imports a module and resolves to one
 * of its exports' JSON value, so a target can read something out of the Node
 * side of a project instead of shelling out to a script.
 *
 * ```ts
 * import { NodeTasks } from "jsr:@zuke/node";
 * await NodeTasks.run((s) => s.script("server.js").enableSourceMaps());
 * const spec = await NodeTasks.evaluate("tools/openapi.mjs");
 * ```
 *
 * @module
 */

export * from "./src/settings.ts";
export * from "./src/node.ts";
export { NodeEvaluateSettings } from "./src/evaluate.ts";

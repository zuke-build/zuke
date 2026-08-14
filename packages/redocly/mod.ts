// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/redocly` — typed [Redocly CLI](https://redocly.com/docs/cli) task
 * wrappers for Zuke builds.
 *
 * Configure a fluent settings object in a lambda; the task builds the argv and
 * runs it.
 *
 * ```ts
 * import { RedoclyTasks } from "jsr:@zuke/redocly";
 * await RedoclyTasks.lint((s) => s.paths("openapi.yaml").format("summary"));
 * ```
 *
 * @module
 */

export * from "./src/redocly.ts";

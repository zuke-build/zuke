// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/jest` — typed `jest` task wrappers for Zuke builds.
 *
 * Configure a fluent settings object in a lambda; the task builds the argv and
 * runs it.
 *
 * ```ts
 * import { JestTasks } from "jsr:@zuke/jest";
 * await JestTasks.run((s) => s.ci().coverage().maxWorkers(2));
 * ```
 *
 * @module
 */

export * from "./src/jest.ts";

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/lint-staged` — typed `lint-staged` task wrappers for Zuke builds.
 *
 * Configure a fluent settings object in a lambda; the task builds the argv and
 * runs it.
 *
 * ```ts
 * import { LintStagedTasks } from "jsr:@zuke/lint-staged";
 * await LintStagedTasks.run((s) => s.config(".lintstagedrc.json").relative());
 * ```
 *
 * @module
 */

export * from "./src/lint_staged.ts";

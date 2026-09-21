// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/cspell` — typed `cspell` task wrappers for Zuke builds.
 *
 * Configure a fluent settings object in a lambda; the task builds the argv and
 * runs it.
 *
 * ```ts
 * import { CspellTasks } from "@zuke/cspell";
 * await CspellTasks.lint((s) => s.files("**").noProgress().showSuggestions());
 * ```
 *
 * @module
 */

export * from "./src/cspell.ts";

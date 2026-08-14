// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/storybook` — typed [Storybook](https://storybook.js.org) CLI task
 * wrappers for Zuke builds.
 *
 * Configure a fluent settings object in a lambda; the task builds the argv and
 * runs it.
 *
 * ```ts
 * import { StorybookTasks } from "jsr:@zuke/storybook";
 * await StorybookTasks.build((s) => s.outputDir("storybook-static"));
 * ```
 *
 * @module
 */

export * from "./src/storybook.ts";

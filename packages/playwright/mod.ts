// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/playwright` — typed `PlaywrightTasks` wrappers for the Playwright CLI,
 * for use in Zuke build targets (end-to-end browser testing).
 *
 * ```ts
 * import { PlaywrightTasks } from "@zuke/playwright";
 *
 * await PlaywrightTasks.install((s) => s.withDeps());
 * await PlaywrightTasks.test((s) => s.project("chromium").grep("@smoke"));
 * ```
 *
 * @module
 */

export {
  PlaywrightCodegenSettings,
  PlaywrightInstallSettings,
  PlaywrightSettings,
  PlaywrightShowReportSettings,
  PlaywrightTasks,
  type PlaywrightTasksApi,
  PlaywrightTestSettings,
} from "./src/playwright.ts";

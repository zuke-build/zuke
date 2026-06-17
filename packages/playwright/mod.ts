/**
 * `@zuke/playwright` — typed `PlaywrightTasks` wrappers for the Playwright CLI,
 * for use in Zuke build targets (end-to-end browser testing).
 *
 * ```ts
 * import { PlaywrightTasks } from "jsr:@zuke/playwright";
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
  PlaywrightShowReportSettings,
  PlaywrightTasks,
  type PlaywrightTasksApi,
  PlaywrightTestSettings,
} from "./src/playwright.ts";

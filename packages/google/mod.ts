// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/google` — Google Play publishing for Zuke builds, through the Google
 * Play Developer API. The counterpart of `@zuke/apple`'s `TestFlightTasks`.
 *
 * ```ts
 * import { GooglePlayTasks } from "@zuke/google";
 *
 * await GooglePlayTasks.upload((s) =>
 *   s.serviceAccount(keyJson)
 *     .packageName("com.example.app")
 *     .bundle("build/app/outputs/bundle/release/app-release.aab")
 *     .track("internal")
 *     .releaseNotes("What changed.", "en-US")
 * );
 * ```
 *
 * @module
 */

export { GooglePlayError } from "./src/errors.ts";
export {
  GooglePlayTasks,
  type GooglePlayTasksApi,
  type GooglePlayUpload,
} from "./src/google_play.ts";
export {
  GOOGLE_PLAY_API_URL,
  type GooglePlayReleaseStatus,
  GooglePlaySettings,
} from "./src/google_play_settings.ts";

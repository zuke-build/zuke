// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `GooglePlayTasks` — upload an Android app bundle to a Google Play track
 * through the Google Play Developer API.
 *
 * ```ts
 * import { GooglePlayTasks } from "@zuke/google";
 *
 * await GooglePlayTasks.upload((s) =>
 *   s.serviceAccount(keyJson)
 *     .packageName("com.example.app")
 *     .bundle("build/app/outputs/bundle/release/app-release.aab")
 *     .track("internal").status("completed")
 *     .releaseNotes("What changed.", "en-US")
 *     .timeout("15m")
 * );
 * ```
 *
 * `upload` signs in as the service account, opens an edit, uploads the bundle
 * and reads back its version code, sets the track's release to that version
 * code with the status and release notes, then commits the edit — or deletes
 * it when a step fails, so no half-made edit is left behind.
 *
 * @module
 */

import { assertSecureBackendUrl } from "@zuke/core";
import type { Configure } from "@zuke/core/tooling";
import { GooglePlayError } from "./errors.ts";
import { GooglePlayClient } from "./google_play_client.ts";
import {
  type GooglePlayReleaseStatus,
  GooglePlaySettings,
} from "./google_play_settings.ts";
import { numberAt, stringAt } from "./json.ts";
import { serviceAccountToken } from "./service_account.ts";

/** What `GooglePlayTasks.upload` released. */
export interface GooglePlayUpload {
  /** The app's package name. */
  readonly packageName: string;
  /** The uploaded bundle's version code, as Google Play read it. */
  readonly versionCode: number;
  /** The track the release went to. */
  readonly track: string;
  /** The release's status. */
  readonly status: GooglePlayReleaseStatus;
}

/** Upload and release the bundle `settings` names; see the module docs. */
async function upload(settings: GooglePlaySettings): Promise<GooglePlayUpload> {
  const { serviceAccount_, packageName_, bundle_, track_, status_ } = settings;
  if (
    serviceAccount_ === undefined || packageName_ === undefined ||
    bundle_ === undefined
  ) {
    throw new Error(
      "GooglePlayTasks.upload: .serviceAccount(), .packageName() and " +
        ".bundle() are required.",
    );
  }
  assertSecureBackendUrl(
    settings.apiUrl_,
    "Google Play apiUrl",
    settings.readEnv_,
  );
  const bytes = await Deno.readFile(bundle_);
  const controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(
        new GooglePlayError(
          `Google Play: uploading ${bundle_} took longer than ${
            Math.round(settings.timeout_ / 1000)
          }s; raise .timeout().`,
        ),
      ),
    settings.timeout_,
  );
  try {
    const token = await serviceAccountToken(
      serviceAccount_,
      settings,
      controller.signal,
    );
    const client = new GooglePlayClient(settings, token, controller.signal);
    const edits = `/androidpublisher/v3/applications/${
      encodeURIComponent(packageName_)
    }/edits`;
    const editId = stringAt(await client.request("POST", edits), "id");
    if (editId === undefined) {
      throw new GooglePlayError(
        "Google Play: the API opened an edit without an id.",
      );
    }
    const edit = `${edits}/${encodeURIComponent(editId)}`;
    try {
      const uploaded = await client.request(
        "POST",
        `/upload${edit}/bundles?uploadType=media`,
        bytes,
      );
      const versionCode = numberAt(uploaded, "versionCode");
      if (versionCode === undefined) {
        throw new GooglePlayError(
          `Google Play: the API accepted ${bundle_} without a versionCode.`,
        );
      }
      settings.log_(
        `Google Play: uploaded ${bundle_} as version code ${versionCode}`,
      );
      const notes = [...settings.releaseNotes_].map(([language, text]) => ({
        language,
        text,
      }));
      await client.request(
        "PUT",
        `${edit}/tracks/${encodeURIComponent(track_)}`,
        {
          track: track_,
          releases: [{
            versionCodes: [String(versionCode)],
            status: status_,
            ...(notes.length === 0 ? {} : { releaseNotes: notes }),
          }],
        },
      );
      await client.request(
        "POST",
        `${edit}:commit` +
          (settings.changesNotSentForReview_
            ? "?changesNotSentForReview=true"
            : ""),
      );
      settings.log_(
        `Google Play: released version code ${versionCode} of ${packageName_} ` +
          `to ${track_} (${status_})`,
      );
      return {
        packageName: packageName_,
        versionCode,
        track: track_,
        status: status_,
      };
    } catch (error) {
      // Without the timed-out signal, so the cleanup can still reach Google.
      await new GooglePlayClient(settings, token).request("DELETE", edit)
        .catch(() => undefined);
      throw error;
    }
  } finally {
    clearTimeout(timer);
  }
}

/** The shape of {@link GooglePlayTasks}. */
export interface GooglePlayTasksApi {
  /**
   * Upload an app bundle and release it on a track, in one committed edit.
   *
   * @throws {GooglePlayError} when the service account cannot sign in, the
   *   API refuses a step, or the upload runs out of time.
   */
  upload(configure: Configure<GooglePlaySettings>): Promise<GooglePlayUpload>;
}

/** Publish to Google Play through the Google Play Developer API. */
export const GooglePlayTasks: GooglePlayTasksApi = {
  upload: (configure) => upload(configure(new GooglePlaySettings())),
};

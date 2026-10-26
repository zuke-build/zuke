// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `TestFlightTasks` — distribute an uploaded build in TestFlight through the
 * App Store Connect API.
 *
 * ```ts
 * import { TestFlightTasks } from "@zuke/apple";
 *
 * await TestFlightTasks.distribute((s) =>
 *   s.issuerId(issuer).keyId("ABC123").privateKey(p8)
 *     .bundleId("com.example.app").buildNumber(buildNumber)
 *     .usesNonExemptEncryption(false)
 *     .whatToTest("Checkout redesign.").group("QA").submitForBetaReview()
 * );
 * ```
 *
 * After an upload — `XcodebuildTasks.exportArchive` with an
 * `ExportOptions.plist` whose `destination` is `upload`, or
 * `AltoolTasks.uploadApp` — App Store Connect processes the build for some
 * minutes. `distribute` finds the app, waits for that build to be processed,
 * then answers export compliance, sets the "What to Test" notes, adds the
 * build to beta groups and submits it for beta review, each only when asked.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import {
  AppStoreConnectClient,
  type JsonObject,
  type Resource,
  resources,
  stringAt,
} from "./app_store_connect_client.ts";
import { TestFlightError } from "./errors.ts";
import { TestFlightSettings } from "./testflight_settings.ts";

/** A build in App Store Connect, once processed. */
export interface TestFlightBuild {
  /** The build's App Store Connect id. */
  readonly id: string;
  /** The app's App Store Connect id. */
  readonly appId: string;
  /** The build number, `CFBundleVersion`. */
  readonly buildNumber: string;
  /** The processing state: `VALID` once `distribute` returns. */
  readonly processingState: string;
}

/** A query string from `params`, leaving out the unset ones. */
function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, value);
  }
  return search.toString();
}

/** A JSON:API resource identifier. */
function ref(type: string, id: string): JsonObject {
  return { type, id };
}

/** The app with `bundleId`, or a {@link TestFlightError}. */
async function findApp(
  client: AppStoreConnectClient,
  bundleId: string,
): Promise<string> {
  const apps = resources(
    await client.request(
      "GET",
      `/v1/apps?${query({ "filter[bundleId]": bundleId, limit: "200" })}`,
    ),
  );
  // filter[bundleId] also matches longer ids that start with it.
  const app = apps.find((a) => stringAt(a.attributes, "bundleId") === bundleId);
  if (app === undefined) {
    throw new TestFlightError(
      `TestFlight: no app in App Store Connect has the bundle id ${bundleId}.`,
    );
  }
  return app.id;
}

/** Wait for the build to finish processing; return it when `VALID`. */
async function waitForBuild(
  client: AppStoreConnectClient,
  settings: TestFlightSettings,
  appId: string,
  buildNumber: string,
): Promise<Resource> {
  const path = `/v1/builds?${
    query({
      "filter[app]": appId,
      "filter[version]": buildNumber,
      "filter[preReleaseVersion.version]": settings.version_,
      "filter[preReleaseVersion.platform]": settings.platform_,
      sort: "-uploadedDate",
      limit: "1",
    })
  }`;
  const name = `build ${buildNumber} of ${settings.bundleId_}`;
  const deadline = settings.now_() + settings.timeout_;
  let reported: string | undefined;
  for (;;) {
    const build = resources(await client.request("GET", path))[0];
    const state = build === undefined
      ? "not uploaded yet"
      : stringAt(build.attributes, "processingState") ?? "unknown";
    if (state !== reported) {
      settings.log_(`TestFlight: ${name} is ${state}`);
      reported = state;
    }
    if (build !== undefined && state === "VALID") return build;
    if (state === "INVALID" || state === "FAILED") {
      throw new TestFlightError(
        `TestFlight: App Store Connect could not process ${name}: ${state}. ` +
          `Its email to the account holder says why.`,
      );
    }
    const remaining = deadline - settings.now_();
    if (remaining <= 0) {
      throw new TestFlightError(
        `TestFlight: ${name} was still ${state} after ` +
          `${Math.round(settings.timeout_ / 1000)}s; raise .timeout().`,
      );
    }
    await settings.sleep_(Math.min(settings.pollInterval_, remaining));
  }
}

/** Set the "What to Test" notes, updating a locale that already has some. */
async function setWhatToTest(
  client: AppStoreConnectClient,
  buildId: string,
  notes: ReadonlyMap<string, string>,
): Promise<void> {
  const existing = resources(
    await client.request("GET", `/v1/builds/${buildId}/betaBuildLocalizations`),
  );
  for (const [locale, whatsNew] of notes) {
    const current = existing.find((l) =>
      stringAt(l.attributes, "locale") === locale
    );
    if (current === undefined) {
      await client.request("POST", "/v1/betaBuildLocalizations", {
        data: {
          type: "betaBuildLocalizations",
          attributes: { locale, whatsNew },
          relationships: { build: { data: ref("builds", buildId) } },
        },
      });
    } else {
      await client.request(
        "PATCH",
        `/v1/betaBuildLocalizations/${current.id}`,
        {
          data: {
            ...ref("betaBuildLocalizations", current.id),
            attributes: { whatsNew },
          },
        },
      );
    }
  }
}

/** Add the build to the named beta groups, or a {@link TestFlightError}. */
async function addToGroups(
  client: AppStoreConnectClient,
  appId: string,
  buildId: string,
  names: readonly string[],
): Promise<void> {
  const groups = resources(
    await client.request(
      "GET",
      `/v1/betaGroups?${query({ "filter[app]": appId, limit: "200" })}`,
    ),
  );
  const ids = names.map((name) => {
    const group = groups.find((g) => stringAt(g.attributes, "name") === name);
    if (group === undefined) {
      const known = groups.map((g) => stringAt(g.attributes, "name"))
        .filter((n) => n !== undefined);
      throw new TestFlightError(
        `TestFlight: the app has no beta group named "${name}"` +
          (known.length === 0 ? "." : ` — it has: ${known.join(", ")}.`),
      );
    }
    return group.id;
  });
  await client.request(
    "POST",
    `/v1/builds/${buildId}/relationships/betaGroups`,
    {
      data: ids.map((id) => ref("betaGroups", id)),
    },
  );
}

/** Distribute the build `settings` names; see the module docs. */
async function distribute(
  settings: TestFlightSettings,
): Promise<TestFlightBuild> {
  const { bundleId_, buildNumber_ } = settings;
  if (bundleId_ === undefined || buildNumber_ === undefined) {
    throw new Error(
      "TestFlightTasks.distribute: .bundleId() and .buildNumber() are required.",
    );
  }
  const client = new AppStoreConnectClient(settings);
  const appId = await findApp(client, bundleId_);
  const build = await waitForBuild(client, settings, appId, buildNumber_);
  const answered = build.attributes.usesNonExemptEncryption;
  if (typeof answered === "boolean") {
    // Info.plist's ITSAppUsesNonExemptEncryption answered it already, and
    // App Store Connect refuses to change the answer.
    settings.log_(
      `TestFlight: export compliance already answered by the build ` +
        `(usesNonExemptEncryption: ${answered})`,
    );
  } else if (settings.usesNonExemptEncryption_ !== undefined) {
    await client.request("PATCH", `/v1/builds/${build.id}`, {
      data: {
        ...ref("builds", build.id),
        attributes: {
          usesNonExemptEncryption: settings.usesNonExemptEncryption_,
        },
      },
    });
  }
  if (settings.whatToTest_.size > 0) {
    await setWhatToTest(client, build.id, settings.whatToTest_);
  }
  if (settings.groups_.length > 0) {
    await addToGroups(client, appId, build.id, settings.groups_);
    settings.log_(
      `TestFlight: added build ${buildNumber_} to ${
        settings.groups_.join(", ")
      }`,
    );
  }
  if (settings.submitForBetaReview_) {
    await client.request("POST", "/v1/betaAppReviewSubmissions", {
      data: {
        type: "betaAppReviewSubmissions",
        relationships: { build: { data: ref("builds", build.id) } },
      },
    });
    settings.log_(
      `TestFlight: submitted build ${buildNumber_} for beta review`,
    );
  }
  return {
    id: build.id,
    appId,
    buildNumber: buildNumber_,
    processingState: "VALID",
  };
}

/** The shape of {@link TestFlightTasks}. */
export interface TestFlightTasksApi {
  /**
   * Wait for an uploaded build to be processed, then distribute it in
   * TestFlight as configured.
   *
   * @throws {TestFlightError} when the app or a beta group is missing, the
   *   build fails processing, or it is not processed in time.
   * @throws {AppStoreConnectError} when the API refuses a request.
   */
  distribute(
    configure: Configure<TestFlightSettings>,
  ): Promise<TestFlightBuild>;
}

/** Distribute builds in TestFlight through the App Store Connect API. */
export const TestFlightTasks: TestFlightTasksApi = {
  distribute: (configure) => distribute(configure(new TestFlightSettings())),
};

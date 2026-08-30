// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import { missingTool } from "@zuke/core/tooling/conformance";
import { GcloudTasks, RUN_SERVICE_URL_FORMAT } from "../mod.ts";
// Internal to the package: the public surface is the task-shaped
// GcloudTasks.accessToken/configValue/runServiceUrl, so this is imported from
// its module rather than re-exported by mod.ts.
import { readScalar } from "../src/scalar_output.ts";

Deno.test("the URL reader pins gcloud's own value projection", () => {
  // The reader promises a URL, so gcloud does the extraction and this package
  // never parses a JSON document it has no project to produce a sample of.
  assertEquals(RUN_SERVICE_URL_FORMAT, "value(status.url)");
});

Deno.test("readScalar returns the single line gcloud printed", () => {
  const ok = {
    stdout: "https://api-abc.a.run.app\n",
    truncated: false,
    maxCapturedBytes: 8388608,
  };
  assertEquals(
    readScalar(ok, "runServiceUrl", "service URL"),
    "https://api-abc.a.run.app",
  );
  // Surrounding whitespace is gcloud's line terminator, not part of the value.
  assertEquals(
    readScalar(
      { ...ok, stdout: "  ya29.token  \n\n" },
      "accessToken",
      "access token",
    ),
    "ya29.token",
  );
});

Deno.test("readScalar refuses an empty answer rather than returning one", () => {
  // An unset property and a field the resource does not carry both look like
  // this. Returning "" would let a build interpolate emptiness into a URL or an
  // Authorization header and only fail much later.
  const error = assertThrows(
    () =>
      readScalar(
        { stdout: "\n", truncated: false, maxCapturedBytes: 8388608 },
        "configValue",
        "configured value",
      ),
    Error,
  );
  assertEquals(error.message.includes("GcloudTasks.configValue"), true);
  assertEquals(error.message.includes("configured value"), true);
});

Deno.test("readScalar refuses a truncated capture", () => {
  // Capture keeps the newest bytes, so a truncated capture begins mid-value —
  // a token or URL cut at the front is worse than no answer.
  const error = assertThrows(
    () =>
      readScalar(
        { stdout: "token", truncated: true, maxCapturedBytes: 1024 },
        "accessToken",
        "access token",
      ),
    Error,
  );
  assertEquals(error.message.includes("1024"), true);
  assertEquals(error.message.includes("drops"), true);
});

/**
 * Every new task, with the minimum configuration its settings demand, pointed
 * at a binary that cannot exist. Each proves the task reaches execution — a
 * settings class that never runs would pass its argv test while being
 * unreachable through `GcloudTasks`.
 */
const REACH: Array<[string, () => Promise<unknown>]> = [
  [
    "authActivateServiceAccount",
    () =>
      GcloudTasks.authActivateServiceAccount((s) =>
        missingTool(s).keyFile("k.json")
      ),
  ],
  [
    "authPrintAccessToken",
    () => GcloudTasks.authPrintAccessToken((s) => missingTool(s)),
  ],
  ["accessToken", () => GcloudTasks.accessToken((s) => missingTool(s))],
  [
    "authPrintIdentityToken",
    () => GcloudTasks.authPrintIdentityToken((s) => missingTool(s)),
  ],
  ["identityToken", () => GcloudTasks.identityToken((s) => missingTool(s))],
  [
    "authConfigureDocker",
    () => GcloudTasks.authConfigureDocker((s) => missingTool(s)),
  ],
  ["authList", () => GcloudTasks.authList((s) => missingTool(s))],
  ["authRevoke", () => GcloudTasks.authRevoke((s) => missingTool(s).all())],
  [
    "configSet",
    () =>
      GcloudTasks.configSet((s) =>
        missingTool(s).property("project").value("p")
      ),
  ],
  [
    "configUnset",
    () => GcloudTasks.configUnset((s) => missingTool(s).property("project")),
  ],
  [
    "configGetValue",
    () => GcloudTasks.configGetValue((s) => missingTool(s).property("project")),
  ],
  [
    "configValue",
    () => GcloudTasks.configValue((s) => missingTool(s).property("project")),
  ],
  ["configList", () => GcloudTasks.configList((s) => missingTool(s))],
  ["buildsSubmit", () => GcloudTasks.buildsSubmit((s) => missingTool(s))],
  ["buildsList", () => GcloudTasks.buildsList((s) => missingTool(s))],
  [
    "buildsDescribe",
    () => GcloudTasks.buildsDescribe((s) => missingTool(s).build("b1")),
  ],
  ["buildsLog", () => GcloudTasks.buildsLog((s) => missingTool(s).build("b1"))],
  [
    "runDeploy",
    () => GcloudTasks.runDeploy((s) => missingTool(s).service("api")),
  ],
  [
    "runServicesDescribe",
    () => GcloudTasks.runServicesDescribe((s) => missingTool(s).service("api")),
  ],
  [
    "runServiceUrl",
    () => GcloudTasks.runServiceUrl((s) => missingTool(s).service("api")),
  ],
  ["runServicesList", () => GcloudTasks.runServicesList((s) => missingTool(s))],
  [
    "runUpdateTraffic",
    () =>
      GcloudTasks.runUpdateTraffic((s) =>
        missingTool(s).service("api").toLatest()
      ),
  ],
  [
    "artifactsImagesList",
    () =>
      GcloudTasks.artifactsImagesList((s) => missingTool(s).repository("r")),
  ],
  [
    "artifactsImagesDelete",
    () => GcloudTasks.artifactsImagesDelete((s) => missingTool(s).image("i")),
  ],
  [
    "artifactsRepositoriesList",
    () => GcloudTasks.artifactsRepositoriesList((s) => missingTool(s)),
  ],
  [
    "artifactsRepositoriesDescribe",
    () =>
      GcloudTasks.artifactsRepositoriesDescribe((s) =>
        missingTool(s).repository("r")
      ),
  ],
  [
    "storageCp",
    () =>
      GcloudTasks.storageCp((s) =>
        missingTool(s).sources("a").destination("gs://b")
      ),
  ],
  [
    "storageRsync",
    () =>
      GcloudTasks.storageRsync((s) =>
        missingTool(s).source("a").destination("gs://b")
      ),
  ],
  ["storageLs", () => GcloudTasks.storageLs((s) => missingTool(s))],
  [
    "storageRm",
    () => GcloudTasks.storageRm((s) => missingTool(s).paths("gs://b/o")),
  ],
  [
    "clustersGetCredentials",
    () =>
      GcloudTasks.clustersGetCredentials((s) => missingTool(s).cluster("c")),
  ],
  ["clustersList", () => GcloudTasks.clustersList((s) => missingTool(s))],
  [
    "clustersDescribe",
    () => GcloudTasks.clustersDescribe((s) => missingTool(s).cluster("c")),
  ],
  [
    "functionsDeploy",
    () => GcloudTasks.functionsDeploy((s) => missingTool(s).function("fn")),
  ],
  [
    "functionsDescribe",
    () => GcloudTasks.functionsDescribe((s) => missingTool(s).function("fn")),
  ],
  [
    "secretsAccess",
    () => GcloudTasks.secretsAccess((s) => missingTool(s).secret("k")),
  ],
  [
    "secretValue",
    () => GcloudTasks.secretValue((s) => missingTool(s).secret("k")),
  ],
];

for (const [name, invoke] of REACH) {
  Deno.test(`GcloudTasks.${name} reaches execution`, async () => {
    await assertRejects(invoke, ToolNotFoundError);
  });
}

Deno.test("the value readers fail when gcloud is absent", async () => {
  // A reader that swallowed the resolution failure would hand back a confident
  // empty string, which a build would then use as a URL, a token, or a secret.
  await assertRejects(
    () => GcloudTasks.accessToken((s) => missingTool(s)),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GcloudTasks.runServiceUrl((s) => missingTool(s).service("api")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GcloudTasks.secretValue((s) => missingTool(s).secret("k")),
    ToolNotFoundError,
  );
});

Deno.test("readScalar refuses output that is not one value", () => {
  // A value(...) projection emits one line per resource. Joining them would
  // return a string that looks like a single URL and is not — found by
  // attacking the reader rather than by a failing command.
  const error = assertThrows(
    () =>
      readScalar(
        {
          stdout: "https://a.run.app\nhttps://b.run.app\n",
          truncated: false,
          maxCapturedBytes: 8388608,
        },
        "runServiceUrl",
        "service URL",
      ),
    Error,
  );
  assertEquals(error.message.includes("more than one line"), true);
  assertEquals(error.message.includes("narrow it"), true);
  // One line, however padded, is still one value.
  assertEquals(
    readScalar(
      {
        stdout: "\n  https://a.run.app  \n",
        truncated: false,
        maxCapturedBytes: 8,
      },
      "runServiceUrl",
      "service URL",
    ),
    "https://a.run.app",
  );
});

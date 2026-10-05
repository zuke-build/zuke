// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import type { JsonValue, TargetStateHandle } from "@zuke/core";
import { CommandOutput } from "@zuke/core/shell";
import { ToolNotFoundError } from "@zuke/core/tooling";
import { missingTool } from "@zuke/core/tooling/conformance";
import {
  cloudRunCanary,
  type CloudRunCanarySettings,
  type GcloudSettings,
  type GcloudSettingsRunner,
} from "../mod.ts";

/** A state handle backed by a plain object, as the engine's in-memory one is. */
function memoryState(): TargetStateHandle {
  const data: Record<string, JsonValue> = {};
  return {
    set: (patch) => {
      Object.assign(data, patch);
      return Promise.resolve();
    },
    trySet: (patch) => {
      Object.assign(data, patch);
      return Promise.resolve(true);
    },
    get: () => ({ ...data }),
  };
}

/**
 * A runner that records every command line and answers a revision read-back
 * with the next name in `revisions`.
 */
function fakeGcloud(...revisions: string[]): {
  runner: GcloudSettingsRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const runner = (settings: GcloudSettings): Promise<CommandOutput> => {
    const argv = settings.argv();
    calls.push(argv);
    const stdout = argv.includes("describe") ? `${revisions.shift()}\n` : "";
    return Promise.resolve(new CommandOutput(0, stdout, ""));
  };
  return { runner, calls };
}

function context() {
  const summary: Record<string, string | number> = {};
  return {
    state: memoryState(),
    summary,
    reportSummary: (pairs: Record<string, string | number>) => {
      Object.assign(summary, pairs);
    },
  };
}

function platform(
  runner: GcloudSettingsRunner,
  extra: (r: CloudRunCanarySettings) => CloudRunCanarySettings = (r) => r,
) {
  return cloudRunCanary((r) =>
    extra(
      r.service("api").region("europe-west1").image("gcr.io/p/api:2")
        .gcloud((g) => g.project("p")).runner(runner),
    )
  );
}

Deno.test("stage deploys the image tagged, with no traffic, and records the revision", async () => {
  const { runner, calls } = fakeGcloud("api-00002-abc");
  const ctx = context();
  await platform(runner).stage(ctx);
  assertEquals(calls, [
    [
      "gcloud",
      "run",
      "services",
      "update",
      "api",
      "--region",
      "europe-west1",
      "--image",
      "gcr.io/p/api:2",
      "--tag",
      "canary",
      "--no-traffic",
      "--project",
      "p",
    ],
    [
      "gcloud",
      "run",
      "services",
      "describe",
      "api",
      "--region",
      "europe-west1",
      "--project",
      "p",
      "--format",
      "value(status.latestCreatedRevisionName)",
    ],
  ]);
  assertEquals(ctx.state.get(), { cloudRunCandidate: "api-00002-abc" });
  assertEquals(ctx.summary, { Candidate: "api-00002-abc" });
});

Deno.test("expose routes a whole percent through the tag and reports it achieved", async () => {
  const { runner, calls } = fakeGcloud();
  assertEquals(await platform(runner, (r) => r.tag("blue")).expose(25), 25);
  assertEquals(calls[0].slice(1), [
    "run",
    "services",
    "update-traffic",
    "api",
    "--region",
    "europe-west1",
    "--to-tags",
    "blue=25",
    "--project",
    "p",
  ]);
});

Deno.test("expose refuses a share Cloud Run cannot split", async () => {
  const { runner, calls } = fakeGcloud();
  for (const bad of [12.5, -1, 101, Number.NaN]) {
    await assertRejects(
      () => platform(runner).expose(bad),
      Error,
      "whole percents",
    );
  }
  assertEquals(calls, []);
});

Deno.test("promote sends traffic to latest once it is still the candidate", async () => {
  const { runner, calls } = fakeGcloud("api-00002-abc", "api-00002-abc");
  const ctx = context();
  const p = platform(runner);
  await p.stage(ctx);
  await p.promote(ctx);
  assertEquals(calls[3].slice(1, 6), [
    "run",
    "services",
    "update-traffic",
    "api",
    "--region",
  ]);
  assertEquals(calls[3].includes("--to-latest"), true);
});

Deno.test("promote refuses a revision the canary never staged", async () => {
  const { runner, calls } = fakeGcloud("api-00002-abc", "api-00003-zzz");
  const ctx = context();
  const p = platform(runner);
  await p.stage(ctx);
  await assertRejects(
    () => p.promote(ctx),
    Error,
    "not the staged candidate api-00002-abc",
  );
  // The read happened; the traffic move did not.
  assertEquals(calls.length, 3);
});

Deno.test("promote with nothing staged refuses rather than guess", async () => {
  const { runner, calls } = fakeGcloud();
  await assertRejects(
    () => platform(runner).promote(context()),
    Error,
    "no staged candidate",
  );
  assertEquals(calls, []);
});

Deno.test("abort zeroes the tag and needs no recorded state", async () => {
  const { runner, calls } = fakeGcloud();
  const p = platform(runner);
  await p.abort();
  await p.abort();
  assertEquals(calls.length, 2);
  assertEquals(calls[0].slice(-4), ["--to-tags", "canary=0", "--project", "p"]);
  assertEquals(calls[1], calls[0]);
});

Deno.test("the lambda is evaluated on every call, so it sees resolved values", async () => {
  const { runner, calls } = fakeGcloud();
  let image = "unresolved";
  const p = cloudRunCanary((r) => r.service("api").image(image).runner(runner));
  image = "gcr.io/p/api:3";
  await p.stage(context()).catch(() => {});
  assertEquals(calls[0].includes("gcr.io/p/api:3"), true);
});

Deno.test("missing service, missing image and a bad tag are named", async () => {
  const { runner, calls } = fakeGcloud();
  await assertRejects(
    () => cloudRunCanary((r) => r.image("i").runner(runner)).stage(context()),
    Error,
    "no service named",
  );
  await assertRejects(
    () =>
      cloudRunCanary((r) => r.service("api").runner(runner)).stage(context()),
    Error,
    "no candidate image",
  );
  for (const tag of ["Canary", "can,ary", "c=1", "-x", ""]) {
    await assertRejects(
      () => platform(runner, (r) => r.tag(tag)).abort(),
      Error,
      "is not one Cloud Run accepts",
    );
  }
  assertEquals(calls, []);
});

Deno.test("describe names the service", () => {
  const { runner } = fakeGcloud();
  assertEquals(platform(runner).describe(), "Cloud Run service api");
  assertEquals(
    cloudRunCanary((r) => r).describe(),
    "Cloud Run service",
  );
  assertEquals(platform(runner).exposure, "traffic");
});

Deno.test("a failing gcloud command fails the call", async () => {
  const p = cloudRunCanary((r) =>
    r.service("api").runner(() => Promise.reject(new Error("gcloud exit 1")))
  );
  await assertRejects(() => p.abort(), Error, "gcloud exit 1");
});

Deno.test("an empty revision read-back is refused, not recorded", async () => {
  const ctx = context();
  const p = cloudRunCanary((r) =>
    r.service("api").image("i").runner(() =>
      Promise.resolve(new CommandOutput(0, "\n", ""))
    )
  );
  const error = await assertRejects(() => p.stage(ctx), Error);
  assertStringIncludes(error.message, "latest revision");
  assertEquals(ctx.state.get(), {});
});

Deno.test("the default runner runs gcloud itself", async () => {
  // The default is the settings' own run(), so a gcloud that is not installed
  // surfaces as the wrapper's usual tool-not-found error.
  const p = cloudRunCanary((r) =>
    r.service("api").gcloud((g) => missingTool(g))
  );
  await assertRejects(() => p.abort(), ToolNotFoundError);
});

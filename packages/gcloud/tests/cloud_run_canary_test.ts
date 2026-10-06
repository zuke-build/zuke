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
  assertEquals(ctx.state.get(), {
    cloudRunStage: "tagged",
    cloudRunCandidate: "api-00002-abc",
  });
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

Deno.test("abort mid-rollout takes the tag back to 0, and repeats harmlessly", async () => {
  const { runner, calls } = fakeGcloud("api-00002-abc");
  const ctx = context();
  const p = platform(runner);
  await p.stage(ctx);
  await p.abort(ctx);
  await p.abort(ctx);
  const moves = calls.slice(2);
  assertEquals(moves.length, 2);
  assertEquals(moves[0].slice(-4), ["--to-tags", "canary=0", "--project", "p"]);
  assertEquals(moves[1], moves[0]);
});

Deno.test("abort after a stage that never tagged anything runs nothing", async () => {
  // The update failed: no route carries the candidate, so there is nothing to
  // take back — and on a first rollout the tag does not even exist.
  const ctx = context();
  const failing = cloudRunCanary((r) =>
    r.service("api").image("i").runner(() =>
      Promise.reject(new Error("image not found"))
    )
  );
  await assertRejects(() => failing.stage(ctx), Error, "image not found");
  assertEquals(ctx.state.get(), { cloudRunStage: "deploying" });
  const { runner, calls } = fakeGcloud();
  await platform(runner).abort(ctx);
  assertEquals(calls, []);
});

Deno.test("a stage that fails on its own settings leaves a rollback nothing to do", async () => {
  // Stage refuses before touching the service. The engine then runs abort
  // inline; with no record of how far stage got, abort would read like a
  // hand-run one and send all traffic to the stable revision.
  const ctx = context();
  const { runner, calls } = fakeGcloud();
  const p = cloudRunCanary((r) =>
    r.service("api").image("").stable("api-00001-old").runner(runner)
  );
  await assertRejects(() => p.stage(ctx), Error, "no candidate image");
  assertEquals(ctx.state.get(), { cloudRunStage: "deploying" });
  await p.abort(ctx);
  assertEquals(calls, []);
});

Deno.test("a stage that cannot record the tag stops before any traffic moves", async () => {
  const { runner, calls } = fakeGcloud("api-00002-abc");
  const ctx = context();
  ctx.state.trySet = () => Promise.resolve(false);
  await assertRejects(
    () => platform(runner).stage(ctx),
    Error,
    "could not record that the candidate is tagged",
  );
  // The update ran; the read-back and everything after it did not.
  assertEquals(calls.length, 1);
});

Deno.test("a hand-run abort returns all traffic to the configured stable revision", async () => {
  const { runner, calls } = fakeGcloud();
  await platform(runner, (r) => r.stable("api-00001-old")).abort(context());
  assertEquals(calls[0].slice(1), [
    "run",
    "services",
    "update-traffic",
    "api",
    "--region",
    "europe-west1",
    "--to-revisions",
    "api-00001-old=100",
    "--project",
    "p",
  ]);
});

Deno.test("a hand-run abort with no stable revision refuses rather than claim a rollback", async () => {
  const { runner, calls } = fakeGcloud();
  await assertRejects(
    () => platform(runner).abort(context()),
    Error,
    "r.stable('<revision>')",
  );
  await assertRejects(
    () => platform(runner, (r) => r.stable("api=1,b")).abort(context()),
    Error,
    "is not a Cloud Run revision name",
  );
  assertEquals(calls, []);
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
      () => platform(runner, (r) => r.tag(tag)).expose(10),
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
  await assertRejects(() => p.expose(10), Error, "gcloud exit 1");
});

Deno.test("a failed command fails the call even when gcloud is told not to throw", async () => {
  // .gcloud((g) => g.noThrow()) would otherwise turn a failed rollback into a
  // reported one.
  const failing = () => Promise.resolve(new CommandOutput(1, "", "denied"));
  const ctx = context();
  await ctx.state.set({ cloudRunStage: "tagged" });
  const p = cloudRunCanary((r) =>
    r.service("api").gcloud((g) => g.noThrow()).runner(failing)
  );
  await assertRejects(() => p.abort(ctx), Error, "exited 1");
  await assertRejects(() => p.expose(10), Error, "exited 1");
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
  // The tag landed, but no candidate is recorded as one.
  assertEquals(ctx.state.get(), { cloudRunStage: "tagged" });
});

Deno.test("the default runner runs gcloud itself", async () => {
  // The default is the settings' own run(), so a gcloud that is not installed
  // surfaces as the wrapper's usual tool-not-found error.
  const p = cloudRunCanary((r) =>
    r.service("api").gcloud((g) => missingTool(g))
  );
  await assertRejects(() => p.expose(10), ToolNotFoundError);
});

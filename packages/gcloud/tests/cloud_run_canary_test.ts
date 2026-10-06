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

/** The uid the fake Cloud Run service reports unless a test changes it. */
const UID = "a000a000-0000-4000-8000-000000000000";

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
 * A runner that records every command line, answers a uid read with
 * `live.uid` and a revision read-back with the next name in `revisions`.
 */
function fakeGcloud(...revisions: string[]): {
  runner: GcloudSettingsRunner;
  calls: string[][];
  live: { uid: string };
} {
  const calls: string[][] = [];
  const live = { uid: UID };
  const runner = (settings: GcloudSettings): Promise<CommandOutput> => {
    const argv = settings.argv();
    calls.push(argv);
    const stdout = argv.includes("value(metadata.uid)")
      ? `${live.uid}\n`
      : argv.includes("describe")
      ? `${revisions.shift()}\n`
      : "";
    return Promise.resolve(new CommandOutput(0, stdout, ""));
  };
  return { runner, calls, live };
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

/** A rollout staged with the default configuration, and its fake gcloud. */
async function staged() {
  const fake = fakeGcloud("api-00002-abc", "api-00002-abc");
  const ctx = context();
  await platform(fake.runner).stage(ctx);
  fake.calls.length = 0;
  return { ...fake, ctx };
}

/** The uid read every checked call makes, with the default configuration. */
const UID_READ = [
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
  "value(metadata.uid)",
];

Deno.test("stage reads the uid, deploys tagged with no traffic, and records the identity", async () => {
  const { runner, calls } = fakeGcloud("api-00002-abc");
  const ctx = context();
  await platform(runner).stage(ctx);
  assertEquals(calls, [
    UID_READ,
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
    cloudRunService: "api",
    cloudRunRegion: "europe-west1",
    cloudRunTag: "canary",
    cloudRunGcloudFlags: ["--project", "p"],
    cloudRunServiceUid: UID,
    cloudRunCandidate: "api-00002-abc",
  });
  assertEquals(ctx.summary, { Candidate: "api-00002-abc" });
});

Deno.test("stage records an unset region as null and the flags as argv only", async () => {
  const { runner } = fakeGcloud("api-00002-abc");
  const ctx = context();
  await cloudRunCanary((r) =>
    r.service("api").image("i").runner(runner).gcloud((g) =>
      g.toolPath("/opt/gcloud").env({ CLOUDSDK_AUTH_ACCESS_TOKEN: "secret" })
        .account("deploy@p.iam.gserviceaccount.com")
    )
  ).stage(ctx);
  const state = ctx.state.get();
  assertEquals(state.cloudRunRegion, null);
  // Which gcloud runs, and what it is given through the environment, are not
  // recorded: the binary does not choose the service, and an env value may be
  // a secret.
  assertEquals(state.cloudRunGcloudFlags, [
    "--account",
    "deploy@p.iam.gserviceaccount.com",
  ]);
  assertEquals(JSON.stringify(state).includes("secret"), false);
});

Deno.test("the uid is recorded as gcloud printed it, a string never a number", async () => {
  // A uid that reads as a number would lose digits as one.
  const { runner, live } = fakeGcloud("api-00002-abc");
  live.uid = "12345678901234567890123";
  const ctx = context();
  await platform(runner).stage(ctx);
  assertEquals(ctx.state.get().cloudRunServiceUid, "12345678901234567890123");
});

Deno.test("expose checks the record and the live uid, then routes a whole percent through the tag", async () => {
  const { runner, calls, ctx } = await staged();
  assertEquals(
    await platform(runner, (r) => r.tag("canary")).expose(25, ctx),
    25,
  );
  assertEquals(calls, [UID_READ, [
    "gcloud",
    "run",
    "services",
    "update-traffic",
    "api",
    "--region",
    "europe-west1",
    "--to-tags",
    "canary=25",
    "--project",
    "p",
  ]]);
});

Deno.test("expose refuses a share Cloud Run cannot split", async () => {
  const { runner, calls, ctx } = await staged();
  for (const bad of [12.5, -1, 101, Number.NaN]) {
    await assertRejects(
      () => platform(runner).expose(bad, ctx),
      Error,
      "whole percents",
    );
  }
  assertEquals(calls, []);
});

Deno.test("promote sends traffic to latest once it is still the candidate", async () => {
  const { runner, calls, ctx } = await staged();
  await platform(runner).promote(ctx);
  assertEquals(calls.length, 3);
  assertEquals(calls[0], UID_READ);
  assertEquals(calls[1].at(-1), "value(status.latestCreatedRevisionName)");
  assertEquals(calls[2].slice(1, 6), [
    "run",
    "services",
    "update-traffic",
    "api",
    "--region",
  ]);
  assertEquals(calls[2].includes("--to-latest"), true);
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
  // The reads happened; the traffic move did not.
  assertEquals(calls.length, 5);
  assertEquals(calls.some((argv) => argv.includes("--to-latest")), false);
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
  const { runner, calls, ctx } = await staged();
  const p = platform(runner);
  await p.abort(ctx);
  await p.abort(ctx);
  assertEquals(calls.length, 4);
  assertEquals(calls[0], UID_READ);
  assertEquals(calls[1].slice(-4), [
    "--to-tags",
    "canary=0",
    "--project",
    "p",
  ]);
  assertEquals(calls[2], calls[0]);
  assertEquals(calls[3], calls[1]);
});

/** Each recorded part changed in the configuration, and what names it. */
const CHANGES: ReadonlyArray<
  readonly [
    label: string,
    change: (r: CloudRunCanarySettings) => CloudRunCanarySettings,
    was: string,
    now: string,
  ]
> = [
  ["service", (r) => r.service("billing"), '"api"', '"billing"'],
  ["region", (r) => r.region("us-central1"), '"europe-west1"', '"us-central1"'],
  ["tag", (r) => r.tag("blue"), '"canary"', '"blue"'],
  [
    "gcloud flags",
    (r) => r.gcloud((g) => g.project("other")),
    "`--project p`",
    "`--project other`",
  ],
  [
    "gcloud flags",
    (r) => r.gcloud((g) => g),
    "`--project p`",
    "no gcloud flags",
  ],
];

Deno.test("expose, promote and abort refuse a changed configuration before any command", async () => {
  for (const [label, change, was, now] of CHANGES) {
    for (const call of ["expose", "promote", "abort"] as const) {
      const { runner, calls, ctx } = await staged();
      const p = platform(runner, change);
      const error = await assertRejects(
        () =>
          call === "expose"
            ? p.expose(10, ctx)
            : call === "promote"
            ? p.promote(ctx)
            : p.abort(ctx),
        Error,
        `this rollout staged with the ${label} ${was}, but it is now ` +
          `configured with ${now}, so this call changed nothing`,
      );
      assertStringIncludes(error.message, "cloudRunCanary:");
      assertEquals(calls, [], `${label} × ${call} ran a command`);
    }
  }
});

Deno.test("a different live uid is refused after the read and before any change", async () => {
  for (const call of ["expose", "promote", "abort"] as const) {
    const { runner, calls, ctx, live } = await staged();
    live.uid = "0a0b0c0d-1111-4222-8333-444455556666";
    const p = platform(runner);
    const error = await assertRejects(
      () =>
        call === "expose"
          ? p.expose(10, ctx)
          : call === "promote"
          ? p.promote(ctx)
          : p.abort(ctx),
      Error,
      `the service "api" this rollout staged has the uid "${UID}", but the ` +
        'one gcloud reaches now has the uid "0a0b0c0d-1111-4222-8333-' +
        '444455556666"',
    );
    assertStringIncludes(error.message, "CLOUDSDK_CORE_PROJECT");
    // Only the read ran.
    assertEquals(calls, [UID_READ], call);
  }
});

Deno.test("a refusal gives the recovery built from the recorded values", async () => {
  const { runner, ctx } = await staged();
  const error = await assertRejects(
    () => platform(runner, (r) => r.service("billing")).abort(ctx),
    Error,
  );
  assertStringIncludes(
    error.message,
    "The run stops, and its rollback refuses the same way, so a resume or " +
      "`zuke cancel` will not roll it back: the candidate's tagged route " +
      "stays as it is.",
  );
  assertStringIncludes(
    error.message,
    "check that `gcloud run services describe api --region europe-west1 " +
      "--project p --format 'value(metadata.uid)'` prints " + UID,
  );
  assertStringIncludes(
    error.message,
    "take the candidate's traffic back with `gcloud run services " +
      "update-traffic api --region europe-west1 --to-tags canary=0 " +
      "--project p`",
  );
  assertStringIncludes(
    error.message,
    "Prefer that: it returns the tag's share to the revisions already " +
      "serving, keeping their split.",
  );
  assertStringIncludes(
    error.message,
    "with r.stable('<revision>') instead sends all traffic to that one " +
      "revision, collapsing any earlier split; `gcloud run revisions list " +
      "--service api --region europe-west1 --project p` lists the revisions " +
      "to choose from.",
  );
});

Deno.test("the recovery leaves out a region never set and quotes what a shell would split", async () => {
  const { runner } = fakeGcloud("api-00002-abc");
  const ctx = context();
  const configured = (flag: string) =>
    cloudRunCanary((r) =>
      r.service("api").image("i").runner(runner).gcloud((g) =>
        g.flag("impersonate-service-account", flag)
      )
    );
  await configured("it's@p.iam").stage(ctx);
  const error = await assertRejects(
    () => configured("x@p.iam").expose(10, ctx),
    Error,
  );
  assertStringIncludes(
    error.message,
    "gcloud flags `--impersonate-service-account 'it'\\''s@p.iam'`",
  );
  assertStringIncludes(
    error.message,
    "`gcloud run services update-traffic api --to-tags canary=0 " +
      "--impersonate-service-account 'it'\\''s@p.iam'`",
  );
});

Deno.test("a changed region is named against gcloud's default", async () => {
  const { runner } = fakeGcloud("api-00002-abc");
  const ctx = context();
  await cloudRunCanary((r) => r.service("api").image("i").runner(runner))
    .stage(ctx);
  await assertRejects(
    () =>
      cloudRunCanary((r) => r.service("api").region("eu").runner(runner))
        .abort(ctx),
    Error,
    "the region gcloud's default region, but it is now configured with " +
      '"eu"',
  );
});

/** A record `stage` wrote, with one key replaced. */
async function damagedBy(key: string, value: JsonValue) {
  const fixture = await staged();
  await fixture.ctx.state.set({ [key]: value });
  return fixture;
}

Deno.test("a damaged record is refused before any command", async () => {
  const cases: ReadonlyArray<readonly [string, JsonValue, string]> = [
    ["cloudRunService", 1, "the service it staged (it holds 1)"],
    ["cloudRunService", "", 'the service it staged (it holds "")'],
    ["cloudRunRegion", 2, "the region it staged in (it holds 2)"],
    ["cloudRunTag", null, "the tag it staged with (it holds null)"],
    ["cloudRunTag", "", "the tag it staged with"],
    ["cloudRunGcloudFlags", "--project p", "the gcloud flags it staged with"],
    ["cloudRunGcloudFlags", [1], "the gcloud flags it staged with"],
    ["cloudRunServiceUid", 123, "the uid of the service it staged"],
    ["cloudRunServiceUid", "", "the uid of the service it staged"],
  ];
  for (const [key, value, names] of cases) {
    for (const call of ["expose", "promote", "abort", "stage"] as const) {
      const { runner, calls, ctx } = await damagedBy(key, value);
      const p = platform(runner);
      await assertRejects(
        () =>
          call === "expose"
            ? p.expose(10, ctx)
            : call === "promote"
            ? p.promote(ctx)
            : call === "abort"
            ? p.abort(ctx)
            : p.stage(ctx),
        Error,
        `the rollout's record is damaged: it does not hold ${names}`,
      );
      assertEquals(calls, [], `${key} × ${call}`);
    }
  }
});

Deno.test("a record from before the identity was recorded is refused, with the way out", async () => {
  // What an earlier @zuke/gcloud left for a rollout parked across the upgrade.
  for (const call of ["expose", "promote", "abort"] as const) {
    const ctx = context();
    await ctx.state.set({
      cloudRunStage: "tagged",
      cloudRunCandidate: "api-00002-abc",
    });
    const { runner, calls } = fakeGcloud();
    const p = platform(runner);
    const error = await assertRejects(
      () =>
        call === "expose"
          ? p.expose(10, ctx)
          : call === "promote"
          ? p.promote(ctx)
          : p.abort(ctx),
      Error,
      "does not hold the service it staged (it holds nothing)",
    );
    assertStringIncludes(
      error.message,
      "A rollout staged before @zuke/gcloud recorded its service has no " +
        "such record.",
    );
    assertStringIncludes(
      error.message,
      "--to-tags <tag>=0`, plus the --project and --account flags the " +
        "rollout used.",
    );
    assertEquals(calls, [], call);
  }
});

Deno.test("an unknown stage marker is refused, not overwritten or acted on", async () => {
  for (const call of ["expose", "abort", "stage"] as const) {
    const { runner, calls, ctx } = await damagedBy("cloudRunStage", "gone");
    const p = platform(runner, (r) => r.stable("api-00001-old"));
    await assertRejects(
      () =>
        call === "expose"
          ? p.expose(10, ctx)
          : call === "abort"
          ? p.abort(ctx)
          : p.stage(ctx),
      Error,
      'does not hold a stage marker this call can act on (it holds "gone")',
    );
    assertEquals(calls, [], call);
    assertEquals(ctx.state.get().cloudRunStage, "gone");
  }
});

Deno.test("expose with no stage recorded refuses before any command", async () => {
  const { runner, calls } = fakeGcloud();
  await assertRejects(
    () => platform(runner).expose(10, context()),
    Error,
    "a stage marker this call can act on (it holds nothing)",
  );
  assertEquals(calls, []);
});

Deno.test("a stage run again over a tagged record is checked against it first", async () => {
  // A resume of a degraded record re-runs stage: it must not move the
  // marker back, and must not deploy to a service the rollout never staged.
  const changed = await staged();
  await assertRejects(
    () =>
      platform(changed.runner, (r) => r.service("billing")).stage(changed.ctx),
    Error,
    'the service "api", but it is now configured with "billing"',
  );
  assertEquals(changed.calls, []);
  assertEquals(changed.ctx.state.get().cloudRunStage, "tagged");

  const recreated = await staged();
  recreated.live.uid = "another";
  await assertRejects(
    () => platform(recreated.runner).stage(recreated.ctx),
    Error,
    'now has the uid "another"',
  );
  assertEquals(recreated.calls, [UID_READ]);

  const same = await staged();
  await platform(same.runner).stage(same.ctx);
  assertEquals(same.calls[0], UID_READ);
  assertEquals(same.calls[1].slice(1, 4), ["run", "services", "update"]);
  assertEquals(same.ctx.state.get().cloudRunServiceUid, UID);
});

Deno.test("abort after a stage that never tagged anything runs nothing", async () => {
  // The update failed: no route carries the candidate, so there is nothing to
  // take back — and on a first rollout the tag does not even exist.
  const ctx = context();
  const failing = cloudRunCanary((r) =>
    r.service("api").image("i").runner((settings) =>
      settings.argv().includes("update")
        ? Promise.reject(new Error("image not found"))
        : Promise.resolve(new CommandOutput(0, `${UID}\n`, ""))
    )
  );
  await assertRejects(() => failing.stage(ctx), Error, "image not found");
  assertEquals(ctx.state.get(), { cloudRunStage: "deploying" });
  const { runner, calls } = fakeGcloud();
  await platform(runner, (r) => r.service("billing")).abort(ctx);
  assertEquals(calls, []);
});

Deno.test("a stage whose uid read fails has touched nothing", async () => {
  const ctx = context();
  const calls: string[][] = [];
  const p = cloudRunCanary((r) =>
    r.service("api").image("i").runner((settings) => {
      calls.push(settings.argv());
      return Promise.resolve(new CommandOutput(1, "", "NOT_FOUND"));
    })
  );
  await assertRejects(() => p.stage(ctx), Error, "NOT_FOUND");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].at(-1), "value(metadata.uid)");
  assertEquals(ctx.state.get(), { cloudRunStage: "deploying" });
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
  // The uid read and the update ran; the read-back and everything after it
  // did not.
  assertEquals(calls.length, 2);
});

Deno.test("a hand-run abort returns all traffic to the configured stable revision", async () => {
  const { runner, calls } = fakeGcloud();
  await platform(runner, (r) => r.stable("api-00001-old")).abort(context());
  // No record, so nothing to check against: the configuration as it is.
  assertEquals(calls, [[
    "gcloud",
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
  ]]);
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
  assertEquals(calls[1].includes("gcr.io/p/api:3"), true);
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
      () => platform(runner, (r) => r.tag(tag)).expose(10, context()),
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
  await assertRejects(
    () => p.abort(context()),
    Error,
    "r.stable('<revision>')",
  );
  const { ctx } = await staged();
  await assertRejects(
    () =>
      cloudRunCanary((r) =>
        r.service("api").region("europe-west1").gcloud((g) => g.project("p"))
          .runner(() => Promise.reject(new Error("gcloud exit 1")))
      ).expose(10, ctx),
    Error,
    "gcloud exit 1",
  );
});

Deno.test("a failed command fails the call even when gcloud is told not to throw", async () => {
  // .gcloud((g) => g.noThrow()) would otherwise turn a failed rollback into a
  // reported one.
  const { ctx } = await staged();
  const failing = () => Promise.resolve(new CommandOutput(1, "", "denied"));
  const p = cloudRunCanary((r) =>
    r.service("api").region("europe-west1").gcloud((g) =>
      g.project("p").noThrow()
    ).runner(failing)
  );
  // noThrow renders no flag, so the record still matches.
  await assertRejects(() => p.abort(ctx), Error, "exited 1");
  await assertRejects(() => p.expose(10, ctx), Error, "exited 1");
  const silent = cloudRunCanary((r) =>
    r.service("api").image("i").runner(() =>
      Promise.resolve(new CommandOutput(2, "", " "))
    )
  );
  await assertRejects(
    () => silent.stage(context()),
    Error,
    "gcloud run services describe exited 2.",
  );
});

Deno.test("an empty revision read-back is refused, not recorded", async () => {
  const ctx = context();
  const p = cloudRunCanary((r) =>
    r.service("api").image("i").runner((settings) =>
      Promise.resolve(
        new CommandOutput(
          0,
          settings.argv().includes("value(metadata.uid)") ? `${UID}\n` : "\n",
          "",
        ),
      )
    )
  );
  const error = await assertRejects(() => p.stage(ctx), Error);
  assertStringIncludes(error.message, "latest revision");
  // The tag landed, but no candidate is recorded as one.
  assertEquals(ctx.state.get().cloudRunStage, "tagged");
  assertEquals(ctx.state.get().cloudRunCandidate, undefined);
});

Deno.test("an empty uid read is refused, and nothing is deployed", async () => {
  const calls: string[][] = [];
  const p = cloudRunCanary((r) =>
    r.service("api").image("i").runner((settings) => {
      calls.push(settings.argv());
      return Promise.resolve(new CommandOutput(0, "\n", ""));
    })
  );
  await assertRejects(() => p.stage(context()), Error, "no service uid");
  assertEquals(calls.length, 1);
});

Deno.test("the default runner runs gcloud itself", async () => {
  // The default is the settings' own run(), so a gcloud that is not installed
  // surfaces as the wrapper's usual tool-not-found error.
  const p = cloudRunCanary((r) =>
    r.service("api").stable("api-00001-old").gcloud((g) => missingTool(g))
  );
  await assertRejects(() => p.abort(context()), ToolNotFoundError);
});

Deno.test("the recovery's uid check keeps its projection over a recorded --format", async () => {
  const { runner, live } = fakeGcloud("api-00002-abc");
  const ctx = context();
  const p = cloudRunCanary((r) =>
    r.service("api").image("i").runner(runner).gcloud((g) => g.format("json"))
  );
  await p.stage(ctx);
  assertEquals(ctx.state.get().cloudRunGcloudFlags, ["--format", "json"]);
  live.uid = "another";
  const error = await assertRejects(() => p.abort(ctx), Error);
  assertStringIncludes(
    error.message,
    "`gcloud run services describe api --format json --format " +
      "'value(metadata.uid)'` prints " + UID,
  );
});

/**
 * A `.gcloud` lambda that gives `--project q` on every third run once armed —
 * so the flags a call resolves, its uid read and its traffic move would each
 * see a different run of it.
 */
function flipping(runner: GcloudSettingsRunner) {
  const lambda = { runs: 0, armed: false };
  const p = cloudRunCanary((r) =>
    r.service("api").region("europe-west1").image("gcr.io/p/api:2")
      .runner(runner).gcloud((g) => {
        lambda.runs++;
        return g.project(lambda.armed && lambda.runs % 3 === 0 ? "q" : "p");
      })
  );
  return { p, lambda };
}

Deno.test("a gcloud lambda that resolves differently between commands is refused before the command runs", async () => {
  for (const call of ["expose", "promote", "abort"] as const) {
    const { runner, calls } = fakeGcloud("api-00002-abc", "api-00002-abc");
    const { p, lambda } = flipping(runner);
    const ctx = context();
    await p.stage(ctx);
    calls.length = 0;
    lambda.runs = 0;
    lambda.armed = true;
    await assertRejects(
      () =>
        call === "expose"
          ? p.expose(50, ctx)
          : call === "promote"
          ? p.promote(ctx)
          : p.abort(ctx),
      Error,
      "where the gcloud flags this call resolved are `--project p`, so it " +
        "does not run",
    );
    assertEquals(
      calls.some((argv) => argv.includes("q")),
      false,
      `${call} ran a command on q`,
    );
    assertEquals(
      calls.some((argv) => !argv.includes("describe")),
      false,
      `${call} changed something`,
    );
  }
});

Deno.test("a stage whose gcloud lambda flips does not deploy", async () => {
  const { runner, calls } = fakeGcloud("api-00002-abc");
  const { p, lambda } = flipping(runner);
  lambda.armed = true;
  lambda.runs = 1;
  const ctx = context();
  await assertRejects(
    () => p.stage(ctx),
    Error,
    "gave this command `gcloud run services describe api --region " +
      "europe-west1 --project q`",
  );
  assertEquals(calls, []);
  assertEquals(ctx.state.get(), { cloudRunStage: "deploying" });
});

Deno.test("a gcloud lambda that adds a command token on a later run is refused", async () => {
  const { runner, calls } = fakeGcloud();
  let runs = 0;
  const p = cloudRunCanary((r) =>
    r.service("api").stable("api-00001-old").runner(runner).gcloud((g) =>
      ++runs === 2 ? g.command("x") : g
    )
  );
  // The flag probe is the first run; the command gets a second, different one.
  await assertRejects(
    () => p.abort(context()),
    Error,
    "where the gcloud flags this call resolved are no gcloud flags",
  );
  assertEquals(calls, []);
});

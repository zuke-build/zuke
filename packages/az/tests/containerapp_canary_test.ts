// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import type { JsonValue, TargetStateHandle } from "@zuke/core";
import { CommandError, CommandOutput } from "@zuke/core/shell";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  type AzContainerAppCanarySettings,
  AzOutputError,
  containerAppCanary,
} from "../mod.ts";
import { withEmptyPath } from "./_fake.ts";
import { ContainerAppModel, flagValue } from "./_containerapp_model.ts";

/** A state handle backed by a plain object, as the engine's in-memory one is. */
function memoryState(accept = true): TargetStateHandle {
  const data: Record<string, JsonValue> = {};
  return {
    set: (patch) => {
      Object.assign(data, patch);
      return Promise.resolve();
    },
    trySet: (patch) => {
      if (accept) Object.assign(data, patch);
      return Promise.resolve(accept);
    },
    get: () => ({ ...data }),
  };
}

/** An engine-like context with a recorded summary. */
function context(state = memoryState()) {
  const summary: Record<string, string | number> = {};
  return {
    state,
    summary,
    reportSummary: (pairs: Record<string, string | number>) => {
      Object.assign(summary, pairs);
    },
  };
}

/** The platform against `model`, deploying `acr.io/api:2` as `api--v2`. */
function platform(
  model: ContainerAppModel,
  extra: (a: AzContainerAppCanarySettings) => AzContainerAppCanarySettings = (
    a,
  ) => a,
) {
  return containerAppCanary((a) =>
    extra(
      a.name("api").resourceGroup("rg-prod").image("acr.io/api:2")
        .revisionSuffix("v2").az((z) =>
          z.subscription("sub-prod").runner(model.runner)
        ),
    )
  );
}

/** A rollout staged with the default configuration, and its model. */
async function staged() {
  const model = new ContainerAppModel();
  const ctx = context();
  await platform(model).stage(ctx);
  return { model, ctx };
}

Deno.test("containerAppCanary: stage pins the traffic, deploys the candidate with none, and records the rollout", async () => {
  const { model, ctx } = await staged();
  assertEquals(model.calls.map((argv) => argv.slice(0, 3).join(" ")), [
    "containerapp show --name=api",
    "containerapp ingress traffic",
    "containerapp update --name=api",
    "containerapp show --name=api",
    "containerapp revision list",
  ]);
  assertEquals(model.trafficMoves(), [["api--v1=100"]]);
  const update = model.calls[2];
  assertEquals(flagValue(update, "--image"), "acr.io/api:2");
  assertEquals(flagValue(update, "--revision-suffix"), "v2");
  assertEquals(flagValue(update, "--subscription"), "sub-prod");
  assertEquals(model.shares(), { "api--v1": 100 });
  assertEquals(ctx.state.get(), {
    containerAppCanaryStage: "staged",
    containerAppCanaryApp: "api",
    containerAppCanaryResourceGroup: "rg-prod",
    containerAppCanaryAzFlags: ["--subscription=sub-prod"],
    containerAppCanaryAppId:
      "/subscriptions/sub-prod/resourceGroups/rg-prod/providers/Microsoft.App/containerApps/api",
    containerAppCanaryStable: "api--v1",
    containerAppCanaryCandidate: "api--v2",
    containerAppCanaryCandidateCreated: "2026-10-19T00:00:01Z",
    containerAppCanaryFollowedLatest: true,
  });
  assertEquals(ctx.summary, { Candidate: "api--v2", Stable: "api--v1" });
});

Deno.test("containerAppCanary: expose splits by revision name and promote hands the traffic back to latest", async () => {
  const { model, ctx } = await staged();
  const app = platform(model);
  assertEquals(await app.expose(10, ctx), 10);
  assertEquals(model.shares(), { "api--v1": 90, "api--v2": 10 });
  assertEquals(await app.expose(50, ctx), 50);
  assertEquals(model.shares(), { "api--v1": 50, "api--v2": 50 });
  await app.promote(ctx);
  assertEquals(model.trafficMoves().at(-1), ["latest=100"]);
  assertEquals(model.shares(), { "api--v2": 100 });
  // A promote run again finds the traffic already there.
  const before = model.mutations().length;
  await app.promote(ctx);
  assertEquals(model.mutations().length, before);
});

Deno.test("containerAppCanary: traffic pinned by name before stays pinned, to the candidate", async () => {
  const model = new ContainerAppModel();
  model.api.traffic = [{ revisionName: "api--v1", weight: 100 }];
  const ctx = context();
  const app = platform(model);
  await app.stage(ctx);
  assertEquals(ctx.state.get().containerAppCanaryFollowedLatest, false);
  await app.promote(ctx);
  assertEquals(model.trafficMoves().at(-1), ["api--v2=100", "api--v1=0"]);
  assertEquals(model.shares(), { "api--v2": 100 });
  const before = model.mutations().length;
  await app.promote(ctx);
  assertEquals(model.mutations().length, before);
});

Deno.test("containerAppCanary: stage refuses an app it cannot split", async () => {
  const cases: ReadonlyArray<
    readonly [
      label: string,
      setup: (model: ContainerAppModel) => void,
      message: string,
    ]
  > = [
    ["single mode", (m) => m.api.mode = "Single", "Single revision mode"],
    ["no ingress", (m) => m.api.traffic = null, "has no ingress"],
    [
      "a label",
      (m) =>
        m.api.traffic = [{ latestRevision: true, weight: 100, label: "blue" }],
      "carries the label blue",
    ],
    [
      "a split",
      (m) =>
        m.api.traffic = [
          { revisionName: "api--v1", weight: 80 },
          { latestRevision: true, weight: 20 },
        ],
      "already split between 2 entries",
    ],
    [
      "a revision name it cannot pin",
      (m) => m.api.traffic = [{ revisionName: "API--V1", weight: 100 }],
      "not a revision name this can pin",
    ],
  ];
  for (const [label, setup, message] of cases) {
    const model = new ContainerAppModel();
    setup(model);
    const ctx = context();
    await assertRejects(() => platform(model).stage(ctx), Error, message);
    assertEquals(model.mutations(), [], label);
    // The marker says the candidate never had traffic: a rollback is a no-op.
    await platform(model).abort(ctx);
    assertEquals(model.mutations(), [], label);
  }
});

Deno.test("containerAppCanary: a deploy that makes no new revision, or one that does not provision, takes no traffic", async () => {
  const same = new ContainerAppModel();
  const ctx = context();
  await assertRejects(
    () =>
      containerAppCanary((a) =>
        a.name("api").resourceGroup("rg-prod").image("acr.io/api:1")
          .az((z) => z.runner(same.runner))
      ).stage(ctx),
    Error,
    "the deploy made no new revision",
  );
  assertEquals(ctx.state.get().containerAppCanaryStage, "deploying");
  assertEquals(same.shares(), { "api--v1": 100 });

  const failed = new ContainerAppModel();
  failed.provisioning = "Failed";
  await assertRejects(
    () => platform(failed).stage(context()),
    Error,
    "api--v2 is Failed, not Provisioned",
  );
  assertEquals(failed.shares(), { "api--v1": 100 });
});

Deno.test("containerAppCanary: stage needs an image and names Azure takes", async () => {
  const bad: ReadonlyArray<
    readonly [
      label: string,
      configure: (
        a: AzContainerAppCanarySettings,
      ) => AzContainerAppCanarySettings,
      message: string,
    ]
  > = [
    [
      "no image",
      (a) => a.name("api").resourceGroup("rg"),
      "no candidate image",
    ],
    ["no app", (a) => a.resourceGroup("rg").image("i"), "a.name('api')"],
    [
      "an option-like app",
      (a) => a.name("--subscription=x").resourceGroup("rg").image("i"),
      "a.name('api')",
    ],
    ["no group", (a) => a.name("api").image("i"), "a.resourceGroup('rg-prod')"],
  ];
  for (const [label, configure, message] of bad) {
    const model = new ContainerAppModel();
    await assertRejects(
      () =>
        containerAppCanary((a) =>
          configure(a).az((z) => z.runner(model.runner))
        )
          .stage(context()),
      Error,
      message,
    );
    assertEquals(model.calls, [], label);
  }
  assertEquals(containerAppCanary((a) => a).describe(), "container app");
  assertEquals(
    containerAppCanary((a) => a.name("api")).describe(),
    "container app api",
  );
});

Deno.test("containerAppCanary: a stage run again after the pin still knows the traffic followed latest", async () => {
  const model = new ContainerAppModel();
  const ctx = context();
  // The first attempt pins the traffic, then its deploy fails.
  model.apps["sub-prod/rg-prod/api"].image = "acr.io/api:2";
  await assertRejects(
    () =>
      containerAppCanary((a) =>
        a.name("api").resourceGroup("rg-prod").image("acr.io/api:2")
          .az((z) => z.subscription("sub-prod").runner(model.runner))
      ).stage(ctx),
    Error,
    "no new revision",
  );
  assertEquals(model.api.traffic, [
    { latestRevision: true, weight: 0 },
    { revisionName: "api--v1", weight: 100 },
  ]);
  // The retry finds the traffic pinned by name, but promote still restores
  // "latest" routing, as the app had it before the rollout.
  await platform(model).stage(ctx);
  assertEquals(ctx.state.get().containerAppCanaryFollowedLatest, true);
  await platform(model).promote(ctx);
  assertEquals(model.trafficMoves().at(-1), ["latest=100"]);
});

Deno.test("containerAppCanary: a stage run again over its record checks it and deploys nothing", async () => {
  const { model, ctx } = await staged();
  model.calls = [];
  await platform(model).stage(ctx);
  assertEquals(model.calls.map((argv) => argv[1]), ["show"]);
  assertEquals(ctx.summary.Candidate, "api--v2");
});

Deno.test("containerAppCanary: an unrecordable rollout stops before any traffic moves to the candidate", async () => {
  const model = new ContainerAppModel();
  await assertRejects(
    () => platform(model).stage(context(memoryState(false))),
    Error,
    "could not record the staged rollout",
  );
  assertEquals(model.shares(), { "api--v1": 100 });
});

Deno.test("containerAppCanary: an unknown stage marker is never acted on", async () => {
  for (const call of ["stage", "expose", "abort"] as const) {
    // Over a whole record, so the marker alone is what refuses.
    const { model, ctx } = await staged();
    await ctx.state.set({ containerAppCanaryStage: "half-done" });
    model.calls = [];
    const app = platform(model);
    await assertRejects(
      () =>
        call === "stage"
          ? app.stage(ctx)
          : call === "expose"
          ? app.expose(10, ctx).then(() => {})
          : app.abort(ctx),
      Error,
      "the rollout's record is damaged",
    );
    assertEquals(model.calls, [], call);
  }
});

Deno.test("containerAppCanary: a record missing a part changes nothing", async () => {
  const keys: ReadonlyArray<readonly [key: string, value: JsonValue]> = [
    ["containerAppCanaryApp", "--x"],
    ["containerAppCanaryResourceGroup", ""],
    ["containerAppCanaryAzFlags", [1]],
    ["containerAppCanaryAppId", ""],
    // Neither can carry text into the recovery a refusal prints.
    [
      "containerAppCanaryAppId",
      "x`. Then run `az group delete --name rg-prod --yes`.",
    ],
    ["containerAppCanaryStable", "API"],
    // `--revision-weight` reads `latest` as the newest revision: a record
    // naming it would send a rollback's traffic to the candidate.
    ["containerAppCanaryStable", "latest"],
    ["containerAppCanaryCandidate", "--revision"],
    ["containerAppCanaryCandidate", "latest"],
    ["containerAppCanaryCandidateCreated", ""],
    ["containerAppCanaryCandidateCreated", "2026-10-19\nrun this"],
    ["containerAppCanaryFollowedLatest", "yes"],
  ];
  for (const [key, value] of keys) {
    const { model, ctx } = await staged();
    await ctx.state.set({ [key]: value });
    model.calls = [];
    await assertRejects(
      () => platform(model).expose(10, ctx),
      Error,
      "the rollout's record is damaged",
    );
    assertEquals(model.calls, [], key);
  }
});

Deno.test("containerAppCanary: a call configured for another app, group or subscription changes nothing", async () => {
  const changes: ReadonlyArray<
    readonly [
      label: string,
      change: (a: AzContainerAppCanarySettings) => AzContainerAppCanarySettings,
    ]
  > = [
    ["app", (a) => a.name("billing")],
    ["resource group", (a) => a.resourceGroup("rg-test")],
    [
      "az flags",
      (a) =>
        a.az((z) =>
          z.subscription("sub-test").runner(new ContainerAppModel().runner)
        ),
    ],
  ];
  for (const [label, change] of changes) {
    for (const call of ["expose", "promote", "abort"] as const) {
      const { model, ctx } = await staged();
      model.calls = [];
      const app = platform(model, change);
      const error = await assertRejects(
        () =>
          call === "expose"
            ? app.expose(10, ctx).then(() => {})
            : call === "promote"
            ? app.promote(ctx)
            : app.abort(ctx),
        Error,
        `this rollout staged with the ${label}`,
      );
      assertStringIncludes(
        error.message,
        "az containerapp ingress traffic set",
      );
      assertEquals(model.calls, [], `${label} ${call}`);
    }
  }
});

Deno.test("containerAppCanary: an app the CLI now reaches in another subscription is neither moved nor rolled back", async () => {
  // No flags: the CLI's default subscription decides, as `az account set` does.
  const model = new ContainerAppModel();
  const app = containerAppCanary((a) =>
    a.name("api").resourceGroup("rg-prod").image("acr.io/api:2")
      .az((z) => z.runner(model.runner))
  );
  const ctx = context();
  await app.stage(ctx);
  await app.expose(10, ctx);
  model.defaultSubscription = "sub-test";
  model.apps["sub-test/rg-prod/api"] = {
    mode: "Multiple",
    revisions: {},
    latest: "api--t1",
    image: "x",
    traffic: [{ latestRevision: true, weight: 100 }],
  };
  for (const call of ["expose", "promote", "abort"] as const) {
    model.calls = [];
    const error = await assertRejects(
      () =>
        call === "expose"
          ? app.expose(50, ctx).then(() => {})
          : call === "promote"
          ? app.promote(ctx)
          : app.abort(ctx),
      Error,
      "the app the Azure CLI reaches now is " +
        '"/subscriptions/sub-test/resourceGroups/rg-prod/providers/Microsoft.App/containerApps/api"',
    );
    assertStringIncludes(error.message, "This call changed nothing");
    assertEquals(model.mutations(), [], call);
  }
  assertEquals(model.shares(), { "api--v1": 90, "api--r1": 10 });
  assertEquals(model.shares("sub-test/rg-prod/api"), { "api--t1": 100 });
});

Deno.test("containerAppCanary: traffic changed by someone else is not moved", async () => {
  const changes: ReadonlyArray<
    readonly [
      label: string,
      change: (m: ContainerAppModel) => void,
      shows: string,
    ]
  > = [
    [
      "a third revision",
      (m) => m.api.traffic?.push({ revisionName: "api--v0", weight: 5 }),
      "api--v0",
    ],
    [
      "a label",
      (m) =>
        m.api.traffic?.push({ revisionName: "api--v1", weight: 1, label: "x" }),
      "api--v1",
    ],
    ["no ingress", (m) => m.api.traffic = null, "nothing"],
  ];
  for (const [label, change, shows] of changes) {
    for (const call of ["expose", "promote"] as const) {
      const { model, ctx } = await staged();
      await platform(model).expose(10, ctx);
      change(model);
      model.calls = [];
      const error = await assertRejects(
        () =>
          call === "expose"
            ? platform(model).expose(50, ctx).then(() => {})
            : platform(model).promote(ctx),
        Error,
        "something else changed it",
      );
      assertStringIncludes(error.message, shows);
      assertEquals(model.mutations(), [], `${label} ${call}`);
    }
  }
});

Deno.test("containerAppCanary: a candidate made again under its name is never sent traffic", async () => {
  for (const call of ["expose", "promote"] as const) {
    const { model, ctx } = await staged();
    model.api.revisions["api--v2"].created = "2026-10-20T00:00:00Z";
    model.calls = [];
    await assertRejects(
      () =>
        call === "expose"
          ? platform(model).expose(10, ctx).then(() => {})
          : platform(model).promote(ctx),
      Error,
      "the app was deleted and created again",
    );
    assertEquals(model.mutations(), [], call);
  }
  const { model, ctx } = await staged();
  delete model.api.revisions["api--v2"];
  await assertRejects(
    () => platform(model).expose(10, ctx),
    AzOutputError,
    "the app has no revision api--v2",
  );
});

Deno.test("containerAppCanary: a revision deployed mid-rollout is never promoted", async () => {
  const { model, ctx } = await staged();
  await platform(model).expose(10, ctx);
  model.api.latest = "api--v3";
  await assertRejects(
    () => platform(model).promote(ctx),
    Error,
    "the latest revision of api is api--v3, not the staged candidate",
  );
  assertEquals(model.shares(), { "api--v1": 90, "api--v2": 10 });
});

Deno.test("containerAppCanary: a rollback sends the traffic back to the stable revision by name", async () => {
  const { model, ctx } = await staged();
  await platform(model).expose(25, ctx);
  await platform(model).abort(ctx);
  assertEquals(model.trafficMoves().at(-1), ["api--v1=100", "api--v2=0"]);
  assertEquals(model.shares(), { "api--v1": 100 });
  // After a promote that handed traffic to latest, too.
  const promoted = await staged();
  await platform(promoted.model).promote(promoted.ctx);
  await platform(promoted.model).abort(promoted.ctx);
  assertEquals(promoted.model.shares(), { "api--v1": 100 });
});

Deno.test("containerAppCanary: a rollback never undoes a third revision's share", async () => {
  const { model, ctx } = await staged();
  await platform(model).expose(10, ctx);
  model.api.traffic?.push({ revisionName: "api--v9", weight: 5 });
  model.calls = [];
  await assertRejects(
    () => platform(model).abort(ctx),
    Error,
    "also sends traffic to api--v9",
  );
  assertEquals(model.mutations(), []);
});

Deno.test("containerAppCanary: a rollback run by hand goes to the configured stable revision", async () => {
  const model = new ContainerAppModel();
  await platform(model, (a) => a.stable("api--v1")).abort(context());
  assertEquals(model.trafficMoves(), [["api--v1=100"]]);
});

Deno.test("containerAppCanary: a rollback run by hand without a usable stable revision refuses", async () => {
  const model = new ContainerAppModel();
  await assertRejects(
    () => platform(model).abort(context()),
    Error,
    "a.stable('<revision>')",
  );
  for (const stable of ["API", "latest", "api", "api--"]) {
    await assertRejects(
      () => platform(model, (a) => a.stable(stable)).abort(context()),
      Error,
      "is not a Container Apps revision name",
    );
  }
  assertEquals(model.calls, []);
});

Deno.test("containerAppCanary: promote needs a staged rollout", async () => {
  const model = new ContainerAppModel();
  await assertRejects(
    () => platform(model).promote(context()),
    Error,
    "no staged candidate is recorded",
  );
  assertEquals(model.calls, []);
});

Deno.test("containerAppCanary: expose takes whole percents only, and a staged rollout", async () => {
  const model = new ContainerAppModel();
  for (const percent of [-1, 101, 12.5, Number.NaN]) {
    await assertRejects(
      () => platform(model).expose(percent, context()),
      Error,
      "whole percents from 0 to 100",
    );
  }
  await assertRejects(
    () => platform(model).expose(10, context()),
    Error,
    "the rollout's record is damaged",
  );
  assertEquals(model.calls, []);
});

Deno.test("containerAppCanary: an az lambda that resolves differently per command runs nothing it disagrees with", async () => {
  const { model, ctx } = await staged();
  let calls = 0;
  const flipping = containerAppCanary((a) =>
    a.name("api").resourceGroup("rg-prod").image("acr.io/api:2")
      .az((z) => {
        calls += 1;
        return z.subscription(calls > 1 ? "sub-test" : "sub-prod").runner(
          model.runner,
        );
      })
  );
  model.calls = [];
  await assertRejects(
    () => flipping.expose(10, ctx),
    Error,
    "gave this command other flags",
  );
  assertEquals(model.calls, []);
});

Deno.test("containerAppCanary: a failed traffic move fails the call even under noThrow", async () => {
  const { model, ctx } = await staged();
  const run = model.runner;
  const failing = containerAppCanary((a) =>
    a.name("api").resourceGroup("rg-prod").image("acr.io/api:2").az((z) =>
      z.subscription("sub-prod").noThrow().runner((s) =>
        s.argv().includes("ingress")
          ? Promise.resolve(new CommandOutput(1, "", "AuthorizationFailed"))
          : run(s)
      )
    )
  );
  await assertRejects(() => failing.expose(10, ctx), CommandError);
  await assertRejects(() => failing.abort(ctx), CommandError);
});

Deno.test("containerAppCanary: answers that are not what was asked for are refused", async () => {
  const ID =
    "/subscriptions/s/resourceGroups/rg/providers/Microsoft.App/containerApps/api";
  const base = {
    id: ID,
    mode: "Multiple",
    latest: "a",
    latestReady: "a",
    traffic: null,
  };
  const answers: ReadonlyArray<readonly [answer: unknown, message: string]> = [
    [[], "containerapp show did not answer with an object"],
    [{ ...base, id: undefined }, "reported no container app resource id"],
    [{ ...base, id: "/subscriptions/s" }, "no container app resource id"],
    [{ ...base, mode: undefined }, "no activeRevisionsMode"],
    [{ ...base, latest: undefined }, "no latestRevisionName"],
    [{ ...base, latestReady: undefined }, "no latestReadyRevisionName"],
    [{ ...base, traffic: {} }, "ingress traffic that is not a list"],
    [{ ...base, traffic: [1] }, "an ingress traffic entry is not an object"],
    [
      { ...base, traffic: [{ revisionName: "a" }] },
      "an ingress traffic entry has no weight",
    ],
    [
      { ...base, traffic: [{ weight: 100 }] },
      "names no revision and does not follow the latest one",
    ],
  ];
  const apps = answers.map((
    [answer, message],
  ): readonly [stdout: string, message: string] => [
    JSON.stringify(answer),
    message,
  ]);
  for (const [stdout, message] of apps) {
    const app = containerAppCanary((a) =>
      a.name("api").resourceGroup("rg").image("i").az((z) =>
        z.runner(() => Promise.resolve(new CommandOutput(0, stdout, "")))
      )
    );
    await assertRejects(() => app.stage(context()), AzOutputError, message);
  }
  const revisions: ReadonlyArray<readonly [stdout: string, message: string]> = [
    ['{"created":"c"}', "reported no provisioningState"],
    ['{"provisioning":"Provisioned"}', "reported no createdTime"],
    ['{"provisioning":"Provisioned","created":"yesterday"}', "no createdTime"],
  ];
  for (const [stdout, message] of revisions) {
    const model = new ContainerAppModel();
    const run = model.runner;
    const app = containerAppCanary((a) =>
      a.name("api").resourceGroup("rg-prod").image("acr.io/api:2").az((z) =>
        z.runner((s) =>
          s.argv().includes("revision")
            ? Promise.resolve(new CommandOutput(0, stdout, ""))
            : run(s)
        )
      )
    );
    await assertRejects(() => app.stage(context()), AzOutputError, message);
  }
});

Deno.test("containerAppCanary: with no .az(...) it runs the az CLI found on PATH", async () => {
  await withEmptyPath(async () => {
    const app = containerAppCanary((a) =>
      a.name("api").resourceGroup("rg").image("i")
    );
    await assertRejects(() => app.stage(context()), ToolNotFoundError);
  });
});

Deno.test("containerAppCanary: commands that change the app print nothing, whatever output the az lambda asks for", async () => {
  // `containerapp update` answers with the whole app, plain environment
  // variable values included, so it must never print.
  const model = new ContainerAppModel();
  const ctx = context();
  const app = platform(
    model,
    (a) =>
      a.az((z) =>
        z.subscription("sub-prod").output("table").runner(model.runner)
      ),
  );
  await app.stage(ctx);
  await app.expose(10, ctx);
  await app.promote(ctx);
  const changes = model.mutations();
  assertEquals(changes.length, 4);
  for (const argv of changes) {
    assertEquals(flagValue(argv, "--output"), "none", argv.join(" "));
    assertEquals(argv.includes("table"), false, argv.join(" "));
  }
});

Deno.test("containerAppCanary: an app whose newest revision has not provisioned is not staged", async () => {
  // Traffic that follows the latest revision goes to the newest ready one,
  // not to a newer revision that failed: pinning that one would move the
  // traffic, and record the wrong stable revision for every rollback.
  const model = new ContainerAppModel();
  model.api.revisions["api--bad"] = {
    created: "2026-10-10T00:00:00Z",
    provisioning: "Failed",
  };
  model.api.latest = "api--bad";
  model.api.latestReady = "api--v1";
  await assertRejects(
    () => platform(model).stage(context()),
    Error,
    "its newest revision is api--bad, which has not provisioned",
  );
  assertEquals(model.mutations(), []);
  assertEquals(model.shares(), { "api--v1": 100 });
});

Deno.test("containerAppCanary: traffic that followed latest is handed back only to a ready candidate", async () => {
  const { model, ctx } = await staged();
  await platform(model).expose(50, ctx);
  // The candidate is still the newest revision, but no longer the newest
  // ready one: "latest" would now send the traffic elsewhere.
  model.api.latestReady = "api--v1";
  model.calls = [];
  await assertRejects(
    () => platform(model).promote(ctx),
    Error,
    "the newest ready revision of api is api--v1, not the candidate api--v2",
  );
  assertEquals(model.mutations(), []);
  assertEquals(model.shares(), { "api--v1": 50, "api--v2": 50 });
});

Deno.test("containerAppCanary: a revision someone else deploys during stage is not taken for the candidate", async () => {
  const model = new ContainerAppModel();
  const racing: typeof model.runner = async (settings) => {
    const output = await model.runner(settings);
    const argv = settings.argv().slice(1);
    if (argv[1] === "update" && flagValue(argv, "--revision-suffix") === "v2") {
      model.run([
        "containerapp",
        "update",
        "--name=api",
        "--resource-group=rg-prod",
        "--image=acr.io/api:9",
        "--revision-suffix=x9",
      ]);
    }
    return output;
  };
  await assertRejects(
    () =>
      platform(
        model,
        (a) => a.az((z) => z.subscription("sub-prod").runner(racing)),
      ).stage(context()),
    Error,
    "the latest revision of api is api--x9, not api--v2, the one this " +
      "deploy made",
  );
  assertEquals(model.trafficMoves(), [["api--v1=100"]]);
  assertEquals(model.shares(), { "api--v1": 100 });
});

Deno.test("containerAppCanary: a stage run again over its record refuses an app the CLI now reaches elsewhere", async () => {
  const model = new ContainerAppModel();
  const ctx = context();
  const app = containerAppCanary((a) =>
    a.name("api").resourceGroup("rg-prod").image("acr.io/api:2")
      .az((z) => z.runner(model.runner))
  );
  await app.stage(ctx);
  model.defaultSubscription = "sub-test";
  model.apps["sub-test/rg-prod/api"] = { ...model.api, traffic: [] };
  model.calls = [];
  await assertRejects(
    () => app.stage(ctx),
    Error,
    "the app the Azure CLI reaches now is",
  );
  assertEquals(model.mutations(), []);
});

Deno.test("containerAppCanary: a promote run again after a newer deploy changes nothing", async () => {
  const { model, ctx } = await staged();
  await platform(model).expose(50, ctx);
  await platform(model).promote(ctx);
  model.run([
    "containerapp",
    "update",
    "--name=api",
    "--resource-group=rg-prod",
    "--image=acr.io/api:3",
    "--revision-suffix=v3",
  ]);
  model.calls = [];
  await assertRejects(
    () => platform(model).promote(ctx),
    Error,
    "something else changed it",
  );
  assertEquals(model.mutations(), []);
  assertEquals(model.shares(), { "api--v3": 100 });
});

Deno.test("containerAppCanary: a candidate name that is not a revision's never reaches a query", async () => {
  const model = new ContainerAppModel();
  const odd: typeof model.runner = async (settings) => {
    const output = await model.runner(settings);
    if (settings.argv()[2] === "update") model.api.latest = "api--v2'";
    return output;
  };
  // No revision suffix: with one, the name check refuses first.
  const app = containerAppCanary((a) =>
    a.name("api").resourceGroup("rg-prod").image("acr.io/api:2")
      .az((z) => z.runner(odd))
  );
  await assertRejects(
    () => app.stage(context()),
    Error,
    "is not a Container Apps revision name",
  );
  assertEquals(model.calls.some((argv) => argv[1] === "revision"), false);
});

Deno.test("containerAppCanary: the candidate image goes to the container named", async () => {
  const model = new ContainerAppModel();
  await platform(model, (a) => a.containerName("web")).stage(context());
  const update = model.calls.find((argv) => argv[1] === "update") ?? [];
  assertEquals(flagValue(update, "--container-name"), "web");
});

Deno.test("containerAppCanary: the recovery quotes what a shell would split", async () => {
  const model = new ContainerAppModel();
  model.apps["sub-prod/rg(prod)/api"] = model.api;
  const ctx = context();
  await platform(model, (a) => a.resourceGroup("rg(prod)")).stage(ctx);
  const error = await assertRejects(
    () => platform(model, (a) => a.resourceGroup("rg-test")).expose(10, ctx),
    Error,
    "this rollout staged with the resource group",
  );
  assertStringIncludes(error.message, "'--resource-group=rg(prod)'");
});

Deno.test("containerAppCanary: every write after the check goes to the subscription checked", async () => {
  // No flags: the CLI's default subscription decides — and another job
  // switches it between this call's read and its write.
  const model = new ContainerAppModel();
  model.apps["sub-test/rg-prod/api"] = {
    mode: "Multiple",
    revisions: {},
    latest: "api--t1",
    image: "x",
    traffic: [{ latestRevision: true, weight: 100 }],
  };
  const switching: typeof model.runner = async (settings) => {
    const output = await model.runner(settings);
    if (settings.argv()[2] === "revision") {
      model.defaultSubscription = "sub-test";
    }
    return output;
  };
  const app = containerAppCanary((a) =>
    a.name("api").resourceGroup("rg-prod").image("acr.io/api:2")
      .revisionSuffix("v2").az((z) => z.runner(switching))
  );
  const ctx = context();
  await app.stage(ctx);
  model.defaultSubscription = "sub-prod";
  await app.expose(50, ctx);
  assertEquals(model.shares(), { "api--v1": 50, "api--v2": 50 });
  assertEquals(model.shares("sub-test/rg-prod/api"), { "api--t1": 100 });
});

Deno.test("containerAppCanary: a stage resumed under another subscription refuses before it pins anything there", async () => {
  const model = new ContainerAppModel();
  model.apps["sub-test/rg-prod/api"] = {
    mode: "Multiple",
    revisions: {},
    latest: "api--t1",
    image: "x",
    traffic: [{ latestRevision: true, weight: 100 }],
  };
  let crash = true;
  const crashing: typeof model.runner = (settings) => {
    if (crash && settings.argv()[2] === "update") {
      crash = false;
      return Promise.reject(new Error("the runner died"));
    }
    return model.runner(settings);
  };
  const app = containerAppCanary((a) =>
    a.name("api").resourceGroup("rg-prod").image("acr.io/api:2")
      .az((z) => z.runner(crashing))
  );
  const ctx = context();
  await assertRejects(() => app.stage(ctx), Error, "the runner died");
  model.defaultSubscription = "sub-test";
  model.calls = [];
  await assertRejects(
    () => app.stage(ctx),
    Error,
    "the app the Azure CLI reaches now is",
  );
  assertEquals(model.mutations(), []);
  assertEquals(model.shares("sub-test/rg-prod/api"), { "api--t1": 100 });
});

Deno.test("containerAppCanary: the rollback of a stage that failed hands the traffic back to latest", async () => {
  // The deploy changed nothing, so no revision was made: once stage fails,
  // the pin is the only change left, and "latest" serves the same revision.
  const model = new ContainerAppModel();
  const ctx = context();
  const unchanged = containerAppCanary((a) =>
    a.name("api").resourceGroup("rg-prod").image("acr.io/api:1")
      .az((z) => z.subscription("sub-prod").runner(model.runner))
  );
  await assertRejects(
    () => unchanged.stage(ctx),
    Error,
    "the deploy made no new revision",
  );
  await unchanged.abort(ctx);
  assertEquals(model.trafficMoves(), [["api--v1=100"], ["latest=100"]]);
  assertEquals(model.api.traffic?.filter((entry) => entry.weight > 0), [
    { latestRevision: true, weight: 100 },
  ]);
  // Run again, it changes nothing more.
  await unchanged.abort(ctx);
  assertEquals(model.trafficMoves().length, 2);
});

Deno.test("containerAppCanary: the rollback of a stage that made a revision leaves the traffic pinned, and says so", async () => {
  const model = new ContainerAppModel();
  model.provisioning = "Failed";
  const ctx = context();
  await assertRejects(
    () => platform(model).stage(ctx),
    Error,
    "is Failed, not Provisioned",
  );
  await platform(model).abort(ctx);
  assertEquals(model.trafficMoves(), [["api--v1=100"]]);
  assertEquals(ctx.summary, { "Pinned to": "api--v1" });
});

Deno.test("containerAppCanary: the rollback of a failed stage leaves traffic pinned by name before as it is", async () => {
  const model = new ContainerAppModel();
  model.api.traffic = [{ revisionName: "api--v1", weight: 100 }];
  model.provisioning = "Failed";
  const ctx = context();
  await assertRejects(() => platform(model).stage(ctx), Error, "is Failed");
  model.calls = [];
  await platform(model).abort(ctx);
  assertEquals(model.calls, []);
});

Deno.test("containerAppCanary: the rollback of a stage that never pinned changes nothing", async () => {
  const model = new ContainerAppModel();
  const failing: typeof model.runner = (settings) =>
    settings.argv()[2] === "ingress"
      ? Promise.resolve(new CommandOutput(1, "", "ERROR: throttled"))
      : model.runner(settings);
  const app = platform(
    model,
    (a) => a.az((z) => z.subscription("sub-prod").runner(failing)),
  );
  const ctx = context();
  await assertRejects(() => app.stage(ctx), CommandError);
  model.calls = [];
  await app.abort(ctx);
  assertEquals(model.mutations(), []);
});

Deno.test("containerAppCanary: the rollback of a failed stage configured for another app refuses", async () => {
  const model = new ContainerAppModel();
  model.provisioning = "Failed";
  const ctx = context();
  await assertRejects(() => platform(model).stage(ctx), Error, "is Failed");
  model.calls = [];
  const error = await assertRejects(
    () => platform(model, (a) => a.resourceGroup("rg-test")).abort(ctx),
    Error,
    "this rollout staged with the resource group",
  );
  assertStringIncludes(error.message, "--revision-weight latest=100");
  assertEquals(model.calls, []);
});

/** A model and a platform whose first `containerapp update` dies. */
function crashingOnDeploy(
  model: ContainerAppModel,
  extra: (a: AzContainerAppCanarySettings) => AzContainerAppCanarySettings = (
    a,
  ) => a,
) {
  let crash = true;
  const crashing: typeof model.runner = (settings) => {
    if (crash && settings.argv()[2] === "update") {
      crash = false;
      return Promise.reject(new Error("the runner died"));
    }
    return model.runner(settings);
  };
  return platform(
    model,
    (a) => extra(a.az((z) => z.subscription("sub-prod").runner(crashing))),
  );
}

Deno.test("containerAppCanary: a stage run again after the pin refuses traffic someone else moved", async () => {
  const model = new ContainerAppModel();
  const ctx = context();
  const app = crashingOnDeploy(model);
  await assertRejects(() => app.stage(ctx), Error, "the runner died");
  model.api.revisions["api--v0"] = {
    created: "2026-09-01T00:00:00Z",
    provisioning: "Provisioned",
  };
  model.api.traffic = [{ revisionName: "api--v0", weight: 100 }];
  model.calls = [];
  await assertRejects(
    () => app.stage(ctx),
    Error,
    "traffic now goes to api--v0, not api--v1 as when this stage began",
  );
  assertEquals(model.mutations(), []);
});

Deno.test("containerAppCanary: a stage run again after a pin by name names nothing to undo", async () => {
  const model = new ContainerAppModel();
  model.api.traffic = [{ revisionName: "api--v1", weight: 100 }];
  const ctx = context();
  await assertRejects(
    () => crashingOnDeploy(model).stage(ctx),
    Error,
    "the runner died",
  );
  model.calls = [];
  const error = await assertRejects(
    () => platform(model, (a) => a.resourceGroup("rg-test")).stage(ctx),
    Error,
    "this rollout staged with the resource group",
  );
  assertStringIncludes(error.message, "so there is nothing to undo");
  assertEquals(model.calls, []);
});

Deno.test("containerAppCanary: a staged marker with no record changes nothing", async () => {
  const model = new ContainerAppModel();
  const ctx = context();
  await ctx.state.set({ containerAppCanaryStage: "staged" });
  await assertRejects(
    () => platform(model).expose(10, ctx),
    Error,
    "it does not hold the app it staged (it holds nothing)",
  );
  assertEquals(model.calls, []);
});

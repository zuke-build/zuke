// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import type { JsonValue, TargetStateHandle } from "@zuke/core";
import { CommandOutput } from "@zuke/core/shell";
import { ToolNotFoundError } from "@zuke/core/tooling";
import { missingTool } from "@zuke/core/tooling/conformance";
import {
  kubectlCanary,
  type KubectlCanarySettings,
  type KubectlSettings,
  type KubectlSettingsRunner,
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
 * A runner that records every command line (without the binary), answers the
 * stable-image read with `stableImage`, and fails any command `fails` picks.
 */
function fakeKubectl(
  stableImage = "reg/api:1",
  fails: (argv: string[]) => boolean = () => false,
): { runner: KubectlSettingsRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner = (settings: KubectlSettings): Promise<CommandOutput> => {
    const argv = settings.argv().slice(1);
    calls.push(argv);
    if (fails(argv)) {
      return Promise.reject(new Error(`kubectl failed: ${argv.join(" ")}`));
    }
    const stdout = argv[0] === "get" ? stableImage : "";
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
  runner: KubectlSettingsRunner,
  extra: (k: KubectlCanarySettings) => KubectlCanarySettings = (k) => k,
) {
  return kubectlCanary((k) =>
    extra(
      k.stable("api").canary("api-canary").container("api")
        .image("reg/api:2").replicas(10).namespace("prod")
        .kubectl((s) => s.context("prod-ctx")).runner(runner),
    )
  );
}

/** `--namespace prod --context prod-ctx`, the globals every call carries. */
const SCOPE = ["--namespace", "prod", "--context", "prod-ctx"];

const scale = (deployment: string, n: number) => [
  "scale",
  ...SCOPE,
  `--replicas=${n}`,
  `deployment/${deployment}`,
];
const status = (deployment: string, timeout = "5m") => [
  "rollout",
  "status",
  ...SCOPE,
  `deployment/${deployment}`,
  `--timeout=${timeout}`,
];
const setImage = (deployment: string, image: string) => [
  "set",
  "image",
  ...SCOPE,
  `deployment/${deployment}`,
  `api=${image}`,
];

Deno.test("stage reads the stable image, empties the canary and sets the candidate on it", async () => {
  const { runner, calls } = fakeKubectl("reg/api:1\n");
  const ctx = context();
  await platform(runner).stage(ctx);
  assertEquals(calls, [
    [
      "get",
      ...SCOPE,
      "deployment/api",
      "-o",
      'jsonpath={.spec.template.spec.containers[?(@.name=="api")].image}',
    ],
    scale("api-canary", 0),
    setImage("api-canary", "reg/api:2"),
  ]);
  assertEquals(ctx.state.get(), {
    kubectlCanaryStage: "staged",
    kubectlCanaryStableImage: "reg/api:1",
    kubectlCanaryCandidateImage: "reg/api:2",
  });
  assertEquals(ctx.summary, { Candidate: "reg/api:2", Stable: "reg/api:1" });
});

Deno.test("expose grows the canary, waits for it, then shrinks stable, and reports the share reached", async () => {
  const { runner, calls } = fakeKubectl();
  assertEquals(await platform(runner).expose(30), 30);
  assertEquals(calls, [
    scale("api-canary", 3),
    status("api-canary"),
    scale("api", 7),
  ]);
});

Deno.test("expose quantises to whole replicas and keeps one on each side", async () => {
  const cases: [number, number, number][] = [
    // [total, requested, achieved]
    [4, 10, 25], // 0.4 replicas rounds to 0; a step still exposes one
    [3, 50, 66.66666666666666], // 1.5 rounds to 2
    [4, 95, 75], // 3.8 rounds to 4, which would retire stable mid-rollout
    [10, 100, 100],
  ];
  for (const [total, requested, achieved] of cases) {
    const { runner, calls } = fakeKubectl();
    assertEquals(
      await platform(runner, (k) => k.replicas(total)).expose(requested),
      achieved,
    );
    const canary = Math.round((achieved * total) / 100);
    assertEquals(calls.at(-1), scale("api", total - canary));
  }
});

Deno.test("expose 0 returns every replica to stable before emptying the canary", async () => {
  const { runner, calls } = fakeKubectl();
  assertEquals(await platform(runner).expose(0), 0);
  assertEquals(calls, [
    scale("api", 10),
    status("api"),
    scale("api-canary", 0),
  ]);
});

Deno.test("expose refuses a share outside 0 to 100, and a split of one replica", async () => {
  const { runner, calls } = fakeKubectl();
  for (const bad of [-1, 101, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assertRejects(
      () => platform(runner).expose(bad),
      Error,
      "kubectlCanary: exposure is a percentage from 0 to 100",
    );
  }
  await assertRejects(
    () => platform(runner, (k) => k.replicas(1)).expose(50),
    Error,
    "Raise k.replicas(...) to at least 2",
  );
  assertEquals(calls, []);
});

Deno.test("an expose whose canary never becomes ready leaves stable at full size", async () => {
  const { runner, calls } = fakeKubectl(
    "reg/api:1",
    (argv) => argv[0] === "rollout",
  );
  await assertRejects(() => platform(runner).expose(30), Error, "kubectl");
  assertEquals(calls.length, 2);
  assertEquals(calls.some((argv) => argv.includes("deployment/api")), false);
});

Deno.test("promote puts the staged image on stable, grows it, waits, then empties the canary", async () => {
  const { runner, calls } = fakeKubectl();
  const ctx = context();
  await platform(runner).stage(ctx);
  // The lambda now names another image; the one analysed is promoted.
  await platform(runner, (k) => k.image("reg/api:9")).promote(ctx);
  assertEquals(calls.slice(3), [
    setImage("api", "reg/api:2"),
    scale("api", 10),
    status("api"),
    scale("api-canary", 0),
  ]);
  // Idempotent: the same commands again.
  await platform(runner).promote(ctx);
  assertEquals(calls.slice(7), calls.slice(3, 7));
});

Deno.test("promote with nothing staged refuses rather than guess", async () => {
  const { runner, calls } = fakeKubectl();
  await assertRejects(
    () => platform(runner).promote(context()),
    Error,
    "no staged candidate",
  );
  assertEquals(calls, []);
});

Deno.test("abort mid-rollout restores the stable image and size, then empties the canary", async () => {
  const { runner, calls } = fakeKubectl();
  const ctx = context();
  const p = platform(runner);
  await p.stage(ctx);
  await p.expose(30);
  await p.abort(ctx);
  await p.abort(ctx);
  const rollback = [
    setImage("api", "reg/api:1"),
    scale("api", 10),
    status("api"),
    scale("api-canary", 0),
  ];
  assertEquals(calls.slice(6), [...rollback, ...rollback]);
});

Deno.test("abort after a promote that failed part-way puts the stable image back", async () => {
  // Promote set the candidate on stable, then stable never became ready. The
  // engine rolls back with the stage's record — which must not leave stable
  // running the candidate while the summary says "Rolled back".
  let failStatus = true;
  const { runner, calls } = fakeKubectl(
    "reg/api:1",
    (argv) => failStatus && argv[0] === "rollout",
  );
  const ctx = context();
  const p = platform(runner);
  await p.stage(ctx);
  await assertRejects(() => p.promote(ctx), Error, "kubectl failed");
  failStatus = false;
  await p.abort(ctx);
  assertEquals(calls.slice(-4), [
    setImage("api", "reg/api:1"),
    scale("api", 10),
    status("api"),
    scale("api-canary", 0),
  ]);
});

Deno.test("a promote whose stable never becomes ready keeps the canary serving", async () => {
  const { runner, calls } = fakeKubectl(
    "reg/api:1",
    (argv) => argv[0] === "rollout",
  );
  const ctx = context();
  const p = platform(runner);
  await p.stage(ctx);
  await assertRejects(() => p.promote(ctx), Error, "rollout status");
  assertEquals(calls.at(-1), status("api"));
});

Deno.test("a stable image read that is not one image is refused", async () => {
  const { runner, calls } = fakeKubectl("reg/api:1 reg/api:2");
  await assertRejects(
    () => platform(runner).stage(context()),
    Error,
    "(the stable image) is not an image reference",
  );
  assertEquals(calls.length, 1);
});

Deno.test("a rollback empties the canary even when stable does not become ready", async () => {
  const { runner, calls } = fakeKubectl(
    "reg/api:1",
    (argv) => argv[0] === "rollout",
  );
  const ctx = context();
  const p = platform(runner);
  await p.stage(ctx);
  await assertRejects(() => p.abort(ctx), Error, "rollout status");
  assertEquals(calls.at(-1), scale("api-canary", 0));
});

Deno.test("abort after a stage that never recorded the candidate runs nothing", async () => {
  // The canary had no replicas and stable was never touched.
  const ctx = context();
  const failing = platform(() => Promise.reject(new Error("forbidden")));
  await assertRejects(() => failing.stage(ctx), Error, "forbidden");
  assertEquals(ctx.state.get(), { kubectlCanaryStage: "deploying" });
  const { runner, calls } = fakeKubectl();
  await platform(runner).abort(ctx);
  assertEquals(calls, []);
});

Deno.test("a stage that cannot record the candidate stops before the canary runs", async () => {
  const { runner, calls } = fakeKubectl();
  const ctx = context();
  ctx.state.trySet = () => Promise.resolve(false);
  await assertRejects(
    () => platform(runner).stage(ctx),
    Error,
    "could not record the staged candidate",
  );
  assertEquals(calls.length, 3);
  assertEquals(ctx.state.get(), { kubectlCanaryStage: "deploying" });
});

Deno.test("a hand-run abort restores the configured stable image", async () => {
  const { runner, calls } = fakeKubectl();
  await platform(runner, (k) => k.stableImage("reg/api:1")).abort(context());
  assertEquals(calls, [
    setImage("api", "reg/api:1"),
    scale("api", 10),
    status("api"),
    scale("api-canary", 0),
  ]);
});

Deno.test("a hand-run abort with no stable image refuses rather than claim a rollback", async () => {
  const { runner, calls } = fakeKubectl();
  await assertRejects(
    () => platform(runner).abort(context()),
    Error,
    "k.stableImage('<image>')",
  );
  await assertRejects(
    () => platform(runner, (k) => k.stableImage("x,api=evil")).abort(context()),
    Error,
    "is not an image reference",
  );
  assertEquals(calls, []);
});

Deno.test("a stable Deployment without the container is named at stage", async () => {
  const { runner, calls } = fakeKubectl("");
  const ctx = context();
  await assertRejects(
    () => platform(runner).stage(ctx),
    Error,
    'deployment/api has no container named "api"',
  );
  // Only the read ran; the canary was not touched.
  assertEquals(calls.length, 1);
});

Deno.test("a stable image read that came back truncated is refused", async () => {
  const p = platform(() =>
    Promise.resolve(new CommandOutput(0, "reg/api:1", "", true, 8))
  );
  await assertRejects(() => p.stage(context()), Error, "capture cap");
});

Deno.test("a non-zero exit fails the call even when kubectl was told not to throw", async () => {
  const p = platform(
    () => Promise.resolve(new CommandOutput(1, "", "error: forbidden\n")),
  );
  await assertRejects(
    () => p.expose(30),
    Error,
    "kubectlCanary: kubectl exited 1 running kubectl scale",
  );
  await assertRejects(
    () =>
      platform(() => Promise.resolve(new CommandOutput(2, "", ""))).expose(30),
    Error,
    "--replicas=3 deployment/api-canary.",
  );
});

Deno.test("the lambda is evaluated on every call, so it sees resolved values", async () => {
  const { runner, calls } = fakeKubectl();
  let image = "unresolved";
  const p = platform(runner, (k) => k.image(image));
  image = "reg/api:3";
  await p.stage(context());
  assertEquals(calls[2].at(-1), "api=reg/api:3");
});

Deno.test("missing and malformed settings are named before anything runs", async () => {
  const { runner, calls } = fakeKubectl();
  const refusals: [
    (k: KubectlCanarySettings) => KubectlCanarySettings,
    string,
  ][] = [
    [(k) => k.image(""), "no candidate image"],
    [(k) => k.image("-x"), "is not an image reference"],
    [(k) => k.canary("api"), 'both "api"'],
    [(k) => k.canary("api/x"), "must both be Deployment names"],
    [(k) => k.stable("-api"), "must both be Deployment names"],
    [(k) => k.container("*"), "is not a container name"],
    [(k) => k.container("a=b"), "is not a container name"],
    [(k) => k.namespace("Prod"), "is not a namespace name"],
    [(k) => k.timeout("5 minutes"), "is not a duration"],
  ];
  for (const [extra, message] of refusals) {
    await assertRejects(
      () => platform(runner, extra).stage(context()),
      Error,
      message,
    );
  }
  const unnamed: [
    (k: KubectlCanarySettings) => KubectlCanarySettings,
    string,
  ][] = [
    [(k) => k.container("api").runner(runner), "add k.stable('api')"],
    [(k) => k.stable("api").runner(runner), "add k.canary('api-canary')"],
    [
      (k) => k.stable("api").canary("c").runner(runner),
      "add k.container('api')",
    ],
  ];
  for (const [configure, message] of unnamed) {
    await assertRejects(
      () => kubectlCanary(configure).stage(context()),
      Error,
      message,
    );
  }
  for (const replicas of [0, 2.5]) {
    await assertRejects(
      () => platform(runner, (k) => k.replicas(replicas)).expose(50),
      Error,
      "must be a whole number of at least 1",
    );
  }
  await assertRejects(
    () =>
      kubectlCanary((k) =>
        k.stable("api").canary("c").container("api").runner(runner)
      ).expose(50),
    Error,
    "add k.replicas(n)",
  );
  assertEquals(calls, []);
});

Deno.test("timeout and the absence of a namespace reach the command line", async () => {
  const { runner, calls } = fakeKubectl();
  await kubectlCanary((k) =>
    k.stable("api").canary("api-canary").container("api").replicas(2)
      .timeout("1h30m").runner(runner)
  ).expose(50);
  assertEquals(calls, [
    ["scale", "--replicas=1", "deployment/api-canary"],
    ["rollout", "status", "deployment/api-canary", "--timeout=1h30m"],
    ["scale", "--replicas=1", "deployment/api"],
  ]);
});

Deno.test("describe names the deployments", () => {
  const { runner } = fakeKubectl();
  assertEquals(
    platform(runner).describe(),
    "Kubernetes deployment api (canary api-canary)",
  );
  assertEquals(
    kubectlCanary((k) => k.stable("api")).describe(),
    "Kubernetes deployment api",
  );
  assertEquals(kubectlCanary((k) => k).describe(), "Kubernetes deployment");
  assertEquals(platform(runner).exposure, "replicas");
});

Deno.test("the default runner runs kubectl itself", async () => {
  // The default is the settings' own run(), so a kubectl that is not
  // installed surfaces as the wrapper's usual tool-not-found error.
  const p = kubectlCanary((k) =>
    k.stable("api").canary("api-canary").container("api").replicas(2)
      .kubectl((s) => missingTool(s))
  );
  await assertRejects(() => p.expose(50), ToolNotFoundError);
});

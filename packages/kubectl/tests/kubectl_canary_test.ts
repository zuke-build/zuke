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

/** What the fake cluster answers, and which commands fail. */
interface Cluster {
  /** The stable Deployment's image for the container. */
  stableImage?: string;
  /** The canary Deployment's `.spec.replicas`. */
  canaryReplicas?: string;
  /** The Deployments whose `.spec.paused` is true. */
  paused?: string[];
  /** Commands that fail. */
  fails?: (argv: string[]) => boolean;
}

/**
 * A runner that records every command line (without the binary), answers the
 * jsonpath reads from `cluster`, and fails any command `cluster.fails` picks.
 */
function fakeKubectl(
  cluster: Cluster = {},
): { runner: KubectlSettingsRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner = (settings: KubectlSettings): Promise<CommandOutput> => {
    const argv = settings.argv().slice(1);
    calls.push(argv);
    if (cluster.fails?.(argv)) {
      return Promise.reject(new Error(`kubectl failed: ${argv.join(" ")}`));
    }
    let stdout = "";
    if (argv[0] === "get") {
      const path = argv.at(-1) ?? "";
      const deployment = argv.find((a) => a.startsWith("deployment/")) ?? "";
      if (path.endsWith(".image}")) stdout = cluster.stableImage ?? "reg/api:1";
      if (path === "jsonpath={.spec.replicas}") {
        stdout = cluster.canaryReplicas ?? "0";
      }
      if (
        path === "jsonpath={.spec.paused}" &&
        (cluster.paused ?? []).includes(deployment.slice("deployment/".length))
      ) {
        stdout = "true";
      }
    }
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
const read = (deployment: string, path: string) => [
  "get",
  ...SCOPE,
  `deployment/${deployment}`,
  "-o",
  `jsonpath={${path}}`,
];
const IMAGE_PATH = '.spec.template.spec.containers[?(@.name=="api")].image';
/** The reads every stage makes before it changes anything. */
const STAGE_READS = [
  read("api", IMAGE_PATH),
  read("api", ".spec.paused"),
  read("api-canary", ".spec.paused"),
  read("api-canary", ".spec.replicas"),
];
/** How many commands a successful stage runs. */
const STAGED = STAGE_READS.length + 1;
const setImage = (deployment: string, image: string) => [
  "set",
  "image",
  ...SCOPE,
  `deployment/${deployment}`,
  `api=${image}`,
];

Deno.test("stage reads the stable image, checks both Deployments, and sets the candidate on the empty canary", async () => {
  const { runner, calls } = fakeKubectl({ stableImage: "reg/api:1\n" });
  const ctx = context();
  await platform(runner).stage(ctx);
  assertEquals(calls, [...STAGE_READS, setImage("api-canary", "reg/api:2")]);
  assertEquals(ctx.state.get(), {
    kubectlCanaryStage: "staged",
    kubectlCanaryStableImage: "reg/api:1",
    kubectlCanaryCandidateImage: "reg/api:2",
    kubectlCanaryReplicas: 10,
    kubectlCanaryStable: "api",
    kubectlCanaryCanary: "api-canary",
    kubectlCanaryContainer: "api",
    kubectlCanaryNamespace: "prod",
  });
  assertEquals(ctx.summary, { Candidate: "reg/api:2", Stable: "reg/api:1" });
});

Deno.test("expose grows the canary, waits for it, then shrinks stable, and reports the share reached", async () => {
  const { runner, calls } = fakeKubectl();
  assertEquals(await platform(runner).expose(30, context()), 30);
  assertEquals(calls, [
    scale("api-canary", 3),
    status("api-canary"),
    scale("api", 7),
  ]);
});

Deno.test("expose quantises to whole replicas and keeps one on each side", async () => {
  const cases: [number, number, number][] = [
    // [total, requested, achieved]
    [5, 10, 20], // 0.5 replicas rounds up to one
    [3, 50, 66.66666666666666], // 1.5 rounds to 2
    [4, 95, 75], // 3.8 rounds to 4, which would retire stable mid-rollout
    [10, 100, 100],
  ];
  for (const [total, requested, achieved] of cases) {
    const { runner, calls } = fakeKubectl();
    assertEquals(
      await platform(runner, (k) => k.replicas(total)).expose(
        requested,
        context(),
      ),
      achieved,
    );
    const canary = Math.round((achieved * total) / 100);
    assertEquals(calls.at(-1), scale("api", total - canary));
  }
});

Deno.test("expose 0 returns every replica to stable before emptying the canary", async () => {
  const { runner, calls } = fakeKubectl();
  assertEquals(await platform(runner).expose(0, context()), 0);
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
      () => platform(runner).expose(bad, context()),
      Error,
      "kubectlCanary: exposure is a percentage from 0 to 100",
    );
  }
  await assertRejects(
    () => platform(runner, (k) => k.replicas(1)).expose(50, context()),
    Error,
    "Raise k.replicas(...) to at least 2",
  );
  assertEquals(calls, []);
});

Deno.test("expose refuses a step that asks for less than half a replica", async () => {
  // 4 replicas at 10 % is 0.4 of one: exposing one would be 25 %, two and a
  // half times what the step asked for.
  const { runner, calls } = fakeKubectl();
  await assertRejects(
    () => platform(runner, (k) => k.replicas(4)).expose(10, context()),
    Error,
    "a 10 % step needs k.replicas(5) or more",
  );
  await assertRejects(
    () => platform(runner, (k) => k.replicas(1)).expose(30, context()),
    Error,
    "a 30 % step needs k.replicas(2) or more",
  );
  assertEquals(calls, []);
});

Deno.test("an expose whose canary never becomes ready leaves stable at full size", async () => {
  const { runner, calls } = fakeKubectl({
    fails: (argv) => argv[0] === "rollout",
  });
  await assertRejects(
    () => platform(runner).expose(30, context()),
    Error,
    "kubectl failed: rollout status",
  );
  assertEquals(calls.length, 2);
  assertEquals(calls.some((argv) => argv.includes("deployment/api")), false);
});

Deno.test("promote puts the staged image on stable, grows it, waits, then empties the canary", async () => {
  const { runner, calls } = fakeKubectl();
  const ctx = context();
  await platform(runner).stage(ctx);
  // The lambda now names another image; the one analysed is promoted.
  await platform(runner, (k) => k.image("reg/api:9")).promote(ctx);
  assertEquals(calls.slice(STAGED), [
    setImage("api", "reg/api:2"),
    scale("api", 10),
    status("api"),
    scale("api-canary", 0),
  ]);
  // Idempotent: the same commands again.
  await platform(runner).promote(ctx);
  assertEquals(calls.slice(STAGED + 4), calls.slice(STAGED, STAGED + 4));
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
  await p.expose(30, ctx);
  await p.abort(ctx);
  await p.abort(ctx);
  const rollback = [
    setImage("api", "reg/api:1"),
    scale("api", 10),
    status("api"),
    scale("api-canary", 0),
  ];
  assertEquals(calls.slice(STAGED + 3), [...rollback, ...rollback]);
});

Deno.test("abort after a promote that failed part-way puts the stable image back", async () => {
  // Promote set the candidate on stable, then stable never became ready. The
  // engine rolls back with the stage's record — which must not leave stable
  // running the candidate while the summary says "Rolled back".
  let failStatus = true;
  const { runner, calls } = fakeKubectl({
    fails: (argv) => failStatus && argv[0] === "rollout",
  });
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
  const { runner, calls } = fakeKubectl({
    fails: (argv) => argv[0] === "rollout",
  });
  const ctx = context();
  const p = platform(runner);
  await p.stage(ctx);
  await assertRejects(() => p.promote(ctx), Error, "rollout status");
  assertEquals(calls.at(-1), status("api"));
});

Deno.test("a stable image read that is not one image is refused", async () => {
  const { runner, calls } = fakeKubectl({
    stableImage: "reg/api:1 reg/api:2",
  });
  await assertRejects(
    () => platform(runner).stage(context()),
    Error,
    "(the stable image) is not an image reference",
  );
  assertEquals(calls.length, 1);
});

Deno.test("a rollback empties the canary even when stable does not become ready", async () => {
  const { runner, calls } = fakeKubectl({
    fails: (argv) => argv[0] === "rollout",
  });
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
  assertEquals(calls.length, STAGED);
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
  const { runner, calls } = fakeKubectl({ stableImage: "" });
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
  await assertRejects(
    () => p.stage(context()),
    Error,
    "raise it with k.kubectl((s) => s.maxCapturedBytes(bytes))",
  );
});

Deno.test("a non-zero exit fails the call even when kubectl was told not to throw", async () => {
  const p = platform(
    () => Promise.resolve(new CommandOutput(1, "", "error: forbidden\n")),
  );
  await assertRejects(
    () => p.expose(30, context()),
    Error,
    "kubectlCanary: kubectl exited 1 running kubectl scale",
  );
  await assertRejects(
    () =>
      platform(() => Promise.resolve(new CommandOutput(2, "", ""))).expose(
        30,
        context(),
      ),
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
  assertEquals(calls[STAGED - 1].at(-1), "api=reg/api:3");
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
    [(k) => k.stable("a..b"), "must both be Deployment names"],
    [(k) => k.stable("a.-b"), "must both be Deployment names"],
    [(k) => k.canary("a-.b"), "must both be Deployment names"],
    [(k) => k.image("reg/api:2\u0007"), "is not an image reference"],
    [(k) => k.image("reg/api\u0085:2"), "is not an image reference"],
    [(k) => k.timeout("0s"), "between 1ms and 24h"],
    [(k) => k.timeout("25h"), "between 1ms and 24h"],
    [(k) => k.timeout("99999999999999999999h"), "between 1ms and 24h"],
    [(k) => k.replicas(2147483648), "a whole number from 1 to 2147483647"],
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
      () => platform(runner, (k) => k.replicas(replicas)).expose(50, context()),
      Error,
      "must be a whole number from 1 to 2147483647",
    );
  }
  await assertRejects(
    () =>
      kubectlCanary((k) =>
        k.stable("api").canary("c").container("api").runner(runner)
      ).expose(50, context()),
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
  ).expose(50, context());
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
  await assertRejects(() => p.expose(50, context()), ToolNotFoundError);
});

Deno.test("a stage refused by its own settings leaves a rollback with nothing to do", async () => {
  // The image parameter resolved empty. Stage changed nothing, so the inline
  // rollback must not take the hand-run path and roll production back to
  // stableImage.
  const { runner, calls } = fakeKubectl();
  const ctx = context();
  const p = platform(runner, (k) => k.image("").stableImage("reg/api:0"));
  await assertRejects(() => p.stage(ctx), Error, "no candidate image");
  assertEquals(ctx.state.get(), { kubectlCanaryStage: "deploying" });
  await p.abort(ctx);
  assertEquals(calls, []);
});

Deno.test("stage refuses a canary Deployment that still has replicas", async () => {
  // A leftover from an earlier rollout: scaling it away would drop serving
  // capacity while stable is below its total, and its image is not the
  // stable one.
  const { runner, calls } = fakeKubectl({ canaryReplicas: "3" });
  const ctx = context();
  const p = platform(runner);
  await assertRejects(
    () => p.stage(ctx),
    Error,
    "deployment/api-canary has 3 replicas",
  );
  await assertRejects(() => p.stage(ctx), Error, "zuke cancel <run-id>");
  assertEquals(calls, [...STAGE_READS, ...STAGE_READS]);
  await p.abort(ctx);
  assertEquals(calls.length, STAGE_READS.length * 2);
});

Deno.test("stage refuses a replica count it cannot read as a number", async () => {
  const { runner } = fakeKubectl({ canaryReplicas: "" });
  await assertRejects(
    () => platform(runner).stage(context()),
    Error,
    'not a replica count: ""',
  );
});

Deno.test("stage refuses a paused Deployment", async () => {
  for (const paused of ["api", "api-canary"]) {
    const { runner, calls } = fakeKubectl({ paused: [paused] });
    await assertRejects(
      () => platform(runner).stage(context()),
      Error,
      `deployment/${paused} is paused`,
    );
    assertEquals(calls.some((argv) => argv[0] !== "get"), false);
  }
});

Deno.test("expose sizes the step from the replica total stage recorded", async () => {
  // A resumed process whose parameter now resolves to 4 must not shrink stable
  // below the 10 replicas it had when the rollout started.
  const { runner, calls } = fakeKubectl();
  const ctx = context();
  await platform(runner).stage(ctx);
  const resumed = platform(runner, (k) => k.replicas(4));
  assertEquals(await resumed.expose(50, ctx), 50);
  assertEquals(await resumed.expose(0, ctx), 0);
  const sizes = calls.filter((argv) => argv[0] === "scale");
  assertEquals(sizes, [
    scale("api-canary", 5),
    scale("api", 5),
    scale("api", 10),
    scale("api-canary", 0),
  ]);
});

Deno.test("a staged rollout with a damaged record refuses rather than guess", async () => {
  // Reachable only through edited state; it must not read as a hand-run abort
  // or quietly fall back to the configured total.
  const { runner } = fakeKubectl();
  const badImage = context();
  await badImage.state.set({
    kubectlCanaryStage: "staged",
    kubectlCanaryReplicas: 10,
  });
  await assertRejects(
    () => platform(runner).abort(badImage),
    Error,
    "record of this rollout is incomplete",
  );
  const badTotal = context();
  await platform(runner).stage(badTotal);
  await badTotal.state.set({ kubectlCanaryReplicas: "4" });
  await assertRejects(
    () => platform(runner).abort(badTotal),
    Error,
    "record of this rollout is incomplete",
  );
});

Deno.test("promote and abort restore the replica total stage recorded", async () => {
  // A resumed or cancelling process whose parameter resolved differently, or
  // not at all, must still put stable back to the size it had.
  const { runner, calls } = fakeKubectl();
  const ctx = context();
  await platform(runner).stage(ctx);
  const later = kubectlCanary((k) =>
    k.stable("api").canary("api-canary").container("api").namespace("prod")
      .kubectl((s) => s.context("prod-ctx")).runner(runner)
  );
  await later.abort(ctx);
  await platform(runner, (k) => k.replicas(3)).promote(ctx);
  const sizes = calls.filter((argv) => argv.includes("deployment/api"))
    .filter((argv) => argv[0] === "scale");
  assertEquals(sizes, [scale("api", 10), scale("api", 10)]);
});

Deno.test("the recorded stable image wins over stableImage in a rollback", async () => {
  const { runner, calls } = fakeKubectl();
  const ctx = context();
  await platform(runner).stage(ctx);
  await platform(runner, (k) => k.stableImage("reg/api:0")).abort(ctx);
  assertEquals(calls[STAGED], setImage("api", "reg/api:1"));
});

Deno.test("images and totals read back from state are validated before use", async () => {
  const { runner, calls } = fakeKubectl();
  const tampered = context();
  await tampered.state.set({
    ...IDENTITY,
    kubectlCanaryStage: "staged",
    kubectlCanaryStableImage: "x,api=evil",
    kubectlCanaryCandidateImage: "-evil",
    kubectlCanaryReplicas: 10,
  });
  await assertRejects(
    () => platform(runner).abort(tampered),
    Error,
    '"x,api=evil" (the recorded stable image) is not an image reference',
  );
  await assertRejects(
    () => platform(runner).promote(tampered),
    Error,
    '"-evil" (the recorded candidate image) is not an image reference',
  );
  await tampered.state.set({
    kubectlCanaryStableImage: "reg/api:1",
    kubectlCanaryReplicas: 0,
  });
  await assertRejects(
    () => platform(runner).abort(tampered),
    Error,
    "a whole number from 1 to 2147483647",
  );
  assertEquals(calls, []);
});

/** What a stage of {@link platform}'s defaults records about the Deployments. */
const IDENTITY = {
  kubectlCanaryStable: "api",
  kubectlCanaryCanary: "api-canary",
  kubectlCanaryContainer: "api",
  kubectlCanaryNamespace: "prod",
};

Deno.test("a stage without a namespace records that it had none, and a rollback matches it", async () => {
  const { runner, calls } = fakeKubectl();
  const ctx = context();
  const p = kubectlCanary((k) =>
    k.stable("api").canary("api-canary").container("api").image("reg/api:2")
      .replicas(2).runner(runner)
  );
  await p.stage(ctx);
  assertEquals(ctx.state.get().kubectlCanaryNamespace, null);
  await p.abort(ctx);
  assertEquals(calls.at(-1), [
    "scale",
    "--replicas=0",
    "deployment/api-canary",
  ]);
});

Deno.test("a rollout configured for other Deployments than it was staged on refuses to act", async () => {
  // A resumed process, or a `zuke cancel`, whose configuration changed must
  // not set images on or scale a Deployment the rollout never touched — nor
  // restore the recorded stable image onto one.
  const changes: [
    (k: KubectlCanarySettings) => KubectlCanarySettings,
    string,
  ][] = [
    [(k) => k.stable("web"), 'the stable Deployment was "api", now "web"'],
    [
      (k) => k.canary("web-canary"),
      'the canary Deployment was "api-canary", now "web-canary"',
    ],
    [(k) => k.container("web"), 'the container was "api", now "web"'],
    [(k) => k.namespace("staging"), 'the namespace was "prod", now "staging"'],
  ];
  for (const [change, message] of changes) {
    const { runner, calls } = fakeKubectl();
    const ctx = context();
    await platform(runner).stage(ctx);
    const changed = platform(runner, change);
    await assertRejects(() => changed.expose(30, ctx), Error, message);
    await assertRejects(() => changed.promote(ctx), Error, message);
    await assertRejects(() => changed.abort(ctx), Error, message);
    await assertRejects(
      () => changed.abort(ctx),
      Error,
      "finished or cancelled with the configuration it started with",
    );
    await assertRejects(
      () => changed.abort(ctx),
      Error,
      '`zuke rollout.abort` and k.stableImage("reg/api:1")',
    );
    assertEquals(calls.length, STAGED);
  }
  const { runner, calls } = fakeKubectl();
  const ctx = context();
  await platform(runner).stage(ctx);
  const unscoped = kubectlCanary((k) =>
    k.stable("web").canary("api-canary").container("api").replicas(10)
      .runner(runner)
  );
  await assertRejects(
    () => unscoped.abort(ctx),
    Error,
    'the stable Deployment was "api", now "web"; the namespace was "prod", now none',
  );
  // A damaged stable image is not offered as the one to restore.
  await ctx.state.set({ kubectlCanaryStableImage: "x,api=evil" });
  await assertRejects(
    () => unscoped.abort(ctx),
    Error,
    "`zuke rollout.abort` and k.stableImage(...).",
  );
  assertEquals(calls.length, STAGED);
});

Deno.test("a staged record that does not say which Deployments it changed refuses", async () => {
  const damaged: Record<string, JsonValue>[] = [
    { kubectlCanaryStable: null },
    { kubectlCanaryCanary: "api/x" },
    { kubectlCanaryContainer: 7 },
    { kubectlCanaryNamespace: "Prod" },
    { kubectlCanaryNamespace: [] },
  ];
  const { runner, calls } = fakeKubectl();
  for (const patch of damaged) {
    const ctx = context();
    await platform(runner).stage(ctx);
    await ctx.state.set(patch);
    const p = platform(runner);
    for (const call of [() => p.expose(30, ctx), () => p.promote(ctx)]) {
      await assertRejects(call, Error, "record of this rollout is incomplete");
    }
    await assertRejects(
      () => p.abort(ctx),
      Error,
      "does not say which Deployments it changed",
    );
  }
  // A record that lost its namespace key is damaged, not "no namespace".
  const lost = context();
  await lost.state.set({
    kubectlCanaryStage: "staged",
    kubectlCanaryStable: "api",
    kubectlCanaryCanary: "api-canary",
    kubectlCanaryContainer: "api",
    kubectlCanaryStableImage: "reg/api:1",
    kubectlCanaryReplicas: 10,
  });
  await assertRejects(
    () =>
      kubectlCanary((k) =>
        k.stable("api").canary("api-canary").container("api").runner(runner)
      ).abort(lost),
    Error,
    "record of this rollout is incomplete",
  );
  assertEquals(calls.length, STAGED * damaged.length);
});

Deno.test("only a staged record is trusted: a stray image without the marker is ignored", async () => {
  // Promote needs the staged marker, and a rollback without one is the
  // hand-run kind, which uses the configured stable image.
  const { runner, calls } = fakeKubectl();
  const stray = context();
  await stray.state.set({
    kubectlCanaryCandidateImage: "reg/api:2",
    kubectlCanaryStableImage: "reg/api:7",
  });
  await assertRejects(
    () => platform(runner).promote(stray),
    Error,
    "no staged candidate",
  );
  await platform(runner, (k) => k.stableImage("reg/api:1")).abort(stray);
  assertEquals(calls[0], setImage("api", "reg/api:1"));
});

Deno.test("a staged record without a stable or candidate image refuses", async () => {
  const { runner, calls } = fakeKubectl();
  const ctx = context();
  await platform(runner).stage(ctx);
  await ctx.state.set({
    kubectlCanaryStableImage: "",
    kubectlCanaryCandidateImage: null,
  });
  await assertRejects(
    () => platform(runner).abort(ctx),
    Error,
    "does not say what api ran",
  );
  await ctx.state.set({ kubectlCanaryStableImage: null });
  await assertRejects(
    () => platform(runner).abort(ctx),
    Error,
    "does not say what api ran",
  );
  await assertRejects(
    () => platform(runner).promote(ctx),
    Error,
    "does not say which candidate it staged",
  );
  assertEquals(calls.length, STAGED);
});

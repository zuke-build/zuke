// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import type { JsonValue, TargetStateHandle } from "@zuke/core";
import { CommandOutput } from "@zuke/core/shell";
import { ToolNotFoundError } from "@zuke/core/tooling";
import { missingTool } from "@zuke/core/tooling/conformance";
import {
  helmCanary,
  type HelmCanarySettings,
  type HelmSettings,
  type HelmSettingsRunner,
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

/** What the fake helm knows about: each release's `get all` answer. */
interface Cluster {
  /** The stable release's `{{.Release.Version}} {{.Release.Info.Status}}`. */
  stable?: string;
  /** Whether the canary release exists. */
  canary?: boolean;
  /** Stderr for a failed canary read, when it is not "not found". */
  canaryError?: string;
}

/**
 * A runner that records every command line (without the binary) and answers
 * the `get all` reads from `cluster`.
 */
function fakeHelm(cluster: Cluster = {}): {
  runner: HelmSettingsRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const runner = (settings: HelmSettings): Promise<CommandOutput> => {
    const argv = settings.argv().slice(1);
    calls.push(argv);
    if (argv[0] !== "get") {
      return Promise.resolve(new CommandOutput(0, "", ""));
    }
    if (argv[2] === "api") {
      return Promise.resolve(
        new CommandOutput(0, cluster.stable ?? "7 deployed\n", ""),
      );
    }
    if (cluster.canary === true) {
      return Promise.resolve(new CommandOutput(0, "3", ""));
    }
    return Promise.resolve(
      new CommandOutput(
        1,
        "",
        cluster.canaryError ?? "Error: release: not found\n",
      ),
    );
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
  runner: HelmSettingsRunner,
  extra: (h: HelmCanarySettings) => HelmCanarySettings = (h) => h,
) {
  return helmCanary((h) =>
    extra(
      h.chart("./charts/api").stableRelease("api").namespace("prod")
        .image("1.5.0").replicas(4).helm((s) => s.kubeContext("k"))
        .runner(runner),
    )
  );
}

/** The releases and namespace `stage` records for the default platform. */
const IDENTITY: Record<string, JsonValue> = {
  helmStableRelease: "api",
  helmCanaryRelease: "api-canary",
  helmNamespace: "prod",
};

/** What `stage` records before the canary install, for the default platform. */
const DEPLOYING: Record<string, JsonValue> = {
  helmStage: "deploying",
  helmStableRevision: 7,
  ...IDENTITY,
};

/** The record `stage` writes for the default platform. */
const STAGED: Record<string, JsonValue> = {
  ...DEPLOYING,
  helmStage: "staged",
  helmImage: "1.5.0",
  helmReplicas: 4,
  helmChart: "./charts/api",
  helmVersion: null,
  helmStableChart: "./charts/api",
  helmStableVersion: null,
  helmValues: [],
  helmImageKey: "image.tag",
  helmReplicasKey: "replicaCount",
};

/** A context whose state records a finished stage, with `patch` over it. */
async function stagedContext(patch: Record<string, JsonValue> = {}) {
  const ctx = context();
  await ctx.state.set({ ...STAGED, ...patch });
  return ctx;
}

const SCOPE = ["--namespace", "prod", "--kube-context", "k"];
const STABLE_READ = [
  "get",
  "all",
  "api",
  ...SCOPE,
  "--template",
  "{{.Release.Version}} {{.Release.Info.Status}}",
];
const CANARY_READ = [
  "get",
  "all",
  "api-canary",
  ...SCOPE,
  "--template",
  "{{.Release.Version}}",
];
const UNINSTALL = ["uninstall", "api-canary", ...SCOPE, "--ignore-not-found"];

Deno.test("stage checks both releases, installs the canary at 0 replicas, and records what it staged", async () => {
  const { runner, calls } = fakeHelm();
  const ctx = context();
  await platform(runner, (h) => h.values("values-prod.yaml")).stage(ctx);
  assertEquals(calls, [
    STABLE_READ,
    CANARY_READ,
    [
      "upgrade",
      "api-canary",
      "./charts/api",
      ...SCOPE,
      "--values",
      "values-prod.yaml",
      "--set",
      "replicaCount=0",
      "--set-string",
      "image.tag=1.5.0",
      "--install",
      "--reset-then-reuse-values",
      "--wait",
    ],
  ]);
  assertEquals(ctx.state.get(), {
    ...STAGED,
    helmValues: ["values-prod.yaml"],
  });
  assertEquals(ctx.summary, { "Stable revision": 7 });
});

Deno.test("stage uses a custom canary release name throughout", async () => {
  const { runner, calls } = fakeHelm();
  const p = platform(runner, (h) => h.canaryRelease("api-next"));
  const ctx = context();
  await p.stage(ctx);
  await p.promote(ctx);
  assertEquals(calls.map((argv) => argv[0] === "get" ? argv[2] : argv[1]), [
    "api",
    "api-next",
    "api-next",
    "api",
    "api-next",
  ]);
});

Deno.test("stage refuses a stable release that is not deployed", async () => {
  for (const status of ["failed", "pending-upgrade", "uninstalled"]) {
    const { runner, calls } = fakeHelm({ stable: `7 ${status}` });
    const ctx = context();
    await assertRejects(
      () => platform(runner).stage(ctx),
      Error,
      `is ${status}, not deployed`,
    );
    assertEquals(calls.length, 1);
    assertEquals(ctx.state.get(), { helmStage: "reading" });
  }
});

Deno.test("stage refuses a canary release left over from an earlier rollout", async () => {
  const { runner, calls } = fakeHelm({ canary: true });
  const ctx = context();
  await assertRejects(
    () => platform(runner).stage(ctx),
    Error,
    "already exists, left by an earlier rollout",
  );
  assertEquals(calls, [STABLE_READ, CANARY_READ]);
  // Refused while nothing changed: a rollback runs nothing, and in
  // particular does not uninstall the release it refused to take over.
  const { runner: after, calls: undo } = fakeHelm();
  await platform(after).abort(ctx);
  assertEquals(undo, []);
});

Deno.test("stage reads only 'not found' as an absent canary release", async () => {
  const { runner, calls } = fakeHelm({
    canaryError: "Error: Kubernetes cluster unreachable",
  });
  await assertRejects(
    () => platform(runner).stage(context()),
    Error,
    "helm exited 1: Error: Kubernetes cluster unreachable",
  );
  assertEquals(calls.length, 2);
});

Deno.test("expose scales the canary up first, then the stable release down", async () => {
  const { runner, calls } = fakeHelm();
  const p = platform(
    runner,
    (h) => h.version("1.2.3").timeout("10m").replicasKey("deploy.replicas"),
  );
  const ctx = context();
  await p.stage(ctx);
  calls.length = 0;
  assertEquals(await p.expose(50, ctx), 50);
  assertEquals(calls, [
    [
      "upgrade",
      "api-canary",
      "./charts/api",
      ...SCOPE,
      "--set",
      "deploy.replicas=2",
      "--version",
      "1.2.3",
      "--reset-then-reuse-values",
      "--wait",
      "--timeout",
      "10m",
    ],
    [
      "upgrade",
      "api",
      "./charts/api",
      ...SCOPE,
      "--set",
      "deploy.replicas=2",
      "--version",
      "1.2.3",
      "--reset-then-reuse-values",
      "--history-max",
      "0",
    ],
  ]);
});

Deno.test("expose renders the stable release from its own chart when named", async () => {
  const configs: Array<(h: HelmCanarySettings) => HelmCanarySettings> = [
    (h) => h.version("2.0.0").stableChart("repo/api").stableVersion("1.9.0"),
    // The same chart at another version.
    (h) => h.version("2.0.0").stableVersion("1.9.0"),
  ];
  for (const config of configs) {
    const { runner, calls } = fakeHelm();
    const p = platform(runner, config);
    const ctx = context();
    await p.stage(ctx);
    await p.expose(25, ctx);
    const stable = calls[4];
    assertEquals(stable[1], "api");
    assertEquals(stable[stable.indexOf("--version") + 1], "1.9.0");
  }
});

Deno.test("expose quantises the staged count and reports the share achieved", async () => {
  const { runner, calls } = fakeHelm();
  // The configured count changed since stage; the staged one is used.
  const p = platform(runner, (h) => h.replicas(100));
  const ctx = await stagedContext({ helmReplicas: 3 });
  // 10 % of 3 rounds to 0, but a step above 0 always gets one pod.
  assertEquals(await p.expose(10, ctx), 33.33);
  assertEquals(await p.expose(0, ctx), 0);
  assertEquals(await p.expose(100, ctx), 100);
  const counts = calls.map((argv) => argv[argv.indexOf("--set") + 1]);
  assertEquals(counts, [
    "replicaCount=1",
    "replicaCount=2",
    "replicaCount=0",
    "replicaCount=3",
    "replicaCount=3",
    "replicaCount=0",
  ]);
});

Deno.test("expose refuses a share outside 0 to 100", async () => {
  const { runner, calls } = fakeHelm();
  for (const bad of [-1, 101, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assertRejects(
      () => platform(runner).expose(bad, context()),
      Error,
      "is not one",
    );
  }
  assertEquals(calls, []);
});

Deno.test("expose and promote refuse without a staged record, or with a broken one", async () => {
  const { runner, calls } = fakeHelm();
  await assertRejects(
    () => platform(runner).expose(10, context()),
    Error,
    "no staged canary is recorded",
  );
  await assertRejects(
    () => platform(runner).promote(context()),
    Error,
    "no staged canary is recorded",
  );
  const incomplete: Array<Record<string, JsonValue>> = [
    { helmImage: 1 },
    { helmReplicas: "4" },
    { helmChart: null },
    { helmVersion: 1 },
    { helmStableChart: 1 },
    { helmStableVersion: false },
    { helmValues: "values.yaml" },
    { helmValues: [1] },
    { helmImageKey: null },
    { helmReplicasKey: 4 },
  ];
  for (const patch of incomplete) {
    await assertRejects(
      async () => platform(runner).promote(await stagedContext(patch)),
      Error,
      "record of the staged candidate is incomplete",
    );
  }
  // A record of the right shape is checked again as the configuration is.
  const tampered: Array<[Record<string, JsonValue>, string]> = [
    [{ helmImage: "1.5,x=1" }, "is not an image reference or tag"],
    [{ helmReplicas: 0 }, "a whole number from 1 up (got 0)"],
    [{ helmChart: "-x" }, 'the chart "-x" is not a usable chart'],
    [{ helmStableChart: "" }, 'the stable chart "" is not a usable chart'],
    [{ helmVersion: "" }, "the chart's version is empty"],
    [{ helmValues: ["a,b.yaml"] }, "cannot be passed to helm"],
    [{ helmImageKey: "a[0]" }, '"a[0]" is not a values path'],
  ];
  for (const [patch, message] of tampered) {
    await assertRejects(
      async () => platform(runner).expose(10, await stagedContext(patch)),
      Error,
      message,
    );
  }
  assertEquals(calls, []);
});

Deno.test("promote moves the stable release to the staged image, then uninstalls the canary", async () => {
  const { runner, calls } = fakeHelm();
  // The configured image, chart and values changed since stage — a resumed
  // process with new parameters. The staged ones, analysed, are promoted.
  const p = platform(
    runner,
    (h) => h.values("values-other.yaml").image("9.9").chart("./charts/v2"),
  );
  const ctx = await stagedContext({ helmValues: ["values-prod.yaml"] });
  await p.promote(ctx);
  await p.promote(ctx);
  assertEquals(calls.slice(0, 2), [
    [
      "upgrade",
      "api",
      "./charts/api",
      ...SCOPE,
      "--values",
      "values-prod.yaml",
      "--set",
      "replicaCount=4",
      "--set-string",
      "image.tag=1.5.0",
      "--reset-then-reuse-values",
      "--history-max",
      "0",
      "--wait",
    ],
    UNINSTALL,
  ]);
  // Idempotent: the second promote repeats the same two commands.
  assertEquals(calls.slice(2), calls.slice(0, 2));
});

Deno.test("abort mid-rollout rolls the stable release back to the recorded revision", async () => {
  const { runner, calls } = fakeHelm();
  const ctx = context();
  const p = platform(runner, (h) => h.timeout("2m").stableRevision(1));
  await p.stage(ctx);
  await p.abort(ctx);
  await p.abort(ctx);
  const undo = calls.slice(3);
  assertEquals(undo.slice(0, 2), [
    [
      "rollback",
      "api",
      "7",
      ...SCOPE,
      "--wait",
      "--timeout",
      "2m",
      "--history-max",
      "0",
    ],
    UNINSTALL,
  ]);
  // Idempotent, and the recorded revision wins over the hand-run one.
  assertEquals(undo.slice(2), undo.slice(0, 2));
});

Deno.test("abort while the canary install was under way only uninstalls it", async () => {
  const ctx = context();
  const { runner: reads } = fakeHelm();
  const failing = platform((settings) =>
    settings.argv()[1] === "upgrade"
      ? Promise.reject(new Error("timed out: upgrade"))
      : reads(settings)
  );
  await assertRejects(() => failing.stage(ctx), Error, "timed out: upgrade");
  assertEquals(ctx.state.get(), DEPLOYING);
  const { runner, calls } = fakeHelm();
  await platform(runner).abort(ctx);
  assertEquals(calls, [UNINSTALL]);
});

Deno.test("a retried stage keeps the earlier attempt's record and its canary release", async () => {
  // A first attempt was cut short during the canary install, so the canary
  // release is this rollout's own: the retry does not refuse it as a
  // leftover, and a retry that fails reading still has it cleaned up.
  const { runner, calls } = fakeHelm({ canary: true });
  const ctx = context();
  await ctx.state.set(DEPLOYING);
  await platform(runner).stage(ctx);
  assertEquals(calls.some((argv) => argv[2] === "api-canary"), false);
  assertEquals(ctx.state.get().helmStage, "staged");

  const again = context();
  await again.state.set(DEPLOYING);
  const failing = platform(() => Promise.reject(new Error("unreachable")));
  await assertRejects(() => failing.stage(again), Error, "unreachable");
  assertEquals(again.state.get().helmStage, "deploying");
  const { runner: after, calls: undo } = fakeHelm();
  await platform(after).abort(again);
  assertEquals(undo, [UNINSTALL]);
});

Deno.test("a stage that fails before the canary install leaves a rollback nothing to do", async () => {
  // Configuration errors are caught after the marker is written, so even a
  // configured hand-run revision is not rolled back to.
  const bad: Array<(h: HelmCanarySettings) => HelmCanarySettings> = [
    (h) => h.image("1,5"),
    (h) => h.image(""),
    (h) => h.namespace(""),
    (h) => h.chart(""),
  ];
  for (const extra of bad) {
    const { runner, calls } = fakeHelm();
    const ctx = context();
    const p = platform(runner, (h) => extra(h).stableRevision(3));
    await assertRejects(() => p.stage(ctx), Error, "helmCanary:");
    assertEquals(ctx.state.get(), { helmStage: "reading" });
    await p.abort(ctx);
    assertEquals(calls, []);
  }
  const failing = platform(() =>
    Promise.reject(new Error("Error: release: not found"))
  );
  const ctx = context();
  await assertRejects(() => failing.stage(ctx), Error, "release: not found");
  const { runner, calls } = fakeHelm();
  await platform(runner, (h) => h.stableRevision(3)).abort(ctx);
  assertEquals(calls, []);
});

Deno.test("a revision read-back that is not a revision is refused before anything changes", async () => {
  for (
    const printed of ["", "0 deployed", "seven deployed", "7", "7\n8", "-1"]
  ) {
    const { runner, calls } = fakeHelm({ stable: printed });
    const ctx = context();
    await assertRejects(
      () => platform(runner).stage(ctx),
      Error,
      "not a revision and a status",
    );
    assertEquals(calls.length, 1);
    assertEquals(ctx.state.get(), { helmStage: "reading" });
  }
  const truncated = platform(() =>
    Promise.resolve(new CommandOutput(0, "7 deployed", "", true))
  );
  await assertRejects(
    () => truncated.stage(context()),
    Error,
    "not a revision and a status",
  );
});

Deno.test("a stage that cannot record itself staged stops before any exposure", async () => {
  const { runner, calls } = fakeHelm();
  const ctx = context();
  const record = ctx.state.trySet;
  // The "deploying" marker lands; the "staged" one does not.
  ctx.state.trySet = (patch) =>
    patch.helmStage === "staged" ? Promise.resolve(false) : record(patch);
  await assertRejects(
    () => platform(runner).stage(ctx),
    Error,
    "could not record that the canary release is staged",
  );
  assertEquals(calls.length, 3);
  assertEquals(ctx.summary, {});
});

Deno.test("a hand-run abort rolls back to the configured revision", async () => {
  const { runner, calls } = fakeHelm();
  await platform(runner, (h) => h.stableRevision(41)).abort(context());
  assertEquals(calls, [
    ["rollback", "api", "41", ...SCOPE, "--wait", "--history-max", "0"],
    UNINSTALL,
  ]);
});

Deno.test("a hand-run abort with no revision refuses rather than claim a rollback", async () => {
  const { runner, calls } = fakeHelm();
  await assertRejects(
    () => platform(runner).abort(context()),
    Error,
    "h.stableRevision(<n>)",
  );
  for (const [bad, shown] of [[0, "0"], [1.5, "1.5"], [Number.NaN, "NaN"]]) {
    await assertRejects(
      () =>
        platform(runner, (h) => h.stableRevision(Number(bad))).abort(context()),
      Error,
      `helmCanary: ${shown} is not a Helm revision`,
    );
  }
  assertEquals(calls, []);
});

Deno.test("abort refuses a record it does not recognise or that lacks the revision", async () => {
  const { runner, calls } = fakeHelm();
  const unknown = context();
  await unknown.state.set({ helmStage: "bogus" });
  await assertRejects(
    () => platform(runner, (h) => h.stableRevision(3)).abort(unknown),
    Error,
    'unrecognised stage "bogus"',
  );
  const partial = context();
  await partial.state.set({ helmStage: "staged", ...IDENTITY });
  await assertRejects(
    () => platform(runner, (h) => h.stableRevision(3)).abort(partial),
    Error,
    "no stable revision is recorded",
  );
  const tampered = context();
  await tampered.state.set({
    ...IDENTITY,
    helmStage: "staged",
    helmStableRevision: "7",
  });
  await assertRejects(
    () => platform(runner).abort(tampered),
    Error,
    '"7" is not a Helm revision',
  );
  assertEquals(calls, []);
});

Deno.test("the lambda is evaluated on every call, so it sees resolved values", async () => {
  const { runner, calls } = fakeHelm();
  let image = "unresolved,";
  const p = platform(runner, (h) => h.image(image));
  image = "1.6.0";
  await p.stage(context());
  assertEquals(calls[2].includes("image.tag=1.6.0"), true);
});

Deno.test("names, keys, files, versions, chart and image that would change argv meaning are refused", async () => {
  const { runner, calls } = fakeHelm();
  const cases: Array<[(h: HelmCanarySettings) => HelmCanarySettings, string]> =
    [
      [(h) => h.stableRelease("-api"), "comes from h.stableRelease(...)"],
      [(h) => h.stableRelease("Api"), "is not a Helm release name"],
      [(h) => h.canaryRelease("a".repeat(54)), "from h.canaryRelease(...)"],
      [
        (h) => h.stableRelease("a".repeat(50)),
        'the default canary release name "<stable>-canary"',
      ],
      [(h) => h.canaryRelease("api"), "cannot be the stable release"],
      [(h) => h.namespace(""), "is not a Kubernetes namespace"],
      [(h) => h.namespace("Prod"), "is not a Kubernetes namespace"],
      [(h) => h.namespace("a".repeat(64)), "is not a Kubernetes namespace"],
      [(h) => h.version(""), 'drop h.version("")'],
      [(h) => h.stableVersion(""), 'h.stableVersion("")'],
      [(h) => h.imageKey("image.tag,x=1"), "h.imageKey(...)"],
      [(h) => h.replicasKey("a[0]"), "h.replicasKey(...)"],
      [(h) => h.values("a.yaml,b.yaml"), "cannot be passed to helm"],
      [(h) => h.values('a"b.yaml'), "cannot be passed to helm"],
      [(h) => h.values("a\nb.yaml"), "cannot be passed to helm"],
      [(h) => h.values("a\rb.yaml"), "cannot be passed to helm"],
      [(h) => h.values(""), "cannot be passed to helm"],
      [(h) => h.chart("--post-renderer=x"), "add h.chart("],
      [(h) => h.chart(""), 'the chart "" is not a usable chart'],
      [(h) => h.stableChart("-x"), "add h.stableChart("],
      [(h) => h.image("1.5,x=1"), "is not an image reference or tag"],
      [(h) => h.image("-1"), "is not an image reference or tag"],
      [(h) => h.image("ghcr.io/o/api:1.5"), "looks like a full image"],
      [(h) => h.image("o/api@sha256:abc"), "looks like a full image"],
      [(h) => h.image("api:1.5@sha256:abc"), "looks like a full image"],
      [(h) => h.replicas(0), "h.replicas(10)"],
      [(h) => h.replicas(2.5), "h.replicas(10)"],
    ];
  for (const [bad, message] of cases) {
    await assertRejects(
      () => platform(runner, bad).stage(context()),
      Error,
      message,
    );
  }
  await assertRejects(
    () =>
      helmCanary((h) => h.chart("c").image("1").runner(runner)).stage(
        context(),
      ),
    Error,
    "no stable release named",
  );
  await assertRejects(
    () =>
      helmCanary((h) => h.chart("c").stableRelease("api").runner(runner))
        .stage(context()),
    Error,
    "no candidate image",
  );
  await assertRejects(
    () =>
      helmCanary((h) =>
        h.chart("c").stableRelease("api").image("1").runner(runner)
      ).stage(context()),
    Error,
    "got undefined",
  );
  assertEquals(calls, []);
});

Deno.test("tags as OCI allows them, digests, and full references at a key that takes one", async () => {
  for (
    const [key, image] of [
      ["image.tag", "_b"],
      ["image.tag", "1.5.0@sha256:abc"],
      ["tag", "v2"],
      ["image", "ghcr.io/o/api@sha256:abc"],
      ["image.repository", "ghcr.io/o/api:1.5"],
    ]
  ) {
    const { runner, calls } = fakeHelm();
    await platform(runner, (h) => h.imageKey(key).image(image)).stage(
      context(),
    );
    assertEquals(calls[2].includes(`${key}=${image}`), true);
  }
});

Deno.test("describe names the release and namespace", () => {
  const { runner } = fakeHelm();
  assertEquals(platform(runner).describe(), "Helm release api in prod");
  assertEquals(
    helmCanary((h) => h.stableRelease("api")).describe(),
    "Helm release api",
  );
  assertEquals(helmCanary((h) => h).describe(), "Helm release");
  assertEquals(platform(runner).exposure, "replicas");
});

Deno.test("the default runner runs helm itself", async () => {
  // The default is the settings' own run(), so a helm that is not installed
  // surfaces as the wrapper's usual tool-not-found error.
  const p = helmCanary((h) =>
    h.chart("c").stableRelease("api").namespace("prod").replicas(2)
      .helm((s) => missingTool(s))
  );
  const staged = await stagedContext();
  await assertRejects(
    () => p.expose(50, staged),
    ToolNotFoundError,
  );
});

/** `fakeHelm`, but every `verb` command exits 1 without throwing. */
function failingHelm(verb: string, cluster: Cluster = {}) {
  const { runner: reads, calls } = fakeHelm(cluster);
  const runner = (settings: HelmSettings): Promise<CommandOutput> =>
    settings.argv()[1] === verb
      ? (calls.push(settings.argv().slice(1)),
        Promise.resolve(new CommandOutput(1, "", "Error: boom\n")))
      : reads(settings);
  return { runner, calls };
}

Deno.test("a failed canary install is never recorded as staged, even when the runner does not throw", async () => {
  const { runner } = failingHelm("upgrade");
  const ctx = context();
  await assertRejects(
    () => platform(runner).stage(ctx),
    Error,
    "helmCanary: helm upgrade exited 1: Error: boom",
  );
  assertEquals(ctx.state.get().helmStage, "deploying");
  assertEquals(ctx.summary, {});
});

Deno.test("expose, promote and abort fail on a command that exited non-zero", async () => {
  for (const verb of ["upgrade", "uninstall"]) {
    const { runner } = failingHelm(verb);
    await assertRejects(
      async () => platform(runner).promote(await stagedContext()),
      Error,
      `helmCanary: helm ${verb} exited 1: Error: boom`,
    );
  }
  const { runner: upgrade } = failingHelm("upgrade");
  await assertRejects(
    async () => platform(upgrade).expose(50, await stagedContext()),
    Error,
    "helmCanary: helm upgrade exited 1: Error: boom",
  );
  const { runner: rollback, calls } = failingHelm("rollback");
  await assertRejects(
    async () => platform(rollback).abort(await stagedContext()),
    Error,
    "helmCanary: helm rollback exited 1: Error: boom",
  );
  // The canary release is left for the retry; nothing claims a rollback.
  assertEquals(calls.map((argv) => argv[0]), ["rollback"]);
  const { runner: uninstall } = failingHelm("uninstall");
  const deploying = context();
  await deploying.state.set(DEPLOYING);
  await assertRejects(
    () => platform(uninstall).abort(deploying),
    Error,
    "helmCanary: helm uninstall exited 1: Error: boom",
  );
  const { runner: read } = failingHelm("get");
  await assertRejects(
    () => platform(read).stage(context()),
    Error,
    "helmCanary: helm get all exited 1: Error: boom",
  );
});

Deno.test("a .noThrow() in the helm lambda does not hide a failed rollback", async () => {
  // The running deno stands in for helm: `deno rollback …` exits 1, and the
  // lambda asks run() not to throw on it.
  const p = helmCanary((h) =>
    h.stableRelease("api").namespace("prod").helm((s) =>
      s.noThrow().quiet().toolPath(Deno.execPath())
    )
  );
  await assertRejects(
    async () => p.abort(await stagedContext()),
    Error,
    "helmCanary: helm rollback exited 1",
  );
});

Deno.test("expose and promote use the chart, values and keys stage recorded, not the current configuration", async () => {
  const { runner, calls } = fakeHelm();
  let chart = "./charts/v1";
  let key = "image.tag";
  let file = "values-v1.yaml";
  let replicas = "replicaCount";
  let version = "1.0.0";
  const p = platform(
    runner,
    (h) =>
      h.chart(chart).version(version).values(file).imageKey(key)
        .replicasKey(replicas),
  );
  const ctx = context();
  await p.stage(ctx);
  chart = "./charts/v2";
  key = "app.tag";
  file = "values-v2.yaml";
  replicas = "app.replicas";
  version = "2.0.0";
  calls.length = 0;
  await p.expose(50, ctx);
  await p.promote(ctx);
  assertEquals(calls, [
    [
      "upgrade",
      "api-canary",
      "./charts/v1",
      ...SCOPE,
      "--set",
      "replicaCount=2",
      "--version",
      "1.0.0",
      "--reset-then-reuse-values",
      "--wait",
    ],
    [
      "upgrade",
      "api",
      "./charts/v1",
      ...SCOPE,
      "--set",
      "replicaCount=2",
      "--version",
      "1.0.0",
      "--reset-then-reuse-values",
      "--history-max",
      "0",
    ],
    [
      "upgrade",
      "api",
      "./charts/v1",
      ...SCOPE,
      "--values",
      "values-v1.yaml",
      "--set",
      "replicaCount=4",
      "--set-string",
      "image.tag=1.5.0",
      "--version",
      "1.0.0",
      "--reset-then-reuse-values",
      "--history-max",
      "0",
      "--wait",
    ],
    UNINSTALL,
  ]);
});

Deno.test("a stable chart from a repository must be pinned with stableVersion", async () => {
  for (const ref of ["repo/api", "oci://ghcr.io/o/api", "charts/api"]) {
    const { runner, calls } = fakeHelm();
    await assertRejects(
      () => platform(runner, (h) => h.stableChart(ref)).stage(context()),
      Error,
      "h.stableVersion(...)",
    );
    assertEquals(calls, []);
  }
  for (const ref of ["./charts/api-v1", "../api-v1", "/srv/charts/api-v1"]) {
    const { runner, calls } = fakeHelm();
    const p = platform(runner, (h) => h.version("2.0.0").stableChart(ref));
    const ctx = context();
    await p.stage(ctx);
    await p.expose(25, ctx);
    assertEquals(calls[4].slice(0, 3), ["upgrade", "api", ref]);
    assertEquals(calls[4].includes("--version"), false);
  }
});

Deno.test("a stage that cannot record the canary install starting runs no install", async () => {
  const { runner, calls } = fakeHelm();
  const ctx = context();
  ctx.state.trySet = () => Promise.resolve(false);
  await assertRejects(
    () => platform(runner).stage(ctx),
    Error,
    "could not record that the canary install is starting",
  );
  assertEquals(calls, [STABLE_READ, CANARY_READ]);
  assertEquals(ctx.state.get(), { helmStage: "reading" });
});

Deno.test("a candidate chart from a repository must be pinned with version", async () => {
  for (const ref of ["repo/api", "oci://ghcr.io/o/api", "charts/api"]) {
    const { runner, calls } = fakeHelm();
    const ctx = context();
    await assertRejects(
      () => platform(runner, (h) => h.chart(ref)).stage(ctx),
      Error,
      "h.version(...)",
    );
    assertEquals(calls, []);
    assertEquals(ctx.state.get(), { helmStage: "reading" });
  }
  const { runner, calls } = fakeHelm();
  await platform(runner, (h) => h.chart("oci://ghcr.io/o/api").version("2.0.0"))
    .stage(context());
  assertEquals(calls[2].slice(0, 3), [
    "upgrade",
    "api-canary",
    "oci://ghcr.io/o/api",
  ]);
});

/** Configuration changes a resumed process could carry, and what they move. */
const MOVED: Array<[(h: HelmCanarySettings) => HelmCanarySettings, string]> = [
  [(h) => h.stableRelease("web"), 'stable release "api"'],
  [(h) => h.canaryRelease("api-next"), 'canary release "api-canary"'],
  [(h) => h.namespace("staging"), 'namespace "prod"'],
];

Deno.test("expose, promote and abort refuse a release identity that changed since stage", async () => {
  for (const [moved, recorded] of MOVED) {
    const { runner, calls } = fakeHelm();
    const ctx = context();
    await platform(runner).stage(ctx);
    calls.length = 0;
    const changed = platform(runner, moved);
    for (
      const call of [
        () => changed.expose(50, ctx),
        () => changed.promote(ctx),
        () => changed.abort(ctx),
        () => changed.stage(ctx),
      ]
    ) {
      const error = await assertRejects(call, Error, recorded);
      assertEquals(
        error.message.includes("with the configuration it started with"),
        true,
      );
    }
    assertEquals(calls, []);
  }
});

Deno.test("a rollback of a canary install under way refuses a changed identity", async () => {
  for (const [moved, recorded] of MOVED) {
    const ctx = context();
    const { runner: reads } = fakeHelm();
    const failing = platform((settings) =>
      settings.argv()[1] === "upgrade"
        ? Promise.reject(new Error("timed out: upgrade"))
        : reads(settings)
    );
    await assertRejects(() => failing.stage(ctx), Error, "timed out");
    const { runner, calls } = fakeHelm();
    await assertRejects(
      () => platform(runner, moved).abort(ctx),
      Error,
      recorded,
    );
    assertEquals(calls, []);
  }
});

Deno.test("a record without the release identity is damaged, and refused", async () => {
  const { runner, calls } = fakeHelm();
  for (
    const key of ["helmStableRelease", "helmCanaryRelease", "helmNamespace"]
  ) {
    const ctx = context();
    await platform(runner).stage(ctx);
    const state = ctx.state.get();
    delete state[key];
    const damaged = context();
    await damaged.state.set(state);
    calls.length = 0;
    await assertRejects(
      () => platform(runner).abort(damaged),
      Error,
      "the rollout's record",
    );
    assertEquals(calls, []);
  }
});

Deno.test("a recorded chart with no version that is not a local path is refused as damaged", async () => {
  const { runner, calls } = fakeHelm();
  const unpinned: Array<Record<string, JsonValue>> = [
    { helmChart: "repo/api", helmVersion: null },
    { helmStableChart: "oci://ghcr.io/o/api", helmStableVersion: null },
  ];
  for (const patch of unpinned) {
    await assertRejects(
      async () => platform(runner).promote(await stagedContext(patch)),
      Error,
      "the rollout's record of the staged candidate is damaged:",
    );
  }
  assertEquals(calls, []);
});

Deno.test("a damaged record is reported as damaged, not as a setting to change", async () => {
  const { runner } = fakeHelm();
  const tampered: Array<Record<string, JsonValue>> = [
    { helmImage: "1.5,x=1" },
    { helmImage: "ghcr.io/o/api:1.5" },
    { helmReplicas: 0 },
    { helmChart: "-x" },
    { helmStableChart: "" },
    { helmVersion: "" },
    { helmValues: ["a,b.yaml"] },
    { helmImageKey: "a[0]" },
  ];
  for (const patch of tampered) {
    const error = await assertRejects(
      async () => platform(runner).expose(10, await stagedContext(patch)),
      Error,
      "the rollout's record of the staged candidate is damaged:",
    );
    assertEquals(error.message.includes("h."), false, error.message);
  }
});

Deno.test("Windows drive paths count as local charts", async () => {
  for (const ref of ["C:\\charts\\api", "d:/charts/api", ".\\charts\\api"]) {
    const { runner, calls } = fakeHelm();
    await platform(runner, (h) => h.chart(ref)).stage(context());
    assertEquals(calls[2][2], ref);
  }
  const { runner } = fakeHelm();
  await assertRejects(
    () => platform(runner, (h) => h.chart("C:charts")).stage(context()),
    Error,
    "h.version(...)",
  );
});

Deno.test("a rollout started in helm's default namespace refuses a namespace added later", async () => {
  const { runner, calls } = fakeHelm();
  const unscoped = (h: HelmCanarySettings) =>
    h.chart("./charts/api").stableRelease("api").image("1.5.0").replicas(4)
      .runner(runner);
  const ctx = context();
  await helmCanary(unscoped).stage(ctx);
  assertEquals(ctx.state.get().helmNamespace, null);
  calls.length = 0;
  await assertRejects(
    () => helmCanary((h) => unscoped(h).namespace("prod")).expose(50, ctx),
    Error,
    `the namespace helm's default, but it is now configured with "prod"`,
  );
  assertEquals(calls, []);
  await assertRejects(
    () =>
      helmCanary((h) => h.stableRelease("api").image("1").replicas(1)).stage(
        context(),
      ),
    Error,
    "no chart is set",
  );
});

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

/** A context whose state records a finished stage, as `stage` writes it. */
async function stagedContext(image = "1.5.0", total = 4) {
  const ctx = context();
  await ctx.state.set({
    helmStage: "staged",
    helmStableRevision: 7,
    helmImage: image,
    helmReplicas: total,
  });
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
    helmStage: "staged",
    helmStableRevision: 7,
    helmImage: "1.5.0",
    helmReplicas: 4,
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
  assertEquals(await p.expose(50, await stagedContext()), 50);
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
  const { runner, calls } = fakeHelm();
  const ctx = await stagedContext();
  await platform(
    runner,
    (h) => h.version("2.0.0").stableChart("repo/api").stableVersion("1.9.0"),
  ).expose(25, ctx);
  assertEquals(calls[1].slice(0, 3), ["upgrade", "api", "repo/api"]);
  assertEquals(calls[1][calls[1].indexOf("--version") + 1], "1.9.0");
  // A stable chart without a version takes none — not the candidate's.
  await platform(
    runner,
    (h) => h.version("2.0.0").stableChart("./charts/api-v1"),
  ).expose(25, ctx);
  assertEquals(calls[3].includes("--version"), false);
  // The same chart at another version.
  await platform(runner, (h) => h.version("2.0.0").stableVersion("1.9.0"))
    .expose(25, ctx);
  assertEquals(calls[5].slice(0, 3), ["upgrade", "api", "./charts/api"]);
  assertEquals(calls[5][calls[5].indexOf("--version") + 1], "1.9.0");
});

Deno.test("expose quantises the staged count and reports the share achieved", async () => {
  const { runner, calls } = fakeHelm();
  // The configured count changed since stage; the staged one is used.
  const p = platform(runner, (h) => h.replicas(100));
  const ctx = await stagedContext("1.5.0", 3);
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
  const patches: Array<Record<string, JsonValue>> = [
    { helmImage: 1 },
    { helmReplicas: "4" },
    { helmReplicas: 0 },
  ];
  for (const patch of patches) {
    const ctx = await stagedContext();
    await ctx.state.set(patch);
    await assertRejects(
      () => platform(runner).promote(ctx),
      Error,
      "record of the staged image and replica count is incomplete",
    );
  }
  const tampered = await stagedContext("1.5,x=1");
  await assertRejects(
    () => platform(runner).promote(tampered),
    Error,
    "is not an image reference or tag",
  );
  assertEquals(calls, []);
});

Deno.test("promote moves the stable release to the staged image, then uninstalls the canary", async () => {
  const { runner, calls } = fakeHelm();
  // The configured image changed since stage — a resumed process with a new
  // parameter. The staged one, the one analysed, is promoted.
  const p = platform(runner, (h) => h.values("values-prod.yaml").image("9.9"));
  const ctx = await stagedContext("1.5.0", 4);
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
  assertEquals(ctx.state.get(), {
    helmStage: "deploying",
    helmStableRevision: 7,
  });
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
  await ctx.state.set({ helmStage: "deploying", helmStableRevision: 7 });
  await platform(runner).stage(ctx);
  assertEquals(calls.some((argv) => argv[2] === "api-canary"), false);
  assertEquals(ctx.state.get().helmStage, "staged");

  const again = context();
  await again.state.set({ helmStage: "deploying", helmStableRevision: 7 });
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
  ctx.state.trySet = () => Promise.resolve(false);
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
  await partial.state.set({ helmStage: "staged" });
  await assertRejects(
    () => platform(runner, (h) => h.stableRevision(3)).abort(partial),
    Error,
    "no stable revision is recorded",
  );
  const tampered = context();
  await tampered.state.set({ helmStage: "staged", helmStableRevision: "7" });
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
      [(h) => h.version(""), 'h.version("") names no chart version'],
      [(h) => h.stableVersion(""), 'h.stableVersion("")'],
      [(h) => h.imageKey("image.tag,x=1"), "h.imageKey(...)"],
      [(h) => h.replicasKey("a[0]"), "h.replicasKey(...)"],
      [(h) => h.values("a.yaml,b.yaml"), "cannot be passed to helm"],
      [(h) => h.values('a"b.yaml'), "cannot be passed to helm"],
      [(h) => h.values("a\nb.yaml"), "cannot be passed to helm"],
      [(h) => h.values("a\rb.yaml"), "cannot be passed to helm"],
      [(h) => h.values(""), "cannot be passed to helm"],
      [(h) => h.chart("--post-renderer=x"), "add h.chart("],
      [(h) => h.chart(""), "no usable chart"],
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
  const staged = await stagedContext();
  await assertRejects(
    () => platform(runner, (h) => h.stableChart("-x")).expose(10, staged),
    Error,
    "add h.stableChart(",
  );
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
    h.chart("c").stableRelease("api").replicas(2).helm((s) => missingTool(s))
  );
  const staged = await stagedContext();
  await assertRejects(
    () => p.expose(50, staged),
    ToolNotFoundError,
  );
});

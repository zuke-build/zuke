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

/**
 * A runner that records every command line (without the binary) and answers
 * a revision read-back with `revision`.
 */
function fakeHelm(revision = "7"): {
  runner: HelmSettingsRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const runner = (settings: HelmSettings): Promise<CommandOutput> => {
    const argv = settings.argv().slice(1);
    calls.push(argv);
    const stdout = argv[0] === "get" ? revision : "";
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

const SCOPE = ["--namespace", "prod", "--kube-context", "k"];

Deno.test("stage records the stable revision, then installs the canary at 0 replicas", async () => {
  const { runner, calls } = fakeHelm("7\n");
  const ctx = context();
  await platform(runner, (h) => h.values("values-prod.yaml")).stage(ctx);
  assertEquals(calls, [
    ["get", "all", "api", ...SCOPE, "--template", "{{.Release.Version}}"],
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
      "--wait",
    ],
  ]);
  assertEquals(ctx.state.get(), {
    helmStage: "staged",
    helmStableRevision: 7,
  });
  assertEquals(ctx.summary, { "Stable revision": 7 });
});

Deno.test("expose scales the canary up first, then the stable release down", async () => {
  const { runner, calls } = fakeHelm();
  const p = platform(
    runner,
    (h) => h.version("1.2.3").timeout("10m").replicasKey("deploy.replicas"),
  );
  assertEquals(await p.expose(50), 50);
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
      "--reuse-values",
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
      "--reuse-values",
    ],
  ]);
});

Deno.test("expose quantises to whole replicas and reports the share achieved", async () => {
  const { runner, calls } = fakeHelm();
  const p = platform(runner, (h) => h.replicas(3));
  // 10 % of 3 rounds to 0, but a step above 0 always gets one pod.
  assertEquals(await p.expose(10), 33.33);
  assertEquals(await p.expose(0), 0);
  assertEquals(await p.expose(100), 100);
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

Deno.test("expose refuses a share outside 0 to 100, and a bad replica count", async () => {
  const { runner, calls } = fakeHelm();
  for (const bad of [-1, 101, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assertRejects(
      () => platform(runner).expose(bad),
      Error,
      "is not one",
    );
  }
  for (const total of [0, 2.5, -3]) {
    await assertRejects(
      () => platform(runner, (h) => h.replicas(total)).expose(10),
      Error,
      "h.replicas(10)",
    );
  }
  await assertRejects(
    () =>
      helmCanary((h) => h.chart("c").stableRelease("api").runner(runner))
        .expose(10),
    Error,
    "got undefined",
  );
  assertEquals(calls, []);
});

Deno.test("promote moves the stable release to the candidate, then uninstalls the canary", async () => {
  const { runner, calls } = fakeHelm();
  const p = platform(runner, (h) => h.values("values-prod.yaml"));
  await p.promote();
  await p.promote();
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
      "--reuse-values",
      "--wait",
    ],
    ["uninstall", "api-canary", ...SCOPE, "--ignore-not-found"],
  ]);
  // Idempotent: the second promote repeats the same two commands.
  assertEquals(calls.slice(2), calls.slice(0, 2));
});

Deno.test("abort mid-rollout rolls the stable release back to the recorded revision", async () => {
  const { runner, calls } = fakeHelm("7");
  const ctx = context();
  const p = platform(runner, (h) => h.timeout("2m").stableRevision(1));
  await p.stage(ctx);
  await p.abort(ctx);
  await p.abort(ctx);
  const undo = calls.slice(2);
  assertEquals(undo.slice(0, 2), [
    ["rollback", "api", "7", ...SCOPE, "--wait", "--timeout", "2m"],
    ["uninstall", "api-canary", ...SCOPE, "--ignore-not-found"],
  ]);
  // Idempotent, and the recorded revision wins over the hand-run one.
  assertEquals(undo.slice(2), undo.slice(0, 2));
});

Deno.test("abort while the canary install was under way only uninstalls it", async () => {
  const ctx = context();
  let n = 0;
  const failing = platform((settings) => {
    n++;
    return n === 1
      ? Promise.resolve(new CommandOutput(0, "7", ""))
      : Promise.reject(new Error(`timed out: ${settings.argv()[1]}`));
  });
  await assertRejects(() => failing.stage(ctx), Error, "timed out: upgrade");
  assertEquals(ctx.state.get(), {
    helmStage: "deploying",
    helmStableRevision: 7,
  });
  const { runner, calls } = fakeHelm();
  await platform(runner).abort(ctx);
  assertEquals(calls, [
    ["uninstall", "api-canary", ...SCOPE, "--ignore-not-found"],
  ]);
});

Deno.test("abort after a stage that failed reading the revision runs nothing", async () => {
  const ctx = context();
  const failing = platform(() =>
    Promise.reject(new Error("Error: release: not found"))
  );
  await assertRejects(() => failing.stage(ctx), Error, "release: not found");
  assertEquals(ctx.state.get(), { helmStage: "reading" });
  const { runner, calls } = fakeHelm();
  await platform(runner, (h) => h.stableRevision(3)).abort(ctx);
  assertEquals(calls, []);
});

Deno.test("a retried stage that fails reading still cleans up the earlier attempt's canary", async () => {
  // A first attempt was cut short during the canary install; the retry's
  // read then fails. The canary release may exist, so it must not be
  // forgotten by resetting the record to "reading".
  const ctx = context();
  await ctx.state.set({ helmStage: "deploying", helmStableRevision: 7 });
  const failing = platform(() => Promise.reject(new Error("unreachable")));
  await assertRejects(() => failing.stage(ctx), Error, "unreachable");
  assertEquals(ctx.state.get().helmStage, "deploying");
  const { runner, calls } = fakeHelm();
  await platform(runner).abort(ctx);
  assertEquals(calls, [
    ["uninstall", "api-canary", ...SCOPE, "--ignore-not-found"],
  ]);
});

Deno.test("a revision read-back that is not a revision is refused before anything changes", async () => {
  for (const printed of ["", "0", "seven", "7\n8", "-1"]) {
    const { runner, calls } = fakeHelm(printed);
    const ctx = context();
    await assertRejects(
      () => platform(runner).stage(ctx),
      Error,
      "not a revision number",
    );
    assertEquals(calls.length, 1);
    assertEquals(ctx.state.get(), { helmStage: "reading" });
  }
  const truncated = platform(() =>
    Promise.resolve(new CommandOutput(0, "7", "", true))
  );
  await assertRejects(
    () => truncated.stage(context()),
    Error,
    "not a revision number",
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
  assertEquals(calls.length, 2);
  assertEquals(ctx.summary, {});
});

Deno.test("a hand-run abort rolls back to the configured revision", async () => {
  const { runner, calls } = fakeHelm();
  await platform(runner, (h) => h.stableRevision(41)).abort(context());
  assertEquals(calls, [
    ["rollback", "api", "41", ...SCOPE, "--wait"],
    ["uninstall", "api-canary", ...SCOPE, "--ignore-not-found"],
  ]);
});

Deno.test("a hand-run abort with no revision refuses rather than claim a rollback", async () => {
  const { runner, calls } = fakeHelm();
  await assertRejects(
    () => platform(runner).abort(context()),
    Error,
    "h.stableRevision(<n>)",
  );
  for (const bad of [0, 1.5, -2]) {
    await assertRejects(
      () => platform(runner, (h) => h.stableRevision(bad)).abort(context()),
      Error,
      "is not a Helm revision",
    );
  }
  const ctx = context();
  await ctx.state.set({ helmStage: "staged", helmStableRevision: "7" });
  await assertRejects(
    () => platform(runner).abort(ctx),
    Error,
    "is not a Helm revision",
  );
  assertEquals(calls, []);
});

Deno.test("the lambda is evaluated on every call, so it sees resolved values", async () => {
  const { runner, calls } = fakeHelm();
  let image = "unresolved";
  const p = platform(runner, (h) => h.image(image));
  image = "1.6.0";
  await p.stage(context());
  assertEquals(calls[1].includes("image.tag=1.6.0"), true);
});

Deno.test("names, keys, files, chart and image that would change argv meaning are refused", async () => {
  const { runner, calls } = fakeHelm();
  const cases: Array<[(h: HelmCanarySettings) => HelmCanarySettings, string]> =
    [
      [(h) => h.stableRelease("-api"), "is not a Helm release name"],
      [(h) => h.stableRelease("Api"), "is not a Helm release name"],
      [(h) => h.canaryRelease("a".repeat(54)), "is not a Helm release name"],
      [(h) => h.canaryRelease("api"), "cannot be the stable release"],
      [(h) => h.imageKey("image.tag,x=1"), "h.imageKey(...)"],
      [(h) => h.replicasKey("a[0]"), "h.replicasKey(...)"],
      [(h) => h.values("a.yaml,b.yaml"), "--values splits on commas"],
      [(h) => h.values(""), "--values splits on commas"],
      [(h) => h.chart("--post-renderer=x"), "no usable chart"],
      [(h) => h.chart(""), "no usable chart"],
      [(h) => h.image("1.5,x=1"), "is not an image reference or tag"],
      [(h) => h.image("-1"), "is not an image reference or tag"],
      [(h) => h.image("ghcr.io/o/api:1.5"), "looks like a full image"],
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
      helmCanary((h) => h.stableRelease("api").image("1").runner(runner))
        .stage(context()),
    Error,
    "no usable chart",
  );
  await assertRejects(
    () =>
      helmCanary((h) => h.chart("c").stableRelease("api").runner(runner))
        .stage(context()),
    Error,
    "no candidate image",
  );
  assertEquals(calls, []);
});

Deno.test("a full reference is accepted at a key that takes one", async () => {
  const { runner, calls } = fakeHelm();
  await platform(
    runner,
    (h) => h.imageKey("image").image("ghcr.io/o/api@sha256:abc"),
  ).promote();
  assertEquals(calls[0].includes("image=ghcr.io/o/api@sha256:abc"), true);
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
  await assertRejects(() => p.expose(50), ToolNotFoundError);
});

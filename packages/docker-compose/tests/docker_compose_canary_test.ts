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
  dockerComposeCanary,
  type DockerComposeCanarySettings,
  type DockerComposeSettings,
  type DockerComposeSettingsRunner,
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

/** One command the platform ran: its argv after `docker`, and its variables. */
interface Call {
  argv: string[];
  env: Record<string, string>;
}

/** The containers of each service, by the image each runs. */
type World = Record<string, string[]>;

/** Which variable each service's `image:` reads in the fake Compose file. */
const IMAGE_VARIABLE: Record<string, string> = {
  app: "APP_IMAGE",
  "app-canary": "APP_CANARY_IMAGE",
  "app-next": "APP_CANARY_IMAGE",
};

/** Options for {@link fakeCompose}. */
interface Fake {
  /** The containers before the first command; four `app:v1` stable ones by default. */
  world?: World;
  /** Services whose `image:` is a literal, not their variable. */
  hardCoded?: Record<string, string>;
  /** What `ps` prints, overriding the world. */
  ps?: string;
  /** The output to answer a command with instead of running it. */
  answer?: (argv: string[]) => CommandOutput | undefined;
}

/**
 * A Compose that records every command and keeps a world of containers: `up`
 * scales a service, recreating its containers on the image its variable names
 * unless `--no-recreate` keeps them, and `ps` prints each container's image.
 */
function fakeCompose(fake: Fake = {}): {
  runner: DockerComposeSettingsRunner;
  calls: Call[];
  world: World;
} {
  const calls: Call[] = [];
  const world: World = fake.world ?? {
    app: ["app:v1", "app:v1", "app:v1", "app:v1"],
    "app-canary": [],
  };
  const runner = (
    settings: DockerComposeSettings,
    env: Readonly<Record<string, string>>,
  ): Promise<CommandOutput> => {
    const argv = settings.argv().slice(1);
    calls.push({ argv, env: { ...env } });
    const answer = fake.answer?.(argv);
    if (answer !== undefined) return Promise.resolve(answer);
    const service = argv.at(-1) ?? "";
    if (argv.includes("ps")) {
      const lines = (world[service] ?? []).map((image) => `${image}\n`);
      return Promise.resolve(
        new CommandOutput(0, fake.ps ?? lines.join(""), ""),
      );
    }
    if (argv.includes("up")) {
      const count = Number(argv[argv.indexOf("--scale") + 1].split("=")[1]);
      const image = fake.hardCoded?.[service] ??
        env[IMAGE_VARIABLE[service]] ?? "";
      const kept = argv.includes("--no-recreate")
        ? [...(world[service] ?? [])]
        : (world[service] ?? []).map(() => image);
      while (kept.length < count) kept.push(image);
      world[service] = kept.slice(0, count);
    }
    return Promise.resolve(new CommandOutput(0, "", ""));
  };
  return { runner, calls, world };
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
  runner: DockerComposeSettingsRunner,
  extra: (d: DockerComposeCanarySettings) => DockerComposeCanarySettings = (
    d,
  ) => d,
) {
  return dockerComposeCanary((d) =>
    extra(
      d.service("app").canaryService("app-canary").replicas(4)
        .image("app:v2")
        .stableImageVariable("APP_IMAGE")
        .canaryImageVariable("APP_CANARY_IMAGE")
        .compose((s) => s.usePlugin().projectName("shop"))
        .runner(runner),
    )
  );
}

/** The `up` argv the platform runs to put `service` at `count` replicas. */
function scale(
  service: string,
  count: number,
  keep = false,
): string[] {
  return [
    "compose",
    "-p",
    "shop",
    "up",
    "-d",
    ...(keep ? ["--no-recreate"] : []),
    ...(count > 0 ? ["--wait"] : []),
    "--no-deps",
    "--scale",
    `${service}=${count}`,
    service,
  ];
}

/** The `ps` argv the platform runs to read the images `service` runs. */
function ps(service: string): string[] {
  return ["compose", "-p", "shop", "ps", "--format", "{{.Image}}", service];
}

const BOTH_V1 = { APP_CANARY_IMAGE: "app:v2", APP_IMAGE: "app:v1" };
const ALL_V1 = { APP_CANARY_IMAGE: "app:v1", APP_IMAGE: "app:v1" };
const ALL_V2 = { APP_CANARY_IMAGE: "app:v2", APP_IMAGE: "app:v2" };

/** What a successful stage of the default platform records. */
const STAGED = {
  composeCanaryStage: "staged",
  composeCanaryService: "app",
  composeCanaryCanaryService: "app-canary",
  composeCanaryTotal: 4,
  composeCanaryStableVariable: "APP_IMAGE",
  composeCanaryCanaryVariable: "APP_CANARY_IMAGE",
  composeCanaryImage: "app:v2",
  composeCanaryStableImage: "app:v1",
};

/** A context whose state is the one a successful stage leaves. */
async function staged(runner: DockerComposeSettingsRunner) {
  const ctx = context();
  await platform(runner).stage(ctx);
  return ctx;
}

Deno.test("stage records the rollout, pulls the candidate, and settles at 0 %", async () => {
  const { runner, calls } = fakeCompose();
  const ctx = context();
  await platform(runner).stage(ctx);
  assertEquals(calls, [
    { argv: ps("app"), env: ALL_V2 },
    {
      argv: [
        "compose",
        "-p",
        "shop",
        "pull",
        "--policy",
        "missing",
        "app-canary",
      ],
      env: ALL_V2,
    },
    { argv: scale("app", 4, true), env: BOTH_V1 },
    { argv: scale("app-canary", 0), env: BOTH_V1 },
  ]);
  assertEquals(ctx.state.get(), STAGED);
  assertEquals(ctx.summary, { Candidate: "app:v2", Stable: "app:v1" });
});

Deno.test("expose scales the canary up first, checks its image, then the stable service down", async () => {
  const { runner, calls, world } = fakeCompose();
  const ctx = await staged(runner);
  const p = platform(runner);
  calls.length = 0;
  assertEquals(await p.expose(25, ctx), 25);
  assertEquals(calls, [
    { argv: scale("app-canary", 1), env: BOTH_V1 },
    { argv: ps("app-canary"), env: BOTH_V1 },
    { argv: scale("app", 3, true), env: BOTH_V1 },
  ]);
  calls.length = 0;
  assertEquals(await p.expose(50, ctx), 50);
  assertEquals(calls.map((c) => c.argv), [
    scale("app-canary", 2),
    ps("app-canary"),
    scale("app", 2, true),
  ]);
  assertEquals(ctx.state.get().composeCanaryReplicas, 2);
  assertEquals(world, {
    app: ["app:v1", "app:v1"],
    "app-canary": ["app:v2", "app:v2"],
  });
});

Deno.test("expose to a smaller share grows the stable service first", async () => {
  const { runner, calls } = fakeCompose();
  const ctx = await staged(runner);
  const p = platform(runner);
  await p.expose(75, ctx);
  calls.length = 0;
  assertEquals(await p.expose(25, ctx), 25);
  assertEquals(calls.map((c) => c.argv), [
    scale("app", 3, true),
    scale("app-canary", 1),
    ps("app-canary"),
  ]);
  calls.length = 0;
  assertEquals(await p.expose(0, ctx), 0);
  assertEquals(calls.map((c) => c.argv), [
    scale("app", 4, true),
    scale("app-canary", 0),
  ]);
});

Deno.test("expose quantises to whole replicas of the recorded total", async () => {
  const { runner, calls } = fakeCompose({
    world: { app: ["app:v1", "app:v1", "app:v1"], "app-canary": [] },
  });
  const ctx = context();
  await platform(runner, (d) => d.replicas(3)).stage(ctx);
  // A resumed process whose lambda says otherwise still splits what stage
  // recorded.
  const p = platform(runner, (d) => d.replicas(8));
  // 10 % of 3 rounds to none; a step keeps at least one canary.
  assertEquals(await p.expose(10, ctx), 33.33);
  // 90 % of 3 rounds to all; a step keeps at least one stable replica.
  assertEquals(await p.expose(90, ctx), 66.67);
  assertEquals(await p.expose(100, ctx), 100);
  assertEquals(calls.at(-3)?.argv, scale("app-canary", 3));
  assertEquals(calls.at(-1)?.argv, scale("app", 0, true));
});

Deno.test("expose refuses a share outside 0 to 100", async () => {
  const { runner, calls } = fakeCompose();
  const ctx = await staged(runner);
  calls.length = 0;
  for (const bad of [-1, 101, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assertRejects(
      () => platform(runner).expose(bad, ctx),
      Error,
      "a share from 0 to 100",
    );
  }
  assertEquals(calls, []);
});

Deno.test("expose refuses a canary whose image does not read its variable", async () => {
  // The canary service's image: is a literal, so it runs the stable release
  // and an analysis of it would judge the wrong image.
  const { runner, calls } = fakeCompose({
    hardCoded: { "app-canary": "app:v1" },
  });
  const ctx = await staged(runner);
  calls.length = 0;
  await assertRejects(
    () => platform(runner).expose(25, ctx),
    Error,
    "the service app-canary runs app:v1 after the platform set " +
      "APP_CANARY_IMAGE to app:v2",
  );
  // The stable service did not shrink.
  assertEquals(calls.map((c) => c.argv), [
    scale("app-canary", 1),
    ps("app-canary"),
  ]);
});

Deno.test("expose and promote refuse without a stage that succeeded", async () => {
  const { runner, calls } = fakeCompose();
  await assertRejects(
    () => platform(runner).expose(25, context()),
    Error,
    "no staged candidate",
  );
  // A stage that failed before it recorded the rollout.
  const ctx = context();
  await ctx.state.set({ composeCanaryStage: "deploying" });
  await assertRejects(
    () => platform(runner).promote(ctx),
    Error,
    "no staged candidate",
  );
  assertEquals(calls, []);
});

Deno.test("a damaged record is refused rather than read as some other rollout", async () => {
  const { runner, calls } = fakeCompose();
  for (
    const [key, value] of [
      ["composeCanaryCanaryService", 7],
      ["composeCanaryTotal", "4"],
    ] as const
  ) {
    const ctx = context();
    await ctx.state.set({ ...STAGED, [key]: value });
    await assertRejects(
      () => platform(runner).abort(ctx),
      Error,
      `has no usable ${key}`,
    );
  }
  // A record that reads, but not as a valid rollout, is refused as settings
  // would be.
  const ctx = context();
  await ctx.state.set({ ...STAGED, composeCanaryStableImage: "app v1" });
  await assertRejects(
    () => platform(runner).abort(ctx),
    Error,
    "(the recorded stable image) is not an image reference",
  );
  assertEquals(calls, []);
});

Deno.test("promote hands the stable service to the candidate without a capacity dip", async () => {
  const { runner, calls, world } = fakeCompose();
  const ctx = await staged(runner);
  const p = platform(runner);
  await p.expose(50, ctx);
  calls.length = 0;
  await p.promote(ctx);
  assertEquals(calls, [
    { argv: scale("app-canary", 4), env: ALL_V2 },
    { argv: scale("app", 4), env: ALL_V2 },
    { argv: ps("app"), env: ALL_V2 },
    { argv: scale("app-canary", 0), env: ALL_V2 },
  ]);
  assertEquals(ctx.state.get().composeCanaryStage, "promoted");
  // Promote leaves the last expose's record alone: nothing reads it again.
  assertEquals(ctx.state.get().composeCanaryReplicas, 2);
  assertEquals(world, {
    app: ["app:v2", "app:v2", "app:v2", "app:v2"],
    "app-canary": [],
  });
  // A second promote — a resume re-driving it — changes nothing.
  calls.length = 0;
  await p.promote(ctx);
  assertEquals(calls, []);
});

Deno.test("promote refuses a stable service whose image does not read its variable", async () => {
  // image: repo:${TAG}, or a literal: setting APP_IMAGE changes nothing, so
  // reporting a promotion would be a lie.
  const { runner, calls } = fakeCompose({ hardCoded: { app: "app:v1" } });
  const ctx = await staged(runner);
  calls.length = 0;
  await assertRejects(
    () => platform(runner).promote(ctx),
    Error,
    "the service app runs app:v1, app:v1, app:v1, app:v1 after the platform " +
      "set APP_IMAGE to app:v2, so its image: does not read that variable. " +
      "Make it image: ${APP_IMAGE}.",
  );
  assertEquals(ctx.state.get().composeCanaryStage, "promoting");
  // The canary still holds every replica, so nothing stopped serving.
  assertEquals(calls.map((c) => c.argv), [
    scale("app-canary", 4),
    scale("app", 4),
    ps("app"),
  ]);
  // No stable replicas at all is refused too.
  const lost = await staged(fakeCompose().runner);
  const { runner: none } = fakeCompose({ ps: "" });
  await assertRejects(
    () => platform(none).promote(lost),
    Error,
    "the service app runs nothing after",
  );
});

Deno.test("abort mid-rollout scales the stable service back without recreating it, and repeats harmlessly", async () => {
  const { runner, calls, world } = fakeCompose();
  const ctx = await staged(runner);
  const p = platform(runner);
  await p.expose(25, ctx);
  calls.length = 0;
  await p.abort(ctx);
  await p.abort(ctx);
  const once = [
    { argv: ps("app"), env: ALL_V1 },
    { argv: scale("app", 4, true), env: ALL_V1 },
    { argv: scale("app-canary", 0), env: ALL_V1 },
  ];
  assertEquals(calls, [...once, ...once]);
  assertEquals(world, {
    app: ["app:v1", "app:v1", "app:v1", "app:v1"],
    "app-canary": [],
  });
});

Deno.test("abort after a promotion that failed part-way surges the canary on the stable image before recreating", async () => {
  // The stable service was recreated on the candidate, then the last command
  // failed. Compose recreates every stable replica at once, so the canary
  // holds the load on the stable image while it does.
  const { runner, world } = fakeCompose();
  const ctx = await staged(runner);
  let left = 3;
  const flaky = platform((settings, env) => {
    if (left-- === 0) return Promise.reject(new Error("daemon went away"));
    return runner(settings, env);
  });
  await assertRejects(() => flaky.promote(ctx), Error, "daemon went away");
  assertEquals(ctx.state.get().composeCanaryStage, "promoting");
  assertEquals(world.app, ["app:v2", "app:v2", "app:v2", "app:v2"]);
  const recorded = fakeCompose({ world });
  await platform(recorded.runner).abort(ctx);
  assertEquals(recorded.calls, [
    { argv: ps("app"), env: ALL_V1 },
    { argv: scale("app-canary", 4), env: ALL_V1 },
    { argv: scale("app", 4), env: ALL_V1 },
    { argv: scale("app-canary", 0), env: ALL_V1 },
  ]);
  assertEquals(world, {
    app: ["app:v1", "app:v1", "app:v1", "app:v1"],
    "app-canary": [],
  });
});

Deno.test("abort after a stage that changed nothing runs nothing", async () => {
  // The stable read failed: nothing was pulled or scaled.
  const ctx = context();
  const failing = platform(() => Promise.reject(new Error("no daemon")));
  await assertRejects(() => failing.stage(ctx), Error, "no daemon");
  assertEquals(ctx.state.get(), { composeCanaryStage: "deploying" });
  const { runner, calls } = fakeCompose();
  await platform(runner).abort(ctx);
  assertEquals(calls, []);
});

Deno.test("a stage its own settings refuse is marked first, so the rollback is a no-op", async () => {
  // The engine rolls back a failed stage inline. Had the refusal come before
  // the marker, that rollback would take the hand-run path and recreate the
  // stable service on d.stable(...).
  const { runner, calls } = fakeCompose();
  const ctx = context();
  const unconfigured = dockerComposeCanary((d) =>
    d.service("app").canaryService("app-canary").replicas(4)
      .stableImageVariable("APP_IMAGE").canaryImageVariable("APP_CANARY_IMAGE")
      .stable("app:v0").runner(runner)
  );
  await assertRejects(
    () => unconfigured.stage(ctx),
    Error,
    "no candidate image",
  );
  assertEquals(ctx.state.get(), { composeCanaryStage: "deploying" });
  // The settings are not even read: a lambda that now throws is not reached.
  await dockerComposeCanary(() => {
    throw new Error("settings read");
  }).abort(ctx);
  assertEquals(calls, []);
});

Deno.test("a stage that cannot record the stable image stops before anything scales", async () => {
  const { runner, calls } = fakeCompose();
  const ctx = context();
  ctx.state.trySet = () => Promise.resolve(false);
  await assertRejects(
    () => platform(runner).stage(ctx),
    Error,
    "could not record the stable image",
  );
  // The read and the pull ran; no scaling did.
  assertEquals(calls.map((c) => c.argv[3]), ["ps", "pull"]);
});

Deno.test("stage refuses a stable service with no single running image", async () => {
  for (
    const [serving, message] of [
      ["", "has no running replicas"],
      ["\n  \n", "has no running replicas"],
      ["app:v1\napp:v0\n", "different images (app:v1, app:v0)"],
      ["app v1\n", `"app v1" (an image ps reported for app) is not an image`],
      ["app:\u0007v1\n", "(an image ps reported for app) is not an image"],
    ]
  ) {
    const { runner, calls } = fakeCompose({ ps: serving });
    await assertRejects(
      () => platform(runner).stage(context()),
      Error,
      message,
    );
    assertEquals(calls.length, 1);
  }
});

Deno.test("a truncated ps capture is refused, since it may begin mid-image", async () => {
  const { runner } = fakeCompose({
    answer: (argv) =>
      argv.includes("ps")
        ? new CommandOutput(0, "1:v1\napp:v1\n", "", true, 64)
        : undefined,
  });
  await assertRejects(
    () => platform(runner).stage(context()),
    Error,
    "more than the 64-byte capture cap",
  );
});

Deno.test("a hand-run abort on stable replicas already on the image only scales them back", async () => {
  const { runner, calls } = fakeCompose({
    world: { app: ["app:v1", "app:v1"], "app-canary": ["app:v2", "app:v2"] },
  });
  await platform(runner, (d) => d.stable("app:v1")).abort(context());
  assertEquals(calls, [
    { argv: ps("app"), env: ALL_V1 },
    { argv: scale("app", 4, true), env: ALL_V1 },
    { argv: scale("app-canary", 0), env: ALL_V1 },
  ]);
});

Deno.test("a hand-run abort after a promotion surges the canary on the stable image, then recreates", async () => {
  // Every stable replica runs the promoted release. Recreating them with the
  // canary at none would leave nothing serving while Compose replaces them.
  const { runner, calls, world } = fakeCompose({
    world: {
      app: ["app:v2", "app:v2", "app:v2", "app:v2"],
      "app-canary": [],
    },
  });
  await platform(runner, (d) => d.stable("app:v1")).abort(context());
  assertEquals(calls, [
    { argv: ps("app"), env: ALL_V1 },
    { argv: scale("app-canary", 4), env: ALL_V1 },
    { argv: scale("app", 4), env: ALL_V1 },
    { argv: scale("app-canary", 0), env: ALL_V1 },
  ]);
  assertEquals(world, {
    app: ["app:v1", "app:v1", "app:v1", "app:v1"],
    "app-canary": [],
  });
});

Deno.test("a hand-run abort with no usable stable image refuses rather than claim a rollback", async () => {
  const { runner, calls } = fakeCompose();
  await assertRejects(
    () => platform(runner).abort(context()),
    Error,
    "d.stable('<image>')",
  );
  for (const bad of ["", "app:v1 --pull", "app:\nv1"]) {
    await assertRejects(
      () => platform(runner, (d) => d.stable(bad)).abort(context()),
      Error,
      "(the d.stable(...) image) is not an image reference",
    );
  }
  assertEquals(calls, []);
});

Deno.test("every call after stage acts on what stage recorded, not on the lambda", async () => {
  // A resumed or cancelling process whose parameters resolve differently.
  const { runner, calls } = fakeCompose();
  const ctx = await staged(runner);
  const drifted = platform(
    runner,
    (d) =>
      d.service("web").canaryService("app-next").replicas(2).image("app:v9")
        .stableImageVariable("WEB_IMAGE").canaryImageVariable("NEXT_IMAGE"),
  );
  calls.length = 0;
  await drifted.expose(25, ctx);
  await drifted.abort(ctx);
  assertEquals(calls, [
    { argv: scale("app-canary", 1), env: BOTH_V1 },
    { argv: ps("app-canary"), env: BOTH_V1 },
    { argv: scale("app", 3, true), env: BOTH_V1 },
    { argv: ps("app"), env: ALL_V1 },
    { argv: scale("app", 4, true), env: ALL_V1 },
    { argv: scale("app-canary", 0), env: ALL_V1 },
  ]);
  calls.length = 0;
  await drifted.promote(ctx);
  assertEquals(calls.map((c) => c.argv), [
    scale("app-canary", 4),
    scale("app", 4),
    ps("app"),
    scale("app-canary", 0),
  ]);
  assertEquals(calls[0].env, ALL_V2);
});

Deno.test("the lambda is evaluated on every call, so it sees resolved values", async () => {
  const { runner, calls } = fakeCompose();
  let image = "unresolved";
  const p = platform(runner, (d) => d.image(image));
  image = "app:v3";
  await p.stage(context());
  assertEquals(calls[0].env, {
    APP_CANARY_IMAGE: "app:v3",
    APP_IMAGE: "app:v3",
  });
});

Deno.test("missing and malformed settings are named before anything runs", async () => {
  const { runner, calls } = fakeCompose();
  const cases: Array<
    [(d: DockerComposeCanarySettings) => DockerComposeCanarySettings, string]
  > = [
    [(d) => d.canaryService("c").replicas(2), "no stable service named"],
    [(d) => d.service("app").replicas(2), "no canary service named"],
    [(d) => d.service("app").canaryService("c"), "no replica count"],
    [
      (d) => d.service("app").canaryService("app").replicas(2),
      "both app",
    ],
    [
      (d) => d.service("app").canaryService("c").replicas(1),
      "1 replicas cannot be split",
    ],
    [
      (d) => d.service("app").canaryService("c").replicas(2.5),
      "2.5 replicas cannot be split",
    ],
    [
      (d) => d.service("app").canaryService("c").replicas(10_001),
      "10001 replicas cannot be split between a stable and a canary " +
      "service — use a whole number from 2 to 10000.",
    ],
    [
      (d) => d.service("app").canaryService("c").replicas(2),
      "no candidate image",
    ],
    [
      (d) => d.service("app").canaryService("c").replicas(2).image(""),
      `"" (the candidate image) is not an image reference`,
    ],
    [
      (d) => d.service("app").canaryService("c").replicas(2).image("a b"),
      `"a b" (the candidate image) is not an image reference`,
    ],
    [
      (d) => d.service("app").canaryService("c").replicas(2).image("i"),
      "d.canaryImageVariable('APP_CANARY_IMAGE')",
    ],
    [
      (d) =>
        d.service("app").canaryService("c").replicas(2).image("i")
          .canaryImageVariable("C"),
      "d.stableImageVariable('APP_IMAGE')",
    ],
    [
      (d) =>
        d.service("app").canaryService("c").replicas(2).image("i")
          .canaryImageVariable("V").stableImageVariable("V"),
      "both read V",
    ],
    [
      // One variable on Windows, which reads names without regard to case.
      (d) =>
        d.service("app").canaryService("c").replicas(2).image("i")
          .canaryImageVariable("app_image").stableImageVariable("APP_IMAGE"),
      "both read APP_IMAGE",
    ],
    [
      (d) =>
        d.service("app").canaryService("c").replicas(2).image("i")
          .canaryImageVariable("1X").stableImageVariable("S"),
      `"1X" is not an environment variable name`,
    ],
  ];
  for (const [configure, message] of cases) {
    await assertRejects(
      () =>
        dockerComposeCanary((d) => configure(d).runner(runner)).stage(
          context(),
        ),
      Error,
      message,
    );
  }
  for (
    const variable of [
      "DOCKER_HOST",
      "COMPOSE_FILE",
      "compose_project_name",
      "PATH",
      "Path",
      "HOME",
      "USERPROFILE",
      "TMPDIR",
      "TEMP",
      "tmp",
      "LD_PRELOAD",
      "DYLD_INSERT_LIBRARIES",
      "HTTPS_PROXY",
      "no_proxy",
      "BUILDKIT_HOST",
      "BUILDX_CONFIG",
      "XDG_CONFIG_HOME",
    ]
  ) {
    await assertRejects(
      () =>
        platform(runner, (d) => d.stableImageVariable(variable)).stage(
          context(),
        ),
      Error,
      "is a setting Docker, Compose or the process itself reads",
    );
  }
  for (const name of ["-x", "a=1", "a,b", "", "a b"]) {
    await assertRejects(
      () => platform(runner, (d) => d.canaryService(name)).stage(context()),
      Error,
      "is not a Compose service name",
    );
  }
  assertEquals(calls, []);
});

Deno.test("service names may start with '_' or '.', as the compose spec allows", async () => {
  const { runner, calls } = fakeCompose({
    world: { "_app": ["app:v1", "app:v1"], ".canary": [] },
  });
  await platform(
    runner,
    (d) => d.service("_app").canaryService(".canary").replicas(2),
  ).stage(context());
  assertEquals(calls.at(-1)?.argv.slice(-2), [".canary=0", ".canary"]);
});

Deno.test("trailing arguments from the global lambda are refused", async () => {
  // They would follow the service operand: `up ... app other-svc` moves a
  // service the rollout never named.
  const { runner, calls } = fakeCompose();
  await assertRejects(
    () =>
      platform(runner, (d) => d.compose((s) => s.usePlugin().args("other")))
        .stage(context()),
    Error,
    "d.compose(...) adds trailing arguments (other)",
  );
  assertEquals(calls, []);
});

Deno.test("describe names the stable service", () => {
  const { runner } = fakeCompose();
  assertEquals(platform(runner).describe(), "Compose service app");
  assertEquals(dockerComposeCanary((d) => d).describe(), "Compose service");
  assertEquals(platform(runner).exposure, "replicas");
});

Deno.test("global flags apply to every command, and cannot override the image variables", async () => {
  const { runner, calls } = fakeCompose();
  const p = platform(
    runner,
    (d) =>
      d.compose((s) =>
        s.file("compose.yml").projectName("shop").env({
          APP_CANARY_IMAGE: "app:sneaky",
        })
      ),
  );
  await p.stage(context());
  assertEquals(calls[0].argv.slice(0, 5), [
    "compose",
    "-f",
    "compose.yml",
    "-p",
    "shop",
  ]);
  assertEquals(calls[0].env.APP_CANARY_IMAGE, "app:v2");
});

Deno.test("a failing compose command fails the call", async () => {
  const { runner } = fakeCompose();
  const ctx = await staged(runner);
  const p = platform(() => Promise.reject(new Error("compose exit 1")));
  const error = await assertRejects(() => p.expose(25, ctx), Error);
  assertStringIncludes(error.message, "compose exit 1");
});

Deno.test("a non-zero exit fails the call even when the runner returns it", async () => {
  // As `.compose((s) => s.noThrow())` makes the default runner do: a
  // rollback whose commands all failed must not report itself done.
  const { runner, calls } = fakeCompose({
    answer: (argv) =>
      argv.includes("up")
        ? new CommandOutput(1, "", "  no such service: app\n")
        : undefined,
  });
  await assertRejects(
    () => platform(runner, (d) => d.stable("app:v1")).abort(context()),
    Error,
    "compose exited 1 running docker compose -p shop up -d --no-recreate " +
      "--wait --no-deps --scale app=4 app: no such service: app",
  );
  assertEquals(calls.length, 2);
  const { runner: silent } = fakeCompose({
    answer: () => new CommandOutput(17, "", ""),
  });
  await assertRejects(
    () => platform(silent).stage(context()),
    Error,
    "compose exited 17 running docker compose -p shop ps --format " +
      "{{.Image}} app.",
  );
});

Deno.test("the default runner runs compose itself", async () => {
  // The default is the settings' own run(), so a compose that is not
  // installed surfaces as the wrapper's usual tool-not-found error.
  const p = dockerComposeCanary((d) =>
    d.service("app").canaryService("app-canary").replicas(2).image("i")
      .canaryImageVariable("C").stableImageVariable("S")
      .compose((s) => missingTool(s.usePlugin()))
  );
  await assertRejects(() => p.stage(context()), ToolNotFoundError);
});

/**
 * A stand-in `docker` for the default runner: a shell script that prints the
 * stable variable it was run with for `ps`, and exits 1 for `up` when
 * `failUp` is set. Shell scripts do not run on Windows, so the tests that use
 * one skip there.
 */
async function fakeDocker(failUp: boolean): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "zuke-compose-canary-" });
  const path = `${dir}/docker`;
  await Deno.writeTextFile(
    path,
    [
      "#!/bin/sh",
      'case " $* " in',
      '  *" ps "*) echo "$APP_IMAGE" ;;',
      `  *" up "*) ${failUp ? "echo up failed >&2; exit 1" : "exit 0"} ;;`,
      "esac",
      "",
    ].join("\n"),
  );
  await Deno.chmod(path, 0o755);
  return path;
}

Deno.test({
  name:
    "the default runner runs compose with the image variables over a global .env",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const docker = await fakeDocker(false);
    const ctx = context();
    await dockerComposeCanary((d) =>
      d.service("app").canaryService("app-canary").replicas(2).image("app:v2")
        .stableImageVariable("APP_IMAGE").canaryImageVariable(
          "APP_CANARY_IMAGE",
        )
        .compose((s) =>
          s.usePlugin().toolPath(docker).quiet().env({ APP_IMAGE: "sneaky" })
        )
    ).stage(ctx);
    // The read runs with the candidate standing in for the stable image, so
    // the process saw the platform's APP_IMAGE, not the global one.
    assertEquals(ctx.summary.Stable, "app:v2");
  },
});

Deno.test({
  name:
    "the default runner with noThrow still fails a rollback whose commands fail",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const docker = await fakeDocker(true);
    const p = dockerComposeCanary((d) =>
      d.service("app").canaryService("app-canary").replicas(2).image("app:v2")
        .stableImageVariable("APP_IMAGE").canaryImageVariable(
          "APP_CANARY_IMAGE",
        )
        .stable("app:v1")
        .compose((s) => s.usePlugin().toolPath(docker).quiet().noThrow())
    );
    await assertRejects(
      () => p.abort(context()),
      Error,
      "compose exited 1 running",
    );
  },
});

Deno.test("promote and a hand-run abort tell the operator what to persist", async () => {
  // Both are overrides for the platform's own commands: a plain
  // `docker compose up` reverts them unless the variable and scale are kept.
  const { runner } = fakeCompose();
  const ctx = await staged(runner);
  // A resumed process whose lambda drifted still names what stage recorded.
  const drifted = platform(
    runner,
    (d) => d.replicas(2).stableImageVariable("WEB_IMAGE"),
  );
  await drifted.promote(ctx);
  assertEquals(
    ctx.summary.Persist,
    "set APP_IMAGE=app:v2 and keep scale: 4",
  );
  const handRun = context();
  await platform(runner, (d) => d.stable("app:v1")).abort(handRun);
  assertEquals(handRun.summary, {
    Persist: "set APP_IMAGE=app:v1 and keep scale: 4",
  });
  // A rollback the engine runs mid-rollout restores what was serving, which
  // the project already names: nothing to persist.
  const mid = await staged(runner);
  const before = { ...mid.summary };
  await platform(runner).abort(mid);
  assertEquals(mid.summary, before);
});

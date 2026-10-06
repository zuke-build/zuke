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

/** The ID each tag resolves to, as `images --quiet` prints it. */
const V1_HEX = "a1".repeat(32);
const V2_HEX = "b2".repeat(32);
const V3_HEX = "c3".repeat(32);

/** The stable image's ID, as the platform sets it and `ps` reports it. */
const V1_ID = `sha256:${V1_HEX}`;

/** The candidate's ID, which the first step that runs it pins. */
const V2_ID = `sha256:${V2_HEX}`;

/** Options for {@link fakeCompose}. */
interface Fake {
  /** The ID each tag resolves to; `app:v1` and `app:v2` by default. */
  tags?: Record<string, string>;
  /** The containers before the first command; four `app:v1` stable ones by default. */
  world?: World;
  /** Services whose `image:` is a literal, not their variable. */
  hardCoded?: Record<string, string>;
  /** What `ps --format {{.Image}}` prints, overriding the world. */
  ps?: string;
  /** The project the project read names each container in; `shop` by default. */
  project?: string;
  /** What the project read prints, overriding the world. */
  projects?: string;
  /** What `images --quiet` prints, overriding the world. */
  images?: string;
  /**
   * Services whose containers are stopped, as after a daemon restart: `ps`
   * lists them only with `-a`, and an `up` of the service starts them.
   */
  stopped?: string[];
  /** The output to answer a command with instead of running it. */
  answer?: (argv: string[]) => CommandOutput | undefined;
}

/**
 * A Compose that records every command and keeps a world of containers: `up`
 * scales a service, recreating its containers on the image its variable names
 * unless `--no-recreate` keeps them, `ps` prints each container's image, and
 * `images --quiet` each distinct ID they run — `sha256:` stripped, as Compose
 * prints it. A container created from an ID shows that ID in `ps`.
 */
function fakeCompose(fake: Fake = {}): {
  runner: DockerComposeSettingsRunner;
  calls: Call[];
  world: World;
  tags: Record<string, string>;
  serving: number[];
} {
  const calls: Call[] = [];
  const tags = fake.tags ?? { "app:v1": V1_HEX, "app:v2": V2_HEX };
  const world: World = fake.world ?? {
    app: ["app:v1", "app:v1", "app:v1", "app:v1"],
    "app-canary": [],
  };
  const stopped = new Set(fake.stopped ?? []);
  const serving: number[] = [];
  /** How many containers run, across every service. */
  const running = (): number =>
    Object.entries(world).reduce(
      (sum, [each, containers]) =>
        sum + (stopped.has(each) ? 0 : containers.length),
      0,
    );
  /** The containers of `service` that `ps` with `argv` lists. */
  const listed = (argv: string[], service: string): string[] =>
    argv.includes("-a") || !stopped.has(service) ? world[service] ?? [] : [];
  const runner = (
    settings: DockerComposeSettings,
    env: Readonly<Record<string, string>>,
  ): Promise<CommandOutput> => {
    const argv = settings.argv().slice(1);
    calls.push({ argv, env: { ...env } });
    const answer = fake.answer?.(argv);
    if (answer !== undefined) return Promise.resolve(answer);
    const service = argv.at(-1) ?? "";
    if (argv.includes("images")) {
      const ids = new Set(
        (world[service] ?? []).map((image) =>
          image.startsWith("sha256:") ? image.slice(7) : tags[image]
        ),
      );
      const lines = [...ids].map((id) => `${id}\n`).join("");
      return Promise.resolve(new CommandOutput(0, fake.images ?? lines, ""));
    }
    if (argv.includes(PROJECT_TEMPLATE)) {
      const services = argv.slice(argv.indexOf("--format") + 2);
      const lines = services.flatMap((each) =>
        listed(argv, each).map(() => `${fake.project ?? "shop"}\n`)
      );
      return Promise.resolve(
        new CommandOutput(0, fake.projects ?? lines.join(""), ""),
      );
    }
    if (argv.includes("ps")) {
      const lines = listed(argv, service).map((image) => `${image}\n`);
      return Promise.resolve(
        new CommandOutput(0, fake.ps ?? lines.join(""), ""),
      );
    }
    if (argv.includes("up")) {
      stopped.delete(service);
      const count = Number(argv[argv.indexOf("--scale") + 1].split("=")[1]);
      const image = fake.hardCoded?.[service] ??
        env[IMAGE_VARIABLE[service]] ?? "";
      const before = world[service] ?? [];
      const keep = argv.includes("--no-recreate");
      // Compose stops every container it recreates at once: for a moment
      // only the ones already on the image are left.
      if (!keep && before.some((each) => each !== image)) {
        world[service] = before.filter((each) => each === image);
        serving.push(running());
      }
      const kept = keep ? [...before] : before.map(() => image);
      while (kept.length < count) kept.push(image);
      world[service] = kept.slice(0, count);
      serving.push(running());
    }
    return Promise.resolve(new CommandOutput(0, "", ""));
  };
  return { runner, calls, world, tags, serving };
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

/**
 * The `up` argv the platform runs to put `service` at `count` replicas —
 * `pinned` (`--pull never`) whenever a variable it sets is an image ID, which
 * is every move after stage records the stable ID.
 */
function scale(
  service: string,
  count: number,
  keep = false,
  pinned = true,
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
    ...(pinned ? ["--pull", "never"] : []),
    "--scale",
    `${service}=${count}`,
    service,
  ];
}

/** The `images` argv the platform runs to read the ID `service` runs. */
function images(service: string): string[] {
  return ["compose", "-p", "shop", "images", "--quiet", service];
}

/** The template the project read prints each container's project label with. */
const PROJECT_TEMPLATE = '{{.Label "com.docker.compose.project"}}';

/**
 * The `ps` argv the platform runs to read the project `services` are in —
 * stopped containers included: the stable one at stage, both before
 * anything else on every later call.
 */
function projects(...services: string[]): string[] {
  return [
    "compose",
    "-p",
    "shop",
    "ps",
    "-a",
    "--format",
    PROJECT_TEMPLATE,
    ...(services.length === 0 ? ["app", "app-canary"] : services),
  ];
}

/** The `ps` argv the platform runs to read the images `service` runs. */
function ps(service: string): string[] {
  return ["compose", "-p", "shop", "ps", "--format", "{{.Image}}", service];
}

const BOTH_V1 = { APP_CANARY_IMAGE: "app:v2", APP_IMAGE: V1_ID };
const ALL_V1 = { APP_CANARY_IMAGE: V1_ID, APP_IMAGE: V1_ID };
/** A hand-run rollback has only the reference to go on. */
const ALL_V1_TAG = { APP_CANARY_IMAGE: "app:v1", APP_IMAGE: "app:v1" };
const ALL_V2 = { APP_CANARY_IMAGE: "app:v2", APP_IMAGE: "app:v2" };
/** Promote, once the candidate's ID is pinned. */
const ALL_V2_ID = { APP_CANARY_IMAGE: V2_ID, APP_IMAGE: V2_ID };
/** A step after the first, with the candidate pinned by ID. */
const PINNED = { APP_CANARY_IMAGE: V2_ID, APP_IMAGE: V1_ID };

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
  composeCanaryStableImageId: V1_ID,
  composeCanaryProject: ["-p", "shop"],
  composeCanaryProjectName: "shop",
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
    { argv: images("app"), env: ALL_V2 },
    { argv: projects("app"), env: ALL_V2 },
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
    { argv: projects(), env: BOTH_V1 },
    { argv: scale("app-canary", 1, true), env: BOTH_V1 },
    { argv: ps("app-canary"), env: BOTH_V1 },
    { argv: images("app-canary"), env: BOTH_V1 },
    { argv: scale("app", 3, true), env: BOTH_V1 },
  ]);
  // The first step pins the image the analysis judges; the next runs it by ID.
  assertEquals(ctx.state.get().composeCanaryCandidateId, V2_ID);
  calls.length = 0;
  assertEquals(await p.expose(50, ctx), 50);
  assertEquals(calls, [
    { argv: projects(), env: PINNED },
    { argv: scale("app-canary", 2, true), env: PINNED },
    { argv: ps("app-canary"), env: PINNED },
    { argv: images("app-canary"), env: PINNED },
    { argv: scale("app", 2, true), env: PINNED },
  ]);
  assertEquals(ctx.state.get().composeCanaryReplicas, 2);
  assertEquals(world, {
    app: ["app:v1", "app:v1"],
    "app-canary": ["app:v2", V2_ID],
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
    projects(),
    scale("app", 3, true),
    scale("app-canary", 1, true),
    ps("app-canary"),
    images("app-canary"),
  ]);
  calls.length = 0;
  assertEquals(await p.expose(0, ctx), 0);
  assertEquals(calls.map((c) => c.argv), [
    projects(),
    scale("app", 4, true),
    scale("app-canary", 0, true),
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
  assertEquals(calls.at(-4)?.argv, scale("app-canary", 3, true));
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
    projects(),
    scale("app-canary", 1, true),
    ps("app-canary"),
    images("app-canary"),
  ]);
  // A canary with no running replica after the move is refused too.
  const { runner: gone } = fakeCompose();
  const fresh = await staged(gone);
  await assertRejects(
    () =>
      platform((settings, env) =>
        settings.argv().includes("{{.Image}}")
          ? Promise.resolve(new CommandOutput(0, "", ""))
          : gone(settings, env)
      ).expose(25, fresh),
    Error,
    "the service app-canary runs nothing after the platform set " +
      "APP_CANARY_IMAGE to app:v2",
  );
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
  // Every move carries the ID the steps pinned, never the tag.
  assertEquals(calls, [
    { argv: projects(), env: PINNED },
    { argv: scale("app-canary", 4, true), env: PINNED },
    { argv: scale("app", 4), env: ALL_V2_ID },
    { argv: images("app"), env: ALL_V2_ID },
    { argv: scale("app-canary", 0), env: ALL_V2_ID },
  ]);
  assertEquals(ctx.state.get().composeCanaryStage, "promoted");
  // Promote leaves the last expose's record alone: nothing reads it again.
  assertEquals(ctx.state.get().composeCanaryReplicas, 2);
  assertEquals(world, {
    app: [V2_ID, V2_ID, V2_ID, V2_ID],
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
    `the service app runs ${V1_ID} after the platform set ` +
      `APP_IMAGE to ${V2_ID}, so its image: does not read that variable. ` +
      "Make it image: ${APP_IMAGE}.",
  );
  assertEquals(ctx.state.get().composeCanaryStage, "promoting");
  // With no step before it, promote pins the candidate itself; the canary
  // still holds every replica, so nothing stopped serving.
  assertEquals(calls.map((c) => c.argv), [
    projects(),
    scale("app-canary", 4, true),
    ps("app-canary"),
    images("app-canary"),
    scale("app", 4),
    images("app"),
  ]);
  // No stable replicas at all is refused too.
  const lost = await staged(fakeCompose().runner);
  const { runner: none } = fakeCompose({
    answer: (argv) =>
      argv.includes("images") && argv.at(-1) === "app"
        ? new CommandOutput(0, "", "")
        : undefined,
  });
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
    { argv: projects(), env: PINNED },
    { argv: images("app"), env: ALL_V1 },
    { argv: scale("app", 4, true), env: ALL_V1 },
    { argv: images("app"), env: ALL_V1 },
    { argv: scale("app-canary", 0), env: ALL_V1 },
  ];
  assertEquals(calls, [...once, ...once]);
  assertEquals(world, {
    app: ["app:v1", "app:v1", "app:v1", V1_ID],
    "app-canary": [],
  });
});

Deno.test("abort after a promotion that failed part-way surges the canary on the stable image before recreating", async () => {
  // The stable service was recreated on the candidate, then the last command
  // failed. Compose recreates every stable replica at once, so the canary
  // holds the load on the stable image while it does.
  const { runner, world } = fakeCompose();
  const ctx = await staged(runner);
  let left = 5;
  const flaky = platform((settings, env) => {
    if (left-- === 0) return Promise.reject(new Error("daemon went away"));
    return runner(settings, env);
  });
  await assertRejects(() => flaky.promote(ctx), Error, "daemon went away");
  assertEquals(ctx.state.get().composeCanaryStage, "promoting");
  assertEquals(world.app, [V2_ID, V2_ID, V2_ID, V2_ID]);
  const recorded = fakeCompose({ world });
  await platform(recorded.runner).abort(ctx);
  assertEquals(recorded.calls, [
    { argv: projects(), env: PINNED },
    { argv: images("app"), env: ALL_V1 },
    { argv: ps("app"), env: ALL_V1 },
    { argv: scale("app-canary", 4), env: ALL_V1 },
    { argv: scale("app", 4), env: ALL_V1 },
    { argv: images("app"), env: ALL_V1 },
    { argv: scale("app-canary", 0), env: ALL_V1 },
  ]);
  assertEquals(world, {
    app: [V1_ID, V1_ID, V1_ID, V1_ID],
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
  assertEquals(calls.map((c) => c.argv.slice(3, 6).join(" ")), [
    "ps --format {{.Image}}",
    "images --quiet app",
    "ps -a --format",
    "pull --policy missing",
  ]);
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
    { argv: ps("app"), env: ALL_V1_TAG },
    { argv: scale("app", 4, true, false), env: ALL_V1_TAG },
    { argv: ps("app"), env: ALL_V1_TAG },
    { argv: scale("app-canary", 0, false, false), env: ALL_V1_TAG },
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
    { argv: ps("app"), env: ALL_V1_TAG },
    { argv: scale("app-canary", 4, false, false), env: ALL_V1_TAG },
    { argv: scale("app", 4, false, false), env: ALL_V1_TAG },
    { argv: ps("app"), env: ALL_V1_TAG },
    { argv: scale("app-canary", 0, false, false), env: ALL_V1_TAG },
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
    { argv: projects(), env: BOTH_V1 },
    { argv: scale("app-canary", 1, true), env: BOTH_V1 },
    { argv: ps("app-canary"), env: BOTH_V1 },
    { argv: images("app-canary"), env: BOTH_V1 },
    { argv: scale("app", 3, true), env: BOTH_V1 },
    { argv: projects(), env: PINNED },
    { argv: images("app"), env: ALL_V1 },
    { argv: scale("app", 4, true), env: ALL_V1 },
    { argv: images("app"), env: ALL_V1 },
    { argv: scale("app-canary", 0), env: ALL_V1 },
  ]);
  calls.length = 0;
  await drifted.promote(ctx);
  assertEquals(calls.map((c) => c.argv), [
    projects(),
    scale("app-canary", 4, true),
    scale("app", 4),
    images("app"),
    scale("app-canary", 0),
  ]);
  assertEquals(calls[2].env, ALL_V2_ID);
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
      "SystemRoot",
      "PATHEXT",
      "ssh_auth_sock",
      "SSL_CERT_FILE",
      "SSL_CERT_DIR",
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

/** A context whose record is the default stage's, moved on to `extra`. */
async function recordedAs(extra: Record<string, JsonValue> = {}) {
  const ctx = context();
  await ctx.state.set({ ...STAGED, ...extra });
  return ctx;
}

/** The recorded states in which each call runs a command. */
const RECORDED_STATES: Record<string, JsonValue>[] = [
  {},
  { composeCanaryCandidateId: V2_ID, composeCanaryReplicas: 2 },
  { composeCanaryStage: "promoting", composeCanaryCandidateId: V2_ID },
];

/** Global lambdas that select some other project than `-p shop`. */
const OTHER_PROJECTS: [
  string,
  (s: DockerComposeSettings) => DockerComposeSettings,
][] = [
  ["`-p other`", (s) => s.usePlugin().projectName("other")],
  [
    "`-f compose.yml -p shop`",
    (s) => s.file("compose.yml").projectName("shop"),
  ],
  [
    "`-p shop --project-directory /srv/other`",
    (s) => s.projectName("shop").projectDirectory("/srv/other"),
  ],
  ["no global flags", (s) => s.usePlugin()],
];

Deno.test("stage records the project scope the global lambda gives, and no .env values", async () => {
  // Without a lambda there are no global flags to record.
  const bare = fakeCompose();
  const none = context();
  await platform(bare.runner, (d) => {
    d.compose_ = undefined;
    return d;
  }).stage(none);
  assertEquals(none.state.get().composeCanaryProject, []);
  assertEquals(bare.calls[0].argv, [
    "compose",
    "ps",
    "--format",
    "{{.Image}}",
    "app",
  ]);
  // Every global flag, in the order Compose gets it; neither the invocation
  // form nor what .env(...) passes, which may be a secret.
  const { runner, calls } = fakeCompose();
  const ctx = context();
  await platform(
    runner,
    (d) =>
      d.compose((s) =>
        s.useStandalone().file("a.yml").file("b.yml").projectName("shop")
          .profile("web").projectDirectory("/srv/shop").envFile("prod.env")
          .env({ REGISTRY_TOKEN: "hunter2" }).cwd("/srv")
      ),
  ).stage(ctx);
  const flags = [
    "-f",
    "a.yml",
    "-f",
    "b.yml",
    "-p",
    "shop",
    "--profile",
    "web",
    "--project-directory",
    "/srv/shop",
    "--env-file",
    "prod.env",
  ];
  assertEquals(ctx.state.get().composeCanaryProject, flags);
  assertEquals(JSON.stringify(ctx.state.get()).includes("hunter2"), false);
  assertEquals(calls[0].argv.slice(0, flags.length), flags);
  // The invocation form is how Compose is run, not which project: a later
  // call through the plugin form is the same project.
  const plugin = platform(
    runner,
    (d) =>
      d.compose((s) =>
        s.usePlugin().file("a.yml").file("b.yml").projectName("shop")
          .profile("web").projectDirectory("/srv/shop").envFile("prod.env")
      ),
  );
  calls.length = 0;
  assertEquals(await plugin.expose(25, ctx), 25);
  // The project read runs with the recorded flags.
  assertEquals(calls[0].argv, [
    "compose",
    ...flags,
    "ps",
    "-a",
    "--format",
    PROJECT_TEMPLATE,
    "app",
    "app-canary",
  ]);
});

Deno.test("a call whose lambda selects another project refuses before any command", async () => {
  for (const [shown, other] of OTHER_PROJECTS) {
    for (const extra of RECORDED_STATES) {
      const { runner, calls, world } = fakeCompose();
      const before = structuredClone(world);
      const moved = platform(runner, (d) => d.compose(other));
      const calls_ = [
        (ctx: ReturnType<typeof context>) => moved.expose(25, ctx),
        (ctx: ReturnType<typeof context>) => moved.promote(ctx),
        (ctx: ReturnType<typeof context>) => moved.abort(ctx),
      ];
      for (const call of calls_) {
        const ctx = await recordedAs(extra);
        const state = ctx.state.get();
        const error = await assertRejects(() => call(ctx), Error);
        assertStringIncludes(
          error.message,
          "dockerComposeCanary: this rollout started on the Compose project " +
            `selected by \`-p shop\`, but d.compose(...) now gives ${shown}, ` +
            "so this call changed nothing",
        );
        assertEquals(ctx.state.get(), state);
      }
      assertEquals(calls, []);
      assertEquals(world, before);
    }
  }
});

Deno.test("abort refuses another project whatever stage the record says it reached", async () => {
  // A record past promotion, or with a stage this version does not know, is
  // still a record of the project the rollout ran in.
  for (const stage of ["promoted", "mystery"]) {
    const { runner, calls, world } = fakeCompose();
    const before = structuredClone(world);
    const ctx = await recordedAs({
      composeCanaryStage: stage,
      composeCanaryCandidateId: V2_ID,
    });
    await assertRejects(
      () =>
        platform(
          runner,
          (d) => d.compose((s) => s.usePlugin().projectName("other")),
        ).abort(ctx),
      Error,
      "selected by `-p shop`, but d.compose(...) now gives `-p other`",
    );
    assertEquals(calls, []);
    assertEquals(world, before);
  }
});

Deno.test("flags are compared as written, so a reordering is refused too", async () => {
  const { runner, calls } = fakeCompose();
  const ctx = context();
  await platform(
    runner,
    (d) => d.compose((s) => s.file("a.yml").file("b.yml").projectName("shop")),
  ).stage(ctx);
  calls.length = 0;
  await assertRejects(
    () =>
      platform(
        runner,
        (d) =>
          d.compose((s) => s.file("b.yml").file("a.yml").projectName("shop")),
      ).expose(25, ctx),
    Error,
    "now gives `-f b.yml -f a.yml -p shop`",
  );
  assertEquals(calls, []);
});

Deno.test("the project refusal gives a hand-run recovery naming the recorded stable image", async () => {
  const { runner } = fakeCompose();
  const ctx = await recordedAs({ composeCanaryProject: [] });
  const error = await assertRejects(
    () => platform(runner).abort(ctx),
    Error,
  );
  for (
    const part of [
      "selected by no global flags, but d.compose(...) now gives `-p shop`",
      "rather than move app and app-canary in a project the rollout never " +
      "staged",
      "compared as written, in order",
      "a resume or `zuke cancel` will not roll it back",
      "set the configuration and environment back to what the rollout " +
      "started with",
      "check with `docker compose ps`",
      "run the rollout's <field>.abort target by hand (for example " +
      `\`zuke rollout.abort\`) with d.stable('${V1_ID}') — the stable ` +
      "image ID the rollout recorded, which a tag that moved cannot change " +
      "— or d.stable('app:v1') if that tag still resolves to it",
    ]
  ) {
    assertStringIncludes(error.message, part);
  }
});

Deno.test("a record with no usable project scope is refused before any command", async () => {
  const { runner, calls } = fakeCompose();
  const p = platform(runner);
  for (
    const scope of [undefined, "-p shop", null, [1], ["-p", 2], { p: "shop" }]
  ) {
    for (
      const call of [
        (ctx: ReturnType<typeof context>) => p.expose(25, ctx),
        (ctx: ReturnType<typeof context>) => p.promote(ctx),
        (ctx: ReturnType<typeof context>) => p.abort(ctx),
      ]
    ) {
      const ctx = context();
      const record: Record<string, JsonValue> = { ...STAGED };
      if (scope === undefined) delete record.composeCanaryProject;
      else record.composeCanaryProject = scope;
      await ctx.state.set(record);
      await assertRejects(
        () => call(ctx),
        Error,
        "this rollout's record has no usable composeCanaryProject, so it " +
          "cannot tell which project, services and images it acts on",
      );
    }
  }
  assertEquals(calls, []);
});

Deno.test("a hand-run abort has no record, so it acts on whatever project the lambda selects", async () => {
  const { runner, calls } = fakeCompose({
    world: { app: ["app:v1", "app:v1"], "app-canary": ["app:v2", "app:v2"] },
  });
  await platform(
    runner,
    (d) => d.stable("app:v1").compose((s) => s.projectName("other")),
  ).abort(context());
  assertEquals(calls.length, 4);
  for (const call of calls) {
    assertEquals(call.argv.slice(0, 3), ["compose", "-p", "other"]);
  }
});

Deno.test("a lambda that gives different flags from one command to the next is refused before that command runs", async () => {
  // The probe and each command run the lambda separately: one that reads a
  // clock or a counter must not send a single command to another project.
  let runs = 0;
  const drifting = (s: DockerComposeSettings) =>
    s.projectName(runs++ === 0 ? "shop" : "other");
  const { runner, calls } = fakeCompose();
  const ctx = context();
  await assertRejects(
    () => platform(runner, (d) => d.compose(drifting)).stage(ctx),
    Error,
    "d.compose(...) gave this command `compose -p other ps --format " +
      "{{.Image}} app` where this call resolved the global flags `-p shop`, " +
      "so it does not run",
  );
  assertEquals(calls, []);
  // Trailing arguments that appear only after the probe are caught the same
  // way: the command's own operands must end it.
  let tailRuns = 0;
  const late = (s: DockerComposeSettings) =>
    tailRuns++ === 0 ? s.projectName("shop") : s.projectName("shop").args("x");
  await assertRejects(
    () => platform(runner, (d) => d.compose(late)).stage(context()),
    Error,
    "d.compose(...) gave this command",
  );
  assertEquals(calls, []);
});

Deno.test("a trailing argument spelled like the probe's placeholder is still a trailing argument", async () => {
  const { runner, calls } = fakeCompose();
  await assertRejects(
    () =>
      platform(
        runner,
        (d) => d.compose((s) => s.projectName("shop").args("<subcommand>")),
      ).stage(context()),
    Error,
    "d.compose(...) adds trailing arguments (<subcommand>)",
  );
  assertEquals(calls, []);
  // As a flag's value it is only an unusual project name.
  const ctx = context();
  await platform(
    runner,
    (d) => d.compose((s) => s.projectName("<subcommand>")),
  ).stage(ctx);
  assertEquals(ctx.state.get().composeCanaryProject, ["-p", "<subcommand>"]);
});

Deno.test("stage refuses stable replicas that are not in one Compose project", async () => {
  for (
    const [reported, message] of [
      ["", "replicas of app in no project"],
      ["shop\nother\n", "replicas of app in several projects (shop, other)"],
      ["Shop!\n", '"Shop!" (the project ps reported for app) is not a Compose'],
    ]
  ) {
    const { runner, calls } = fakeCompose({ projects: reported });
    const ctx = context();
    await assertRejects(() => platform(runner).stage(ctx), Error, message);
    // Read, and refused before the pull or any move.
    assertEquals(calls.map((c) => c.argv[3]), ["ps", "images", "ps"]);
    assertEquals(ctx.state.get(), { composeCanaryStage: "deploying" });
  }
});

/** Every call with a record, as the refusal matrix drives them. */
function recordedCalls(p: ReturnType<typeof platform>) {
  return [
    (ctx: ReturnType<typeof context>) => p.expose(25, ctx),
    (ctx: ReturnType<typeof context>) => p.promote(ctx),
    (ctx: ReturnType<typeof context>) => p.abort(ctx),
  ];
}

Deno.test("a call refuses, after only the project read, when Compose reports the services in another project", async () => {
  // The flags are the same; COMPOSE_PROJECT_NAME, a .env file or the working
  // directory changed what they resolve to.
  const cases: [Fake, string][] = [
    [
      { project: "shop-staging" },
      "Compose now reports app and app-canary in shop-staging",
    ],
    [
      { projects: "shop\nother\n" },
      "Compose now reports app and app-canary in shop, other",
    ],
    [
      { world: { app: [], "app-canary": [] } },
      "Compose now reports no container of app and app-canary, running or " +
      "stopped, in the project it resolves — a live rollout always has some, since " +
      "the total never dips —",
    ],
  ];
  for (const [fake, found] of cases) {
    const extras: Record<string, JsonValue>[] = [
      ...RECORDED_STATES,
      { composeCanaryStage: "promoted", composeCanaryCandidateId: V2_ID },
      { composeCanaryStage: "mystery" },
    ];
    for (const extra of extras) {
      const { runner, calls, world } = fakeCompose({ ...fake });
      const before = structuredClone(world);
      const p = platform(runner);
      // A promoted record makes promote a no-op, which reads nothing.
      const each = extra.composeCanaryStage === "promoted" ||
          extra.composeCanaryStage === "mystery"
        ? recordedCalls(p).slice(2)
        : recordedCalls(p);
      for (const call of each) {
        calls.length = 0;
        const ctx = await recordedAs(extra);
        const state = ctx.state.get();
        const error = await assertRejects(() => call(ctx), Error);
        assertStringIncludes(
          error.message,
          "dockerComposeCanary: this rollout started in the Compose project " +
            `shop, but `,
        );
        assertStringIncludes(error.message, found);
        assertStringIncludes(
          error.message,
          "this call changed nothing rather than act on a project the " +
            "rollout never staged",
        );
        assertEquals(calls.map((c) => c.argv), [projects()]);
        assertEquals(ctx.state.get(), state);
      }
      assertEquals(world, before);
    }
  }
});

Deno.test("the reported-project refusal says what changes the project and how to recover", async () => {
  const { runner } = fakeCompose({ project: "shop-staging" });
  const ctx = await recordedAs();
  const error = await assertRejects(
    () => platform(runner).abort(ctx),
    Error,
  );
  for (
    const part of [
      "with the same global flags Compose now reports app and app-canary in " +
      "shop-staging, so this call changed nothing",
      "COMPOSE_PROJECT_NAME or COMPOSE_FILE in the environment, a .env or " +
      "--env-file that sets them, the working directory, or a Docker " +
      "context or DOCKER_HOST that reaches another daemon",
      "set the configuration and environment back to what the rollout " +
      "started with",
      `with d.stable('${V1_ID}')`,
    ]
  ) {
    assertStringIncludes(error.message, part);
  }
});

Deno.test("a record with no usable project name is refused before any command", async () => {
  const { runner, calls } = fakeCompose();
  for (
    const [name, message] of [
      [undefined, "has no usable composeCanaryProjectName"],
      [7, "has no usable composeCanaryProjectName"],
      [null, "has no usable composeCanaryProjectName"],
      ["Shop", '"Shop" (the recorded project) is not a Compose project name'],
    ] as const
  ) {
    for (const call of recordedCalls(platform(runner))) {
      const record: Record<string, JsonValue> = { ...STAGED };
      if (name === undefined) delete record.composeCanaryProjectName;
      else record.composeCanaryProjectName = name;
      const ctx = context();
      await ctx.state.set(record);
      await assertRejects(() => call(ctx), Error, message);
    }
  }
  assertEquals(calls, []);
});

Deno.test("a recorded abort restores a project whose containers are all stopped", async () => {
  // A daemon restart during a parked approval, with restart: no. The project
  // read counts stopped containers, so the rollback is not refused, and
  // images, which counts them too, finds the stable ID: the keep path starts
  // them.
  const { runner, calls, world } = fakeCompose({
    world: { app: ["app:v1", "app:v1", "app:v1"], "app-canary": [V2_ID] },
    stopped: ["app", "app-canary"],
  });
  const ctx = await recordedAs({
    composeCanaryCandidateId: V2_ID,
    composeCanaryReplicas: 1,
  });
  await platform(runner).abort(ctx);
  assertEquals(calls.map((c) => c.argv), [
    projects(),
    images("app"),
    scale("app", 4, true),
    images("app"),
    scale("app-canary", 0),
  ]);
  assertEquals(world, {
    app: ["app:v1", "app:v1", "app:v1", V1_ID],
    "app-canary": [],
  });
});

Deno.test("a hand-run abort on a stopped project brings the stable service up first, rather than read no replicas as on the stable image", async () => {
  // ps lists no running replica; that is not every replica on the stable
  // image, so the stable service is brought up on it — recreated where it
  // must be — before the canary is emptied.
  const { runner, calls, world } = fakeCompose({
    world: { app: ["app:v2", "app:v2", "app:v2", "app:v2"], "app-canary": [] },
    stopped: ["app"],
  });
  const ctx = context();
  await platform(runner, (d) => d.stable(V1_ID)).abort(ctx);
  assertEquals(calls.map((c) => c.argv), [
    ps("app"),
    scale("app", 4),
    ps("app"),
    scale("app-canary", 0),
  ]);
  assertEquals(world, {
    app: [V1_ID, V1_ID, V1_ID, V1_ID],
    "app-canary": [],
  });
});

Deno.test("a hand-run abort with no stable replica brings it up first, while the canary keeps serving", async () => {
  // The canary serves everything — a crashed stable service, or one removed
  // after a promotion failed. Recreating the canary first would take every
  // serving container down at once.
  const { runner, calls, world, serving } = fakeCompose({
    world: { app: [], "app-canary": [V2_ID, V2_ID, V2_ID, V2_ID] },
  });
  await platform(runner, (d) => d.stable(V1_ID)).abort(context());
  assertEquals(calls.map((c) => c.argv), [
    ps("app"),
    scale("app", 4),
    ps("app"),
    scale("app-canary", 0),
  ]);
  // Eight while both serve, never fewer than the four stable ones.
  assertEquals(serving, [8, 4, 4]);
  assertEquals(world, { app: [V1_ID, V1_ID, V1_ID, V1_ID], "app-canary": [] });
});

Deno.test("a recorded abort after a step to 100 % brings the stable service up first", async () => {
  // expose(100) leaves no stable replica at all; images, which counts
  // stopped ones too, finds none, so nothing needs protecting but the
  // canary, which is never recreated.
  const { runner, calls, world, serving } = fakeCompose();
  const ctx = await staged(runner);
  const p = platform(runner);
  await p.expose(100, ctx);
  assertEquals(world.app, []);
  calls.length = 0;
  serving.length = 0;
  await p.abort(ctx);
  assertEquals(calls.map((c) => c.argv), [
    projects(),
    images("app"),
    scale("app", 4),
    images("app"),
    scale("app-canary", 0),
  ]);
  assertEquals(Math.min(...serving) > 0, true);
  assertEquals(world, { app: [V1_ID, V1_ID, V1_ID, V1_ID], "app-canary": [] });
});

Deno.test("a recorded abort whose stable replicas are all stopped on another image brings them up first", async () => {
  // A promotion recreated them on the candidate, then the daemon stopped
  // them; only the canary serves.
  const { runner, calls, world, serving } = fakeCompose({
    world: { app: [V2_ID, V2_ID, V2_ID, V2_ID], "app-canary": [V2_ID] },
    stopped: ["app"],
  });
  const ctx = await recordedAs({
    composeCanaryStage: "promoting",
    composeCanaryCandidateId: V2_ID,
  });
  await platform(runner).abort(ctx);
  assertEquals(calls.map((c) => c.argv), [
    projects(),
    images("app"),
    ps("app"),
    scale("app", 4),
    images("app"),
    scale("app-canary", 0),
  ]);
  assertEquals(Math.min(...serving) > 0, true);
  assertEquals(world, { app: [V1_ID, V1_ID, V1_ID, V1_ID], "app-canary": [] });
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
 * project `shop` for the project read, the stable variable it was
 * run with for any other `ps`, and exits 1 for `up` when
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
      '  *"com.docker.compose.project"*) echo shop ;;',
      '  *" ps "*) echo "$APP_IMAGE" ;;',
      `  *" images "*) echo ${V1_HEX} ;;`,
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
    `set APP_IMAGE=app:v2 (which must resolve to ${V2_ID}) and keep scale: 4`,
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

Deno.test("a stable tag moved mid-rollout cannot bring a never-analysed image into the stable service", async () => {
  // A local pull or build moves app:v1 to another image. ps now reports the
  // stable replicas by ID, and a rollback that recreated them from the tag
  // would install a release nobody analysed — while reporting success.
  const { runner, calls, world, tags } = fakeCompose();
  const ctx = await staged(runner);
  const p = platform(runner);
  await p.expose(50, ctx);
  tags["app:v1"] = V3_HEX;
  world.app = [V1_ID, V1_ID];
  calls.length = 0;
  await p.abort(ctx);
  assertEquals(calls, [
    { argv: projects(), env: PINNED },
    { argv: images("app"), env: ALL_V1 },
    { argv: scale("app", 4, true), env: ALL_V1 },
    { argv: images("app"), env: ALL_V1 },
    { argv: scale("app-canary", 0), env: ALL_V1 },
  ]);
  assertEquals(world, { app: [V1_ID, V1_ID, V1_ID, V1_ID], "app-canary": [] });
});

Deno.test("abort decides by the recorded ID, not by the tag ps shows", async () => {
  // Replicas shown by tag or by ID that resolve to the recorded ID are left
  // in place.
  const { runner, calls, world, tags } = fakeCompose();
  const ctx = await staged(runner);
  world.app = ["app:v1", V1_ID];
  calls.length = 0;
  await platform(runner).abort(ctx);
  assertEquals(calls.map((c) => c.argv), [
    projects(),
    images("app"),
    scale("app", 4, true),
    images("app"),
    scale("app-canary", 0),
  ]);
  // A tag ps shows means whatever the tag names now: replicas created from
  // app:v1 after it moved run another image, and must be recreated on the ID.
  tags["app:v1"] = V3_HEX;
  world.app = ["app:v1", "app:v1", "app:v1", "app:v1"];
  calls.length = 0;
  await platform(runner).abort(ctx);
  assertEquals(calls.map((c) => c.argv), [
    projects(),
    images("app"),
    ps("app"),
    scale("app-canary", 4),
    scale("app", 4),
    images("app"),
    scale("app-canary", 0),
  ]);
  assertEquals(world.app, [V1_ID, V1_ID, V1_ID, V1_ID]);
});

Deno.test("promote installs the candidate the steps ran, even if its tag moved since", async () => {
  // The analysis judged the canary's image; a pull or build that moves
  // app:v2 afterwards must not change what promote puts in the stable
  // service.
  const { runner, calls, world, tags } = fakeCompose();
  const ctx = await staged(runner);
  const p = platform(runner);
  await p.expose(25, ctx);
  tags["app:v2"] = V3_HEX;
  calls.length = 0;
  await p.promote(ctx);
  assertEquals(calls[2], { argv: scale("app", 4), env: ALL_V2_ID });
  assertEquals(world.app, [V2_ID, V2_ID, V2_ID, V2_ID]);
});

Deno.test("a later step refuses a canary that no longer resolves to the pinned candidate", async () => {
  const { runner, world, tags } = fakeCompose();
  const ctx = await staged(runner);
  const p = platform(runner);
  await p.expose(25, ctx);
  // Something recreated the canary from the moved tag behind the rollout.
  tags["app:v2"] = V3_HEX;
  world["app-canary"] = ["app:v2"];
  await assertRejects(
    () => p.expose(25, ctx),
    Error,
    `resolve to sha256:${V3_HEX}, not the ${V2_ID} an earlier step ran — ` +
      "the candidate tag app:v2 has moved.",
  );
  // And one on several images is refused, naming the stopped replicas
  // images counts.
  const fresh = await staged(fakeCompose().runner);
  const { runner: split } = fakeCompose({
    answer: (argv) =>
      argv.includes("images") && argv.at(-1) === "app-canary"
        ? new CommandOutput(0, `${V2_HEX}\n${V3_HEX}\n`, "")
        : undefined,
  });
  await assertRejects(
    () => platform(split).expose(25, fresh),
    Error,
    "images counts stopped replicas and one-off `docker compose run` " +
      "containers too, so remove any left on another image with " +
      "`docker compose rm` (and use `run --rm`) — so there is no one " +
      "candidate image for the analysis to judge.",
  );
});

Deno.test("every move that sets an image ID passes --pull never, so pull_policy: always cannot fail it", async () => {
  // A hand-run rollback to a tag may still pull; one to an ID may not.
  const { runner, calls } = fakeCompose({
    world: { app: [V1_ID, V1_ID, V1_ID, V1_ID], "app-canary": [] },
  });
  await platform(runner, (d) => d.stable(V1_ID)).abort(context());
  assertEquals(
    calls.filter((c) => c.argv.includes("up")).map((c) =>
      c.argv.includes("never")
    ),
    [true, true],
  );
});

Deno.test("stage refuses stable replicas that do not resolve to one full image ID", async () => {
  for (
    const [listed, message] of [
      ["", "resolve to no image ID"],
      [
        `${V1_HEX}\n${V2_HEX}\n`,
        `several image IDs (${V1_ID}, sha256:${V2_HEX})`,
      ],
      [
        "a1a1a1\n",
        `"a1a1a1" (an image ID images reported for app) is not a full image ID`,
      ],
    ]
  ) {
    const { runner, calls } = fakeCompose({ images: listed });
    await assertRejects(
      () => platform(runner).stage(context()),
      Error,
      message,
    );
    assertEquals(calls.map((c) => c.argv[3]), ["ps", "images"]);
  }
  // The sha256: form is read as the same ID.
  const { runner } = fakeCompose({ images: `${V1_ID}\n` });
  const ctx = context();
  await platform(runner).stage(ctx);
  assertEquals(ctx.state.get().composeCanaryStableImageId, V1_ID);
});

Deno.test("a recorded stable image ID that is not one is refused", async () => {
  const { runner, calls } = fakeCompose();
  const ctx = context();
  await ctx.state.set({ ...STAGED, composeCanaryStableImageId: "app:v1" });
  await assertRejects(
    () => platform(runner).abort(ctx),
    Error,
    "(the recorded stable image ID) is not a full image ID",
  );
  assertEquals(calls, []);
});

Deno.test("promote reports what to persist before it records the promotion", async () => {
  // A process that dies between the two re-drives the promotion and reports
  // again; the other order would leave it recorded and never reported.
  const { runner } = fakeCompose();
  const ctx = await staged(runner);
  const set = ctx.state.set;
  let reportedWhenRecorded: unknown;
  ctx.state.set = (patch) => {
    if (patch.composeCanaryStage === "promoted") {
      reportedWhenRecorded = ctx.summary.Persist;
    }
    return set(patch);
  };
  await platform(runner).promote(ctx);
  assertEquals(
    reportedWhenRecorded,
    `set APP_IMAGE=app:v2 (which must resolve to ${V2_ID}) and keep scale: 4`,
  );
});

Deno.test("a rollback whose recreate changed nothing refuses rather than report itself done", async () => {
  // The stable image: is a literal, so setting the variable recreates the
  // replicas on the same wrong image. Run by hand, ps judges by reference.
  const { runner, calls, world } = fakeCompose({
    world: {
      app: ["app:v2", "app:v2", "app:v2", "app:v2"],
      "app-canary": [],
    },
    hardCoded: { app: "app:v0" },
  });
  const ctx = context();
  await assertRejects(
    () => platform(runner, (d) => d.stable("app:v1")).abort(ctx),
    Error,
    "the service app runs app:v0, app:v0, app:v0, app:v0 after the platform " +
      "set APP_IMAGE to app:v1, so its image: does not read that variable. " +
      "Make it image: ${APP_IMAGE}.",
  );
  assertEquals(ctx.summary, {});
  // The canary keeps serving the stable image while someone looks.
  assertEquals(calls.at(-1)?.argv, ps("app"));
  assertEquals(world["app-canary"], ["app:v1", "app:v1", "app:v1", "app:v1"]);
  // From no running stable replicas at all, the stable service comes up
  // first, on the literal: that is checked too.
  const { runner: empty, calls: made } = fakeCompose({
    world: { app: [], "app-canary": [] },
    hardCoded: { app: "app:v0" },
  });
  await assertRejects(
    () => platform(empty, (d) => d.stable("app:v1")).abort(context()),
    Error,
    "the service app runs app:v0, app:v0, app:v0, app:v0 after",
  );
  assertEquals(made.map((c) => c.argv), [
    ps("app"),
    scale("app", 4, false, false),
    ps("app"),
  ]);
  // On a recorded rollout the check is by ID.
  const recorded = await staged(fakeCompose().runner);
  const { runner: literal } = fakeCompose({
    world: { app: [V2_ID, V2_ID, V2_ID, V2_ID], "app-canary": [] },
    hardCoded: { app: "app:v0" },
    tags: { "app:v0": V3_HEX },
  });
  await assertRejects(
    () => platform(literal).abort(recorded),
    Error,
    `the service app runs sha256:${V3_HEX} after the platform set APP_IMAGE ` +
      `to ${V1_ID}`,
  );
});

Deno.test("a canary shown by an ID that images agrees on is pinned, even after its tag moved", async () => {
  // A process died after the first canary replica started and before the
  // pin; then app:v2 moved. ps shows the replica by its ID, which is still
  // the candidate it was created from.
  const { runner, world, tags } = fakeCompose();
  const ctx = await staged(runner);
  tags["app:v2"] = V3_HEX;
  world["app-canary"] = [V2_ID];
  assertEquals(await platform(runner).expose(25, ctx), 25);
  assertEquals(ctx.state.get().composeCanaryCandidateId, V2_ID);
});

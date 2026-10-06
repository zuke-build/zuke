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

/**
 * A runner that records every command and answers `ps` with `serving` — the
 * image lines a real `ps --format {{.Image}}` prints.
 */
function fakeCompose(serving = "app:v1\napp:v1\n"): {
  runner: DockerComposeSettingsRunner;
  calls: Call[];
} {
  const calls: Call[] = [];
  const runner = (
    settings: DockerComposeSettings,
    env: Readonly<Record<string, string>>,
  ): Promise<CommandOutput> => {
    const argv = settings.argv().slice(1);
    calls.push({ argv, env: { ...env } });
    const stdout = argv.includes("ps") ? serving : "";
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

const BOTH_V1 = { APP_CANARY_IMAGE: "app:v2", APP_IMAGE: "app:v1" };

/** A context whose state is the one a successful stage leaves. */
async function staged(runner: DockerComposeSettingsRunner) {
  const ctx = context();
  await platform(runner).stage(ctx);
  return ctx;
}

Deno.test("stage records the stable image, pulls the candidate, and settles at 0 %", async () => {
  const { runner, calls } = fakeCompose();
  const ctx = context();
  await platform(runner).stage(ctx);
  assertEquals(calls, [
    {
      argv: [
        "compose",
        "-p",
        "shop",
        "ps",
        "--format",
        "{{.Image}}",
        "app",
      ],
      env: { APP_CANARY_IMAGE: "app:v2", APP_IMAGE: "app:v2" },
    },
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
      env: { APP_CANARY_IMAGE: "app:v2", APP_IMAGE: "app:v2" },
    },
    { argv: scale("app", 4, true), env: BOTH_V1 },
    { argv: scale("app-canary", 0), env: BOTH_V1 },
  ]);
  assertEquals(ctx.state.get(), {
    composeCanaryStage: "staged",
    composeCanaryImage: "app:v2",
    composeCanaryStableImage: "app:v1",
  });
  assertEquals(ctx.summary, { Candidate: "app:v2", Stable: "app:v1" });
});

Deno.test("expose scales the canary up first, then the stable service down", async () => {
  const { runner, calls } = fakeCompose();
  const ctx = await staged(runner);
  const p = platform(runner);
  calls.length = 0;
  assertEquals(await p.expose(25, ctx), 25);
  assertEquals(calls, [
    { argv: scale("app-canary", 1), env: BOTH_V1 },
    { argv: scale("app", 3, true), env: BOTH_V1 },
  ]);
  calls.length = 0;
  assertEquals(await p.expose(50, ctx), 50);
  assertEquals(calls.map((c) => c.argv), [
    scale("app-canary", 2),
    scale("app", 2, true),
  ]);
  assertEquals(ctx.state.get().composeCanaryReplicas, 2);
});

Deno.test("expose to a smaller share grows the stable service first", async () => {
  const { runner, calls } = fakeCompose();
  const ctx = await staged(runner);
  const p = platform(runner);
  await p.expose(75, ctx);
  calls.length = 0;
  assertEquals(await p.expose(0, ctx), 0);
  assertEquals(calls.map((c) => c.argv), [
    scale("app", 4, true),
    scale("app-canary", 0),
  ]);
});

Deno.test("expose quantises to whole replicas and reports what it reached", async () => {
  const { runner, calls } = fakeCompose();
  const ctx = await staged(runner);
  const three = platform(runner, (d) => d.replicas(3));
  // 10 % of 3 rounds to none; a step keeps at least one canary.
  assertEquals(await three.expose(10, ctx), 33.33);
  // 90 % of 3 rounds to all; a step keeps at least one stable replica.
  assertEquals(await three.expose(90, ctx), 66.67);
  assertEquals(await three.expose(100, ctx), 100);
  assertEquals(calls.at(-2)?.argv, scale("app-canary", 3));
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

Deno.test("expose and promote refuse without a stage that succeeded", async () => {
  const { runner, calls } = fakeCompose();
  await assertRejects(
    () => platform(runner).expose(25, context()),
    Error,
    "no staged candidate",
  );
  // A stage that failed after recording the candidate, before the stable image.
  const ctx = context();
  await ctx.state.set({
    composeCanaryStage: "deploying",
    composeCanaryImage: "app:v2",
  });
  await assertRejects(
    () => platform(runner).promote(ctx),
    Error,
    "no staged candidate",
  );
  assertEquals(calls, []);
});

Deno.test("promote hands the stable service to the candidate without a capacity dip", async () => {
  const { runner, calls } = fakeCompose();
  const ctx = await staged(runner);
  const p = platform(runner);
  await p.expose(50, ctx);
  calls.length = 0;
  await p.promote(ctx);
  const env = { APP_CANARY_IMAGE: "app:v2", APP_IMAGE: "app:v2" };
  assertEquals(calls, [
    { argv: scale("app-canary", 4), env },
    { argv: scale("app", 4), env },
    { argv: scale("app-canary", 0), env },
  ]);
  assertEquals(ctx.state.get().composeCanaryStage, "promoted");
  // A second promote — a resume re-driving it — changes nothing.
  calls.length = 0;
  await p.promote(ctx);
  assertEquals(calls, []);
});

Deno.test("abort mid-rollout returns to the recorded stable image, and repeats harmlessly", async () => {
  const { runner, calls } = fakeCompose();
  const ctx = await staged(runner);
  const p = platform(runner);
  await p.expose(25, ctx);
  calls.length = 0;
  await p.abort(ctx);
  await p.abort(ctx);
  const env = { APP_CANARY_IMAGE: "app:v1", APP_IMAGE: "app:v1" };
  const once = [
    { argv: scale("app", 4), env },
    { argv: scale("app-canary", 0), env },
  ];
  assertEquals(calls, [...once, ...once]);
});

Deno.test("abort after a promotion that failed part-way puts the stable image back", async () => {
  // The stable service was recreated on the candidate, then the last command
  // failed: the rollback must recreate it on the image it ran before.
  const { runner } = fakeCompose();
  const ctx = await staged(runner);
  let left = 2;
  const flaky = platform((settings, env) => {
    if (left-- === 0) return Promise.reject(new Error("daemon went away"));
    return runner(settings, env);
  });
  await assertRejects(() => flaky.promote(ctx), Error, "daemon went away");
  assertEquals(ctx.state.get().composeCanaryStage, "promoting");
  const { runner: after, calls } = fakeCompose();
  await platform(after).abort(ctx);
  assertEquals(calls.map((c) => c.env.APP_IMAGE), ["app:v1", "app:v1"]);
  assertEquals(calls[0].argv, scale("app", 4));
});

Deno.test("abort after a stage that changed nothing runs nothing", async () => {
  // The stable read failed: nothing was pulled or scaled.
  const ctx = context();
  const failing = platform(() => Promise.reject(new Error("no daemon")));
  await assertRejects(() => failing.stage(ctx), Error, "no daemon");
  assertEquals(ctx.state.get(), {
    composeCanaryStage: "deploying",
    composeCanaryImage: "app:v2",
  });
  const { runner, calls } = fakeCompose();
  await platform(runner).abort(ctx);
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
    ]
  ) {
    const { runner, calls } = fakeCompose(serving);
    await assertRejects(
      () => platform(runner).stage(context()),
      Error,
      message,
    );
    assertEquals(calls.length, 1);
  }
});

Deno.test("a hand-run abort puts the stable service on the configured image", async () => {
  const { runner, calls } = fakeCompose();
  await platform(runner, (d) => d.stable("app:v1")).abort(context());
  const env = { APP_CANARY_IMAGE: "app:v1", APP_IMAGE: "app:v1" };
  assertEquals(calls, [
    { argv: scale("app", 4), env },
    { argv: scale("app-canary", 0), env },
  ]);
});

Deno.test("a hand-run abort with no stable image refuses rather than claim a rollback", async () => {
  const { runner, calls } = fakeCompose();
  await assertRejects(
    () => platform(runner).abort(context()),
    Error,
    "d.stable('<image>')",
  );
  await assertRejects(
    () => platform(runner, (d) => d.stable("")).abort(context()),
    Error,
    "d.stable('<image>')",
  );
  assertEquals(calls, []);
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
      (d) => d.service("app").canaryService("c").replicas(2),
      "no candidate image",
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
    const variable of ["DOCKER_HOST", "COMPOSE_FILE", "compose_project_name"]
  ) {
    await assertRejects(
      () =>
        platform(runner, (d) => d.stableImageVariable(variable)).stage(
          context(),
        ),
      Error,
      "one of Docker's or Compose's own settings",
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

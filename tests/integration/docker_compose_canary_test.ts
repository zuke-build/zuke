// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the canary engine from `@zuke/canary` driving the Compose
 * platform from `@zuke/docker-compose`, through the real CLI. The two packages
 * never import each other, so this is also where they are proven to fit:
 * `c.platform(dockerComposeCanary(...))` type-checks and runs end to end.
 *
 * A fake Compose stands in for the daemon: it keeps the containers of each
 * service by the image each runs, applies every `up` to them the way Compose
 * does — recreating on the image the service's variable names unless
 * `--no-recreate` keeps them — and answers `ps` from them.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import {
  Build,
  defaultStateHost,
  FileSystemStateStore,
  target,
} from "../../packages/core/mod.ts";
import { CommandOutput } from "../../packages/core/src/shell.ts";
import { canary } from "../../packages/canary/mod.ts";
import { dockerComposeCanary } from "../../packages/docker-compose/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";

/** One Compose command: its argv after `docker`, and the stable variable. */
interface Call {
  argv: string[];
  stableImage: string | undefined;
}

/** Every Compose command the platform ran. */
let calls: Call[] = [];

/** The containers of each service, by the image each runs. */
let world: Record<string, string[]> = {};

/** Which variable each service's `image:` reads. */
const IMAGE_VARIABLE: Record<string, string> = {
  app: "APP_IMAGE",
  "app-canary": "APP_CANARY_IMAGE",
  "app-next": "APP_CANARY_IMAGE",
};

/** The ID each tag resolves to, as `images --quiet` prints it. */
const TAGS: Record<string, string> = {
  "app:v1": "a1".repeat(32),
  "app:v2": "b2".repeat(32),
};

/** The stable image's ID, as the platform sets it after stage. */
const V1_ID = `sha256:${TAGS["app:v1"]}`;

/** Whether the analysis passes. */
let healthy = true;

/** Whether the last move of a promotion fails. */
let failPromoteTail = false;

/** The image a hand-run rollback goes back to, if the build names one. */
let stable: string | undefined;

/** The candidate image, if the build names one. */
let image: string | undefined;

/** The canary service the lambda names. */
let canaryService = "app-canary";

/** Apply one command to the world, as Compose would. */
function compose(argv: string[], env: Record<string, string>): string {
  const service = argv.at(-1) ?? "";
  if (argv.includes("images")) {
    const ids = new Set(
      (world[service] ?? []).map(idOf),
    );
    return [...ids].map((id) => `${id}\n`).join("");
  }
  if (argv.includes("ps")) {
    return (world[service] ?? []).map((each) => `${each}\n`).join("");
  }
  if (argv.includes("up")) {
    const count = Number(argv[argv.indexOf("--scale") + 1].split("=")[1]);
    const next = env[IMAGE_VARIABLE[service]] ?? "";
    const kept = argv.includes("--no-recreate")
      ? [...(world[service] ?? [])]
      : (world[service] ?? []).map(() => next);
    while (kept.length < count) kept.push(next);
    world[service] = kept.slice(0, count);
  }
  return "";
}

class Deploy extends Build {
  rollout = canary((c) =>
    c.platform(
      dockerComposeCanary((d) => {
        d.service("app").canaryService(canaryService).replicas(4)
          .stableImageVariable("APP_IMAGE")
          .canaryImageVariable("APP_CANARY_IMAGE")
          .compose((s) => s.usePlugin().projectName("shop"))
          .runner((settings, env) => {
            const argv = settings.argv().slice(1);
            calls.push({ argv, stableImage: env.APP_IMAGE });
            if (
              failPromoteTail && env.APP_IMAGE === "app:v2" &&
              argv.includes("app-canary=0")
            ) {
              return Promise.reject(new Error("daemon went away"));
            }
            return Promise.resolve(
              new CommandOutput(0, compose(argv, { ...env }), ""),
            );
          });
        if (image !== undefined) d.image(image);
        if (stable !== undefined) d.stable(stable);
        return d;
      }),
    )
      .steps(25, 50)
      .analysis({
        name: "health",
        validate: () => {
          if (!healthy) throw new Error("error ratio 0.3 above 0.01");
        },
      })
      .approval("approved")
  );
  ship = target()
    .description("Announce the release")
    .dependsOn(this.rollout.promote)
    .executes(() => {});
}

/**
 * The scale moves the platform made, as `<service>=<n>`, with the stable
 * image the command set — `v1-id` for the recorded ID of `app:v1` — and
 * `(keep)` when it recreated nothing.
 */
function moves(): string[] {
  return calls.filter((call) => call.argv.includes("up")).map((call) => {
    const scale = call.argv[call.argv.indexOf("--scale") + 1];
    const keep = call.argv.includes("--no-recreate") ? "(keep)" : "";
    const image = call.stableImage === V1_ID ? "v1-id" : call.stableImage;
    return `${scale}@${image}${keep}`;
  });
}

/** The image ID a container shown as `image` runs. */
function idOf(image: string): string {
  return image.startsWith("sha256:") ? image.slice(7) : TAGS[image];
}

/** Assert every replica is back in the stable service, on app:v1's ID. */
function assertBackOnV1(): void {
  assertEquals(world["app-canary"], []);
  assertEquals(world.app.map(idOf), Array(4).fill(TAGS["app:v1"]));
}

/** The services each `ps` read, in order. */
function reads(): string[] {
  return calls.filter((call) => call.argv.includes("ps")).map((call) =>
    call.argv.at(-1) ?? ""
  );
}

/** The id of the only run under `dir`. */
async function onlyRun(dir: string): Promise<string> {
  const runs = await new FileSystemStateStore(dir, defaultStateHost).listRuns(
    {},
  );
  assertEquals(runs.length, 1);
  return runs[0].id;
}

function fresh(): void {
  calls = [];
  world = { app: ["app:v1", "app:v1", "app:v1", "app:v1"], "app-canary": [] };
  healthy = true;
  failPromoteTail = false;
  stable = undefined;
  image = "app:v2";
  canaryService = "app-canary";
}

const ALL_V1 = ["app:v1", "app:v1", "app:v1", "app:v1"];

Deno.test("Compose: staged, stepped, parked, and promoted by a later process", async () => {
  fresh();
  await withStateDir(async (dir) => {
    const parked = await runCli(Deploy, ["ship"]);
    assertEquals(parked.code, 0, parked.err);
    assertEquals(calls[0].argv.slice(3), [
      "ps",
      "--format",
      "{{.Image}}",
      "app",
    ]);
    assertEquals(moves(), [
      "app=4@v1-id(keep)",
      "app-canary=0@v1-id",
      "app-canary=1@v1-id",
      "app=3@v1-id(keep)",
      "app-canary=2@v1-id",
      "app=2@v1-id(keep)",
    ]);
    assertEquals(reads(), ["app", "app-canary", "app-canary"]);
    assertStringIncludes(parked.out, "app:v2");

    // The resume is a new main(): promote reads the images stage recorded.
    calls = [];
    const resumed = await runCli(Deploy, [
      "resume",
      await onlyRun(dir),
      "--signal",
      "approved",
    ]);
    assertEquals(resumed.code, 0, resumed.err);
    assertEquals(moves(), [
      "app-canary=4@app:v2",
      "app=4@app:v2",
      "app-canary=0@app:v2",
    ]);
    assertEquals(reads(), ["app"]);
    assertEquals(world, {
      app: ["app:v2", "app:v2", "app:v2", "app:v2"],
      "app-canary": [],
    });
  });
});

Deno.test("Compose: a failed analysis puts every replica back on the stable image", async () => {
  fresh();
  healthy = false;
  await withStateDir(async () => {
    const { code, out, err } = await runCli(Deploy, ["ship"]);
    assertEquals(code, 1);
    assertStringIncludes(out + err, "error ratio 0.3 above 0.01");
    // The stable replicas still run the recorded image, so the rollback only
    // scales them back.
    assertEquals(moves().slice(-4), [
      "app-canary=1@v1-id",
      "app=3@v1-id(keep)",
      "app=4@v1-id(keep)",
      "app-canary=0@v1-id",
    ]);
    assertBackOnV1();
  });
});

Deno.test("Compose: a stage its own settings refuse leaves production alone, even with a stable image", async () => {
  // No candidate: stage refuses. Its inline rollback must not take the
  // hand-run path and recreate production on d.stable(...).
  fresh();
  image = undefined;
  stable = "app:v0";
  await withStateDir(async () => {
    const { code, out, err } = await runCli(Deploy, ["ship"]);
    assertEquals(code, 1);
    assertStringIncludes(out + err, "no candidate image");
    assertEquals(calls, []);
    assertEquals(world, { app: ALL_V1, "app-canary": [] });
  });
});

Deno.test("Compose: a cancel from a process whose services resolve differently rolls back the recorded ones", async () => {
  fresh();
  await withStateDir(async (dir) => {
    await runCli(Deploy, ["ship"]);
    canaryService = "app-next";
    calls = [];
    const cancelled = await runCli(Deploy, ["cancel", await onlyRun(dir)]);
    assertEquals(cancelled.code, 0, cancelled.err);
    assertEquals(moves(), ["app=4@v1-id(keep)", "app-canary=0@v1-id"]);
    assertBackOnV1();
  });
});

Deno.test("Compose: a promotion that fails part-way in a later process is rolled back without a capacity dip", async () => {
  fresh();
  await withStateDir(async (dir) => {
    await runCli(Deploy, ["ship"]);
    calls = [];
    // The stable service is recreated on the candidate, then the last move
    // fails — the stable replicas now run an image the rollback must undo,
    // and Compose recreates them all at once, so the canary holds the load.
    failPromoteTail = true;
    const resumed = await runCli(Deploy, [
      "resume",
      await onlyRun(dir),
      "--signal",
      "approved",
    ]);
    assertEquals(resumed.code, 1);
    assertStringIncludes(resumed.out + resumed.err, "daemon went away");
    assertEquals(moves(), [
      "app-canary=4@app:v2",
      "app=4@app:v2",
      "app-canary=0@app:v2",
      "app-canary=4@v1-id",
      "app=4@v1-id",
      "app-canary=0@v1-id",
    ]);
    assertBackOnV1();
  });
});

Deno.test("Compose: a rollback run by hand after a promotion goes to the configured stable image", async () => {
  fresh();
  world = { app: ["app:v2", "app:v2", "app:v2", "app:v2"], "app-canary": [] };
  stable = "app:v1";
  await withStateDir(async () => {
    const { code, err } = await runCli(Deploy, ["rollout.abort"]);
    assertEquals(code, 0, err);
    assertEquals(moves(), [
      "app-canary=4@app:v1",
      "app=4@app:v1",
      "app-canary=0@app:v1",
    ]);
    assertEquals(world, { app: ALL_V1, "app-canary": [] });
  });
});

Deno.test("Compose: a rollback run by hand with no stable image refuses", async () => {
  // After a promote the stable service already runs the candidate, so
  // re-scaling it would change nothing while the summary said "Rolled back".
  fresh();
  await withStateDir(async () => {
    const { code, out, err } = await runCli(Deploy, ["rollout.abort"]);
    assertEquals(code, 1);
    assertStringIncludes(out + err, "d.stable('<image>')");
    assertEquals(calls, []);
  });
});

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

/** The candidate's ID, as the platform sets it once a step ran it. */
const V2_ID = `sha256:${TAGS["app:v2"]}`;

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

/** The Compose project the global lambda names. */
let project = "shop";

/**
 * The project the fake Compose reports each container in, as
 * `ps --format {{.Project}}` prints it — what COMPOSE_PROJECT_NAME, a `.env`
 * file or the working directory resolve the same flags to.
 */
let reportedProject = "shop";

/** Whether the failing promotion move also switches the project. */
let switchProjectOnFailure = false;

/** Apply one command to the world, as Compose would. */
function compose(argv: string[], env: Record<string, string>): string {
  const service = argv.at(-1) ?? "";
  if (argv.includes("{{.Project}}")) {
    return argv.slice(argv.indexOf("--format") + 2).flatMap((each) =>
      (world[each] ?? []).map(() => `${reportedProject}\n`)
    ).join("");
  }
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
          .compose((s) => s.usePlugin().projectName(project))
          .runner((settings, env) => {
            const argv = settings.argv().slice(1);
            calls.push({ argv, stableImage: env.APP_IMAGE });
            if (
              failPromoteTail && env.APP_IMAGE === V2_ID &&
              argv.includes("app-canary=0")
            ) {
              if (switchProjectOnFailure) project = "shop-staging";
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
 * image the command set — `v1-id` and `v2-id` for the recorded IDs — and
 * `(keep)` when it recreated nothing.
 */
function moves(): string[] {
  return calls.filter((call) => call.argv.includes("up")).map((call) => {
    const scale = call.argv[call.argv.indexOf("--scale") + 1];
    const keep = call.argv.includes("--no-recreate") ? "(keep)" : "";
    const image = call.stableImage === V1_ID
      ? "v1-id"
      : call.stableImage === V2_ID
      ? "v2-id"
      : call.stableImage;
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

/**
 * Each `ps` and `images` read, as `<command> <service>` — or
 * `project <services>` for a project read — in order.
 */
function reads(): string[] {
  return calls.filter((call) => !call.argv.includes("up")).map((call) =>
    call.argv.includes("{{.Project}}")
      ? `project ${call.argv.slice(6).join(" ")}`
      : `${call.argv[3]} ${call.argv.at(-1)}`
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
  project = "shop";
  reportedProject = "shop";
  switchProjectOnFailure = false;
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
      "app-canary=1@v1-id(keep)",
      "app=3@v1-id(keep)",
      "app-canary=2@v1-id(keep)",
      "app=2@v1-id(keep)",
    ]);
    assertEquals(reads(), [
      "ps app",
      "images app",
      "project app",
      "pull app-canary",
      "project app app-canary",
      "ps app-canary",
      "images app-canary",
      "project app app-canary",
      "ps app-canary",
      "images app-canary",
    ]);
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
      "app-canary=4@v1-id(keep)",
      "app=4@v2-id",
      "app-canary=0@v2-id",
    ]);
    assertEquals(reads(), ["project app app-canary", "images app"]);
    assertEquals(world, {
      app: [V2_ID, V2_ID, V2_ID, V2_ID],
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
      "app-canary=1@v1-id(keep)",
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
      "app-canary=4@v1-id(keep)",
      "app=4@v2-id",
      "app-canary=0@v2-id",
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

/** How a refusal case moves the project away from the staged one. */
interface Drift {
  /** Change what selects the project. */
  apply(): void;
  /** What the refusal must say about it. */
  says: string;
  /** How many project reads may run before each refusal — and nothing else. */
  reads: number;
}

/** The lambda now gives other flags: refused before any command. */
const OTHER_FLAGS: Drift = {
  apply: () => {
    project = "shop-staging";
  },
  says: "this rollout started on the Compose project selected by `-p shop`, " +
    "but d.compose(...) now gives `-p shop-staging`, so this call changed " +
    "nothing",
  reads: 0,
};

/**
 * The flags are the same, but Compose resolves them to another project, as
 * COMPOSE_PROJECT_NAME or a `.env` file would: refused after the project
 * read.
 */
const OTHER_REPORTED: Drift = {
  apply: () => {
    reportedProject = "shop-staging";
  },
  says: "this rollout started in the Compose project shop, but with the " +
    "same global flags Compose now reports app and app-canary in " +
    "shop-staging, so this call changed nothing",
  reads: 1,
};

/**
 * Park a rollout at its approval, then `drift` the project and drive the run
 * with `drive`: every call refuses, naming both projects, having run at most
 * the project read. The message's own recovery — the configuration and
 * environment set back, the rollback run by hand with the recorded stable
 * image ID — then rolls back.
 */
async function refusedThenRecovered(
  drift: Drift,
  drive: (runId: string) => string[],
  calls_: number,
): Promise<void> {
  fresh();
  await withStateDir(async (dir) => {
    const parked = await runCli(Deploy, ["ship"]);
    assertEquals(parked.code, 0, parked.err);
    const runId = await onlyRun(dir);
    const before = structuredClone(world);
    drift.apply();
    calls = [];
    const refused = await runCli(Deploy, drive(runId));
    assertEquals(refused.code, 1);
    const said = refused.out + refused.err;
    assertStringIncludes(said, drift.says);
    // Each refusing call — the step, and the rollback its failure runs —
    // read at most the project, and changed nothing.
    assertEquals(
      reads(),
      Array(drift.reads * calls_).fill("project app app-canary"),
    );
    assertEquals(moves(), []);
    calls = [];
    assertStringIncludes(
      said,
      `with d.stable('${V1_ID}') — the stable image ID the rollout recorded`,
    );
    assertEquals(calls, []);
    assertEquals(world, before);

    // What the message says will not help, does not: the run is settled, so
    // neither a resume nor a cancel reaches the platform again.
    const resumed = await runCli(Deploy, [
      "resume",
      runId,
      "--signal",
      "approved",
    ]);
    assertStringIncludes(resumed.out + resumed.err, "not suspended");
    const cancelled = await runCli(Deploy, ["cancel", runId]);
    assertStringIncludes(
      cancelled.out + cancelled.err,
      "already cancelled; nothing to cancel",
    );
    assertEquals(calls, []);
    assertEquals(world, before);

    // What it says will: the configuration set back, then the rollback run
    // by hand with the stable image ID it names.
    await recoverByHand();
  });
}

/**
 * The recovery a project refusal names: the project set back, then
 * `rollout.abort` run by hand with `.stable(...)` set to the recorded stable
 * image ID. It must act only on the staged project and end on app:v1's ID.
 */
async function recoverByHand(): Promise<void> {
  project = "shop";
  reportedProject = "shop";
  stable = V1_ID;
  calls = [];
  const recovered = await runCli(Deploy, ["rollout.abort"]);
  assertEquals(recovered.code, 0, recovered.err);
  assertEquals(
    calls.map((call) => call.argv.slice(0, 3).join(" ")),
    Array(calls.length).fill("compose -p shop"),
  );
  // Every move sets an image ID, so none may pull.
  assertEquals(
    calls.filter((call) => call.argv.includes("up")).every((call) =>
      call.argv.includes("never")
    ),
    true,
  );
  assertBackOnV1();
}

/** A resume that approves the parked rollout: promote, then its rollback. */
const RESUME = (runId: string) => ["resume", runId, "--signal", "approved"];

/** A cancel of the parked rollout: its rollback. */
const CANCEL = (runId: string) => ["cancel", runId];

Deno.test("Compose: a resume whose lambda selects another project refuses, and the hand-run recovery it names rolls back", async () => {
  await refusedThenRecovered(OTHER_FLAGS, RESUME, 2);
});

Deno.test("Compose: a cancel whose lambda selects another project refuses, and the hand-run recovery it names rolls back", async () => {
  await refusedThenRecovered(OTHER_FLAGS, CANCEL, 1);
});

Deno.test("Compose: a resume that Compose resolves to another project with the same flags refuses, and the recovery rolls back", async () => {
  await refusedThenRecovered(OTHER_REPORTED, RESUME, 2);
});

Deno.test("Compose: a cancel that Compose resolves to another project with the same flags refuses, and the recovery rolls back", async () => {
  await refusedThenRecovered(OTHER_REPORTED, CANCEL, 1);
});

Deno.test("Compose: a promotion that failed half-way, then a project switch, is recovered by hand on the recorded ID", async () => {
  fresh();
  await withStateDir(async (dir) => {
    const parked = await runCli(Deploy, ["ship"]);
    assertEquals(parked.code, 0, parked.err);
    const runId = await onlyRun(dir);
    // The stable service is recreated on the candidate, then the last move
    // fails, and by then the lambda names another project, so the rollback
    // the failure triggers refuses rather than act there.
    failPromoteTail = true;
    switchProjectOnFailure = true;
    calls = [];
    const resumed = await runCli(Deploy, [
      "resume",
      runId,
      "--signal",
      "approved",
    ]);
    assertEquals(resumed.code, 1);
    assertStringIncludes(
      resumed.out + resumed.err,
      "but d.compose(...) now gives `-p shop-staging`, so this call changed " +
        "nothing",
    );
    assertEquals(moves(), [
      "app-canary=4@v1-id(keep)",
      "app=4@v2-id",
      "app-canary=0@v2-id",
    ]);
    const halfway = {
      app: [V2_ID, V2_ID, V2_ID, V2_ID],
      "app-canary": ["app:v2", V2_ID, V2_ID, V2_ID],
    };
    assertEquals(world, halfway);
    failPromoteTail = false;
    switchProjectOnFailure = false;
    await recoverByHand();
  });
});

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the canary engine from `@zuke/canary` driving the Kubernetes
 * platform from `@zuke/kubectl`, through the real CLI. The two packages never
 * import each other, so this is also where they are proven to fit:
 * `c.platform(kubectlCanary(...))` type-checks and runs end to end.
 *
 * A recording runner stands in for kubectl: it keeps every command line and
 * answers the reads `stage` makes — the stable image, `.spec.paused` (unset),
 * and the canary's `.spec.replicas` (0).
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
import { kubectlCanary } from "../../packages/kubectl/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";

/** Every kubectl command line the platform ran, without the binary name. */
let calls: string[][] = [];

/** The image the stable Deployment runs, as the read-back reports it. */
const stableImage = "reg/api:1";

/** Whether the analysis passes. */
let healthy = true;

/** The image a hand-run rollback restores, if the build names one. */
let handRunImage: string | undefined;

/** The candidate image the image parameter resolved to. */
let candidate = "reg/api:2";

/** The stable Deployment the build names. */
let stableName = "api";

/** What the fake cluster prints for a `get -o jsonpath=…` read. */
function answer(argv: string[]): string {
  if (argv[0] !== "get") return "";
  const path = argv.at(-1) ?? "";
  if (path.endsWith(".image}")) return stableImage;
  return path === "jsonpath={.spec.replicas}" ? "0" : "";
}

class Deploy extends Build {
  rollout = canary((c) =>
    c.platform(
      kubectlCanary((k) =>
        (handRunImage === undefined ? k : k.stableImage(handRunImage))
          .stable(stableName).canary("api-canary").container("api")
          .image(candidate).replicas(4).namespace("prod")
          .runner((settings) => {
            const argv = settings.argv().slice(1);
            calls.push(argv);
            return Promise.resolve(new CommandOutput(0, answer(argv), ""));
          })
      ),
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
 * The mutations and waits the platform made, as `scale <deployment>=<n>`,
 * `image <deployment> <container>=<image>` and `wait <deployment>`.
 */
function moves(): string[] {
  return calls.flatMap((argv) => {
    const resource = argv.find((a) => a.startsWith("deployment/")) ?? "";
    const name = resource.slice("deployment/".length);
    if (argv[0] === "scale") {
      const replicas = argv.find((a) => a.startsWith("--replicas=")) ?? "";
      return [`scale ${name}=${replicas.slice("--replicas=".length)}`];
    }
    if (argv[0] === "set") return [`image ${name} ${argv.at(-1)}`];
    if (argv[0] === "rollout") return [`wait ${name}`];
    return [];
  });
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
  healthy = true;
  handRunImage = undefined;
  candidate = "reg/api:2";
  stableName = "api";
}

Deno.test("Kubernetes: staged, stepped, parked, and promoted by a later process", async () => {
  fresh();
  await withStateDir(async (dir) => {
    const parked = await runCli(Deploy, ["ship"]);
    assertEquals(parked.code, 0, parked.err);
    assertEquals(moves(), [
      "image api-canary api=reg/api:2",
      "scale api-canary=1",
      "wait api-canary",
      "scale api=3",
      "scale api-canary=2",
      "wait api-canary",
      "scale api=2",
    ]);
    assertStringIncludes(parked.out, "reg/api:2");

    // The resume is a new main(): promote reads the image stage recorded.
    calls = [];
    const resumed = await runCli(Deploy, [
      "resume",
      await onlyRun(dir),
      "--signal",
      "approved",
    ]);
    assertEquals(resumed.code, 0, resumed.err);
    assertEquals(moves(), [
      "image api api=reg/api:2",
      "scale api=4",
      "wait api",
      "scale api-canary=0",
    ]);
  });
});

Deno.test("Kubernetes: a failed analysis restores stable and empties the canary", async () => {
  fresh();
  healthy = false;
  await withStateDir(async () => {
    const { code, out, err } = await runCli(Deploy, ["ship"]);
    assertEquals(code, 1);
    assertStringIncludes(out + err, "error ratio 0.3 above 0.01");
    assertEquals(moves().slice(1), [
      "scale api-canary=1",
      "wait api-canary",
      "scale api=3",
      "image api api=reg/api:1",
      "scale api=4",
      "wait api",
      "scale api-canary=0",
    ]);
  });
});

Deno.test("Kubernetes: a rollback run by hand restores the configured stable image", async () => {
  fresh();
  handRunImage = "reg/api:1";
  await withStateDir(async () => {
    const { code, err } = await runCli(Deploy, ["rollout.abort"]);
    assertEquals(code, 0, err);
    assertEquals(moves(), [
      "image api api=reg/api:1",
      "scale api=4",
      "wait api",
      "scale api-canary=0",
    ]);
  });
});

Deno.test("Kubernetes: a stage refused by its settings rolls back nothing", async () => {
  // The image parameter resolved empty, and the build names a hand-run
  // stable image. The stage changed nothing, so the engine's inline rollback
  // must not roll production back to that image.
  fresh();
  candidate = "";
  handRunImage = "reg/api:0";
  await withStateDir(async () => {
    const { code, out, err } = await runCli(Deploy, ["ship"]);
    assertEquals(code, 1);
    assertStringIncludes(out + err, "no candidate image");
    assertEquals(calls, []);
  });
});

Deno.test("Kubernetes: a rollback run by hand with no stable image refuses", async () => {
  // After a promote the stable Deployment runs the candidate, so moving
  // replicas back to it would change nothing while the summary said
  // "Rolled back".
  fresh();
  await withStateDir(async () => {
    const { code, out, err } = await runCli(Deploy, ["rollout.abort"]);
    assertEquals(code, 1);
    assertStringIncludes(out + err, "k.stableImage('<image>')");
    assertEquals(calls, []);
  });
});

Deno.test("Kubernetes: a rollout resumed with other Deployments configured refuses", async () => {
  // The rollout was staged on deployment/api; the build now names another.
  // Neither the resume nor the rollback it triggers may set the recorded
  // image on, or scale, a Deployment the rollout never touched.
  fresh();
  await withStateDir(async (dir) => {
    const parked = await runCli(Deploy, ["ship"]);
    assertEquals(parked.code, 0, parked.err);

    stableName = "web";
    calls = [];
    const resumed = await runCli(Deploy, [
      "resume",
      await onlyRun(dir),
      "--signal",
      "approved",
    ]);
    assertEquals(resumed.code, 1);
    assertStringIncludes(
      resumed.out + resumed.err,
      'the stable Deployment was "api", now "web"',
    );
    assertStringIncludes(
      resumed.out + resumed.err,
      'by hand (e.g. `zuke rollout.abort`) with k.stableImage("reg/api:1")',
    );
    assertEquals(moves(), []);

    // The run is cancelled now; the refusal's way out is a hand-run rollback
    // with the configuration the rollout started with.
    stableName = "api";
    handRunImage = "reg/api:1";
    const rolledBack = await runCli(Deploy, ["rollout.abort"]);
    assertEquals(rolledBack.code, 0, rolledBack.err);
    assertEquals(moves(), [
      "image api api=reg/api:1",
      "scale api=4",
      "wait api",
      "scale api-canary=0",
    ]);
  });
});

Deno.test("Kubernetes: a cancel evaluated with other Deployments configured refuses", async () => {
  fresh();
  await withStateDir(async (dir) => {
    const parked = await runCli(Deploy, ["ship"]);
    assertEquals(parked.code, 0, parked.err);

    stableName = "web";
    calls = [];
    const cancelled = await runCli(Deploy, ["cancel", await onlyRun(dir)]);
    assertStringIncludes(
      cancelled.out + cancelled.err,
      "finished or cancelled with the configuration it started with",
    );
    assertEquals(moves(), []);
  });
});

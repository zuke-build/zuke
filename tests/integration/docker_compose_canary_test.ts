// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the canary engine from `@zuke/canary` driving the Compose
 * platform from `@zuke/docker-compose`, through the real CLI. The two packages
 * never import each other, so this is also where they are proven to fit:
 * `c.platform(dockerComposeCanary(...))` type-checks and runs end to end.
 *
 * A recording runner stands in for Compose: it keeps every command line with
 * the image variables it was run with, and answers the stable-image read with
 * whatever `serving` is.
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

/** The image `ps` reports the stable replicas running. */
let serving = "app:v1";

/** Whether the analysis passes. */
let healthy = true;

/** Whether the last move of a promotion fails. */
let failPromoteTail = false;

/** The image a hand-run rollback goes back to, if the build names one. */
let stable: string | undefined;

class Deploy extends Build {
  rollout = canary((c) =>
    c.platform(
      dockerComposeCanary((d) =>
        (stable === undefined ? d : d.stable(stable))
          .service("app").canaryService("app-canary").replicas(4)
          .image("app:v2")
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
            const stdout = argv.includes("ps")
              ? `${serving}\n${serving}\n`
              : "";
            return Promise.resolve(new CommandOutput(0, stdout, ""));
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
 * The scale moves the platform made, as `<service>=<n>`, with the stable
 * service's image when the command set one.
 */
function moves(): string[] {
  return calls.filter((call) => call.argv.includes("up")).map((call) => {
    const scale = call.argv[call.argv.indexOf("--scale") + 1];
    return scale.startsWith("app=") && call.stableImage !== undefined
      ? `${scale}@${call.stableImage}`
      : scale;
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
  serving = "app:v1";
  healthy = true;
  failPromoteTail = false;
  stable = undefined;
}

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
      "app=4@app:v1",
      "app-canary=0",
      "app-canary=1",
      "app=3@app:v1",
      "app-canary=2",
      "app=2@app:v1",
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
    assertEquals(moves(), ["app-canary=4", "app=4@app:v2", "app-canary=0"]);
  });
});

Deno.test("Compose: a failed analysis puts every replica back on the stable image", async () => {
  fresh();
  healthy = false;
  await withStateDir(async () => {
    const { code, out, err } = await runCli(Deploy, ["ship"]);
    assertEquals(code, 1);
    assertStringIncludes(out + err, "error ratio 0.3 above 0.01");
    // The stable image is read once, by stage; the rollback uses that record.
    assertEquals(calls.filter((call) => call.argv.includes("ps")).length, 1);
    assertEquals(moves().slice(-4), [
      "app-canary=1",
      "app=3@app:v1",
      "app=4@app:v1",
      "app-canary=0",
    ]);
  });
});

Deno.test("Compose: a promotion that fails part-way in a later process is rolled back to the stable image", async () => {
  fresh();
  await withStateDir(async (dir) => {
    await runCli(Deploy, ["ship"]);
    calls = [];
    // The stable service is recreated on the candidate, then the last move
    // fails — the stable replicas now run an image the rollback must undo.
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
      "app-canary=4",
      "app=4@app:v2",
      "app-canary=0",
      "app=4@app:v1",
      "app-canary=0",
    ]);
  });
});

Deno.test("Compose: a rollback run by hand goes to the configured stable image", async () => {
  fresh();
  stable = "app:v1";
  await withStateDir(async () => {
    const { code, err } = await runCli(Deploy, ["rollout.abort"]);
    assertEquals(code, 0, err);
    assertEquals(moves(), ["app=4@app:v1", "app-canary=0"]);
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

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the canary engine from `@zuke/canary` driving the Cloud Run
 * platform from `@zuke/gcloud`, through the real CLI. The two packages never
 * import each other, so this is also where they are proven to fit:
 * `c.platform(cloudRunCanary(...))` type-checks and runs end to end.
 *
 * A recording runner stands in for gcloud: it keeps every command line and
 * answers the revision read-back with whatever `latest` is.
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
import { cloudRunCanary } from "../../packages/gcloud/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";

/** Every gcloud command line the platform ran, without the binary name. */
let calls: string[][] = [];

/** The revision Cloud Run reports as the latest created one. */
let latest = "api-00002-new";

/** Whether the analysis passes. */
let healthy = true;

/** The revision a hand-run rollback goes back to, if the build names one. */
let stable: string | undefined;

class Deploy extends Build {
  rollout = canary((c) =>
    c.platform(
      cloudRunCanary((r) =>
        (stable === undefined ? r : r.stable(stable))
          .service("api").region("europe-west1").image("gcr.io/p/api:2")
          .runner((settings) => {
            const argv = settings.argv().slice(1);
            calls.push(argv);
            const stdout = argv.includes("describe") ? `${latest}\n` : "";
            return Promise.resolve(new CommandOutput(0, stdout, ""));
          })
      ),
    )
      .steps(10, 50)
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

/** The traffic moves the platform made, as their gcloud flag and value. */
function trafficMoves(): string[] {
  return calls.filter((argv) => argv.includes("update-traffic")).map((argv) => {
    if (argv.includes("--to-latest")) return "--to-latest";
    const flag = argv.includes("--to-tags") ? "--to-tags" : "--to-revisions";
    return argv[argv.indexOf(flag) + 1];
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
  latest = "api-00002-new";
  healthy = true;
  stable = undefined;
}

Deno.test("Cloud Run: staged, stepped, parked, and promoted by a later process", async () => {
  fresh();
  await withStateDir(async (dir) => {
    const parked = await runCli(Deploy, ["ship"]);
    assertEquals(parked.code, 0, parked.err);
    assertEquals(calls[0].slice(0, 4), ["run", "services", "update", "api"]);
    assertEquals(calls[0].includes("--no-traffic"), true);
    assertEquals(trafficMoves(), ["canary=10", "canary=50"]);
    assertStringIncludes(parked.out, "api-00002-new");

    // The resume is a new main(): promote reads the candidate stage recorded.
    const resumed = await runCli(Deploy, [
      "resume",
      await onlyRun(dir),
      "--signal",
      "approved",
    ]);
    assertEquals(resumed.code, 0, resumed.err);
    assertEquals(trafficMoves().at(-1), "--to-latest");
  });
});

Deno.test("Cloud Run: a failed analysis takes the candidate's traffic back", async () => {
  fresh();
  healthy = false;
  await withStateDir(async () => {
    const { code, out, err } = await runCli(Deploy, ["ship"]);
    assertEquals(code, 1);
    assertStringIncludes(out + err, "error ratio 0.3 above 0.01");
    assertEquals(trafficMoves(), ["canary=10", "canary=0"]);
  });
});

Deno.test("Cloud Run: a revision deployed mid-rollout is never promoted", async () => {
  fresh();
  await withStateDir(async (dir) => {
    await runCli(Deploy, ["ship"]);
    latest = "api-00003-someone-else";
    const resumed = await runCli(Deploy, [
      "resume",
      await onlyRun(dir),
      "--signal",
      "approved",
    ]);
    assertEquals(resumed.code, 1);
    assertStringIncludes(
      resumed.out + resumed.err,
      "not the staged candidate api-00002-new",
    );
    assertEquals(trafficMoves().includes("--to-latest"), false);
    assertEquals(trafficMoves().at(-1), "canary=0");
  });
});

Deno.test("Cloud Run: a rollback run by hand goes to the configured stable revision", async () => {
  fresh();
  stable = "api-00001-old";
  await withStateDir(async () => {
    const { code, err } = await runCli(Deploy, ["rollout.abort"]);
    assertEquals(code, 0, err);
    assertEquals(trafficMoves(), ["api-00001-old=100"]);
  });
});

Deno.test("Cloud Run: a rollback run by hand with no stable revision refuses", async () => {
  // After a promote the tag's route is already at 0 %, so taking it back
  // would change nothing while the summary said "Rolled back".
  fresh();
  await withStateDir(async () => {
    const { code, out, err } = await runCli(Deploy, ["rollout.abort"]);
    assertEquals(code, 1);
    assertStringIncludes(out + err, "r.stable('<revision>')");
    assertEquals(trafficMoves(), []);
  });
});

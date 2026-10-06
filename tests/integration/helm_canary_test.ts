// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the canary engine from `@zuke/canary` driving the Helm platform
 * from `@zuke/helm`, through the real CLI. The two packages never import each
 * other, so this is also where they are proven to fit:
 * `c.platform(helmCanary(...))` type-checks and runs end to end.
 *
 * A recording runner stands in for helm: it keeps every command line and
 * answers the stable release's revision read with `revision`, and the canary
 * release's existence check with "not found" unless `leftover` is set.
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
import { helmCanary } from "../../packages/helm/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";

/** Every helm command line the platform ran, without the binary name. */
let calls: string[][] = [];

/** The stable release's revision before the rollout. */
let revision = "12";

/** Whether a canary release is left over from an earlier rollout. */
let leftover = false;

/** Whether the analysis passes. */
let healthy = true;

/** The image the build configures. */
let image = "1.5.0";

/** The revision a hand-run rollback goes back to, if the build names one. */
let stableRevision: number | undefined;

class Deploy extends Build {
  rollout = canary((c) =>
    c.platform(
      helmCanary((h) =>
        (stableRevision === undefined ? h : h.stableRevision(stableRevision))
          .chart("./charts/api").stableRelease("api").namespace("prod")
          .image(image).replicas(4)
          .runner((settings) => {
            const argv = settings.argv().slice(1);
            calls.push(argv);
            if (argv[0] !== "get") {
              return Promise.resolve(new CommandOutput(0, "", ""));
            }
            if (argv[2] === "api") {
              return Promise.resolve(
                new CommandOutput(0, `${revision} deployed\n`, ""),
              );
            }
            return Promise.resolve(
              leftover
                ? new CommandOutput(0, "3", "")
                : new CommandOutput(1, "", "Error: release: not found\n"),
            );
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

/** Each command as `<verb> <release> [detail]`, for a readable sequence. */
function steps(): string[] {
  return calls.map((argv) => {
    const [verb, release] = argv[0] === "get"
      ? ["get", argv[2]]
      : [argv[0], argv[1]];
    if (verb === "rollback") return `rollback ${release} ${argv[2]}`;
    const set = argv.indexOf("--set");
    return set === -1
      ? `${verb} ${release}`
      : `${verb} ${release} ${argv[set + 1]}`;
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
  revision = "12";
  leftover = false;
  healthy = true;
  image = "1.5.0";
  stableRevision = undefined;
}

Deno.test("Helm: staged, stepped, parked, and promoted by a later process", async () => {
  fresh();
  await withStateDir(async (dir) => {
    const parked = await runCli(Deploy, ["ship"]);
    assertEquals(parked.code, 0, parked.err);
    assertEquals(steps(), [
      "get api",
      "get api-canary",
      "upgrade api-canary replicaCount=0",
      "upgrade api-canary replicaCount=1",
      "upgrade api replicaCount=3",
      "upgrade api-canary replicaCount=2",
      "upgrade api replicaCount=2",
    ]);
    assertStringIncludes(parked.out, "Stable revision");

    // The resumed process is configured with another image; the one staged
    // and analysed is what is promoted.
    calls = [];
    image = "9.9.9";
    const resumed = await runCli(Deploy, [
      "resume",
      await onlyRun(dir),
      "--signal",
      "approved",
    ]);
    assertEquals(resumed.code, 0, resumed.err);
    assertEquals(steps(), [
      "upgrade api replicaCount=4",
      "uninstall api-canary",
    ]);
    assertEquals(calls[0].includes("image.tag=1.5.0"), true);
  });
});

Deno.test("Helm: a failed analysis rolls the stable release back to its revision", async () => {
  fresh();
  healthy = false;
  await withStateDir(async () => {
    const { code, out, err } = await runCli(Deploy, ["ship"]);
    assertEquals(code, 1);
    assertStringIncludes(out + err, "error ratio 0.3 above 0.01");
    assertEquals(steps().slice(-2), [
      "rollback api 12",
      "uninstall api-canary",
    ]);
  });
});

Deno.test("Helm: a rollback after resume, in another process, uses the recorded revision", async () => {
  fresh();
  await withStateDir(async (dir) => {
    await runCli(Deploy, ["ship"]);
    calls = [];
    // Reading a different revision now must not matter: the record wins.
    revision = "99";
    const id = await onlyRun(dir);
    const cancelled = await runCli(Deploy, ["cancel", id]);
    assertEquals(cancelled.code, 0, cancelled.err);
    assertEquals(steps(), ["rollback api 12", "uninstall api-canary"]);
  });
});

Deno.test("Helm: a stage with a bad image runs no helm command, even with a hand-run revision set", async () => {
  // The engine rolls a failed stage back inline. A stage that failed on its
  // configuration changed nothing, so that rollback must not downgrade the
  // stable release to the hand-run revision.
  fresh();
  image = "1.5.0,x=1";
  stableRevision = 3;
  await withStateDir(async () => {
    const { code, out, err } = await runCli(Deploy, ["ship"]);
    assertEquals(code, 1);
    assertStringIncludes(out + err, "is not an image reference or tag");
    assertEquals(calls, []);
  });
});

Deno.test("Helm: a canary release left by an earlier rollout is refused, not taken over", async () => {
  fresh();
  leftover = true;
  await withStateDir(async () => {
    const { code, out, err } = await runCli(Deploy, ["ship"]);
    assertEquals(code, 1);
    assertStringIncludes(out + err, "already exists, left by an earlier");
    assertEquals(steps(), ["get api", "get api-canary"]);
  });
});

Deno.test("Helm: a rollback run by hand goes to the configured revision", async () => {
  fresh();
  stableRevision = 11;
  await withStateDir(async () => {
    const { code, err } = await runCli(Deploy, ["rollout.abort"]);
    assertEquals(code, 0, err);
    assertEquals(steps(), ["rollback api 11", "uninstall api-canary"]);
  });
});

Deno.test("Helm: a rollback run by hand with no revision refuses", async () => {
  fresh();
  await withStateDir(async () => {
    const { code, out, err } = await runCli(Deploy, ["rollout.abort"]);
    assertEquals(code, 1);
    assertStringIncludes(out + err, "h.stableRevision(<n>)");
    assertEquals(calls, []);
  });
});

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the canary engine from `@zuke/canary` driving the Helm platform
 * from `@zuke/helm`, through the real CLI. The two packages never import each
 * other, so this is also where they are proven to fit:
 * `c.platform(helmCanary(...))` type-checks and runs end to end.
 *
 * A recording runner stands in for helm: it keeps every command line and
 * answers the stable release's reads with `revision` and `firstDeployed`, and
 * the canary release's existence check with "not found" unless `leftover` is
 * set.
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

/** When the stable release was first deployed, nanoseconds since 1970. */
let firstDeployed = "1759740000000000000";

/** The template every call after stage reads the stable release's identity with. */
const FIRST_TEMPLATE = "{{.Release.Info.FirstDeployed.UnixNano}}";

/** Whether a canary release is left over from an earlier rollout. */
let leftover = false;

/** Whether the analysis passes. */
let healthy = true;

/** The image the build configures. */
let image = "1.5.0";

/** The chart the build configures. */
let chart = "./charts/api";

/** The revision a hand-run rollback goes back to, if the build names one. */
let stableRevision: number | undefined;

/** The stable release the build names. */
let stable = "api";

/** The canary release the build names, if not the default. */
let canaryRelease: string | undefined;

/** The namespace the build names, if any. */
let namespace: string | undefined = "prod";

class Deploy extends Build {
  rollout = canary((c) =>
    c.platform(
      helmCanary((h) => {
        if (stableRevision !== undefined) h.stableRevision(stableRevision);
        if (canaryRelease !== undefined) h.canaryRelease(canaryRelease);
        if (namespace !== undefined) h.namespace(namespace);
        return h.chart(chart).stableRelease(stable).image(image).replicas(4)
          .runner((settings) => {
            const argv = settings.argv().slice(1);
            calls.push(argv);
            if (argv[0] !== "get") {
              return Promise.resolve(new CommandOutput(0, "", ""));
            }
            if (argv.includes(FIRST_TEMPLATE)) {
              return Promise.resolve(
                new CommandOutput(0, `${firstDeployed}\n`, ""),
              );
            }
            if (argv[2] === stable) {
              return Promise.resolve(
                new CommandOutput(
                  0,
                  `${revision} deployed ${firstDeployed}\n`,
                  "",
                ),
              );
            }
            return Promise.resolve(
              leftover
                ? new CommandOutput(0, "3", "")
                : new CommandOutput(1, "", "Error: release: not found\n"),
            );
          });
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
  firstDeployed = "1759740000000000000";
  leftover = false;
  healthy = true;
  image = "1.5.0";
  chart = "./charts/api";
  stableRevision = undefined;
  stable = "api";
  canaryRelease = undefined;
  namespace = "prod";
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
      "get api",
      "upgrade api-canary replicaCount=1",
      "upgrade api replicaCount=3",
      "get api",
      "upgrade api-canary replicaCount=2",
      "upgrade api replicaCount=2",
    ]);
    assertStringIncludes(parked.out, "Stable revision");

    // The resumed process is configured with another image and chart; the
    // ones staged and analysed are what is promoted.
    calls = [];
    image = "9.9.9";
    chart = "./charts/v2";
    const resumed = await runCli(Deploy, [
      "resume",
      await onlyRun(dir),
      "--signal",
      "approved",
    ]);
    assertEquals(resumed.code, 0, resumed.err);
    assertEquals(steps(), [
      "get api",
      "upgrade api replicaCount=4",
      "uninstall api-canary",
    ]);
    assertEquals(calls[1].includes("image.tag=1.5.0"), true);
    assertEquals(calls[1][2], "./charts/api");
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
    assertEquals(steps(), [
      "get api",
      "rollback api 12",
      "uninstall api-canary",
    ]);
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

/** Configuration changes made between a parked rollout and its next step. */
const MOVES: Array<[string, () => void]> = [
  ["stable release", () => stable = "web"],
  ["canary release", () => canaryRelease = "api-next"],
  ["namespace", () => namespace = undefined],
];

/** The commands that change something — everything but the reads. */
function mutations(): string[] {
  return steps().filter((step) => !step.startsWith("get "));
}

Deno.test("Helm: a resume or cancel with other releases changes nothing, and says how to recover", async () => {
  for (const [label, move] of MOVES) {
    for (const command of ["resume", "cancel"]) {
      fresh();
      await withStateDir(async (dir) => {
        const parked = await runCli(Deploy, ["ship"]);
        assertEquals(parked.code, 0, parked.err);
        calls = [];
        move();
        const id = await onlyRun(dir);
        const args = command === "resume"
          ? ["resume", id, "--signal", "approved"]
          : ["cancel", id];
        const { code, out, err } = await runCli(Deploy, args);
        assertEquals(code, 1, `${label} ${command}`);
        assertEquals(mutations(), [], `${label} ${command}`);
        assertEquals((out + err).includes("Rolled back"), false);
        assertStringIncludes(
          out + err,
          `this rollout started with the ${label}`,
        );
        assertStringIncludes(out + err, "zuke rollout.abort");
        assertStringIncludes(out + err, "h.stableRevision(12)");

        // The recovery the message names: the configuration set back, and
        // the rollback run by hand to the recorded revision.
        fresh();
        stableRevision = 12;
        const recovered = await runCli(Deploy, ["rollout.abort"]);
        assertEquals(recovered.code, 0, recovered.err);
        assertEquals(steps(), ["rollback api 12", "uninstall api-canary"]);
      });
    }
  }
});

Deno.test("Helm: a stable release reinstalled while the rollout was parked is neither promoted nor rolled back", async () => {
  for (const command of ["resume", "cancel"]) {
    fresh();
    await withStateDir(async (dir) => {
      const parked = await runCli(Deploy, ["ship"]);
      assertEquals(parked.code, 0, parked.err);
      // Same names, same configuration — but the release helm reaches now is
      // another incarnation (or another cluster's), first deployed later.
      calls = [];
      firstDeployed = "1759750000000000000";
      const id = await onlyRun(dir);
      const args = command === "resume"
        ? ["resume", id, "--signal", "approved"]
        : ["cancel", id];
      const { code, out, err } = await runCli(Deploy, args);
      assertEquals(code, 1, command);
      assertStringIncludes(
        out + err,
        "the stable release api was first deployed at " +
          "2025-10-06T08:40:00.000Z when this rollout started, but the " +
          "release helm reaches now was first deployed at " +
          "2025-10-06T11:26:40.000Z",
      );
      assertStringIncludes(out + err, "This call changed nothing.");
      assertEquals(mutations(), [], command);
      assertEquals(calls.length > 0, true, command);
    });
  }
});

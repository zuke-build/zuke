// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the canary engine from `@zuke/canary` driving the Kubernetes
 * platform from `@zuke/kubectl`, through the real CLI. The two packages never
 * import each other, so this is also where they are proven to fit:
 * `c.platform(kubectlCanary(...))` type-checks and runs end to end.
 *
 * A recording runner stands in for kubectl: it keeps every command line and
 * answers the stable-image read with `stableImage`.
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

class Deploy extends Build {
  rollout = canary((c) =>
    c.platform(
      kubectlCanary((k) =>
        (handRunImage === undefined ? k : k.stableImage(handRunImage))
          .stable("api").canary("api-canary").container("api")
          .image("reg/api:2").replicas(4).namespace("prod")
          .runner((settings) => {
            const argv = settings.argv().slice(1);
            calls.push(argv);
            const stdout = argv[0] === "get" ? stableImage : "";
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

/** The mutations the platform made, as `scale <deployment>=<n>` / `image …`. */
function moves(): string[] {
  return calls.flatMap((argv) => {
    const resource = argv.find((a) => a.startsWith("deployment/")) ?? "";
    const name = resource.slice("deployment/".length);
    if (argv[0] === "scale") {
      const replicas = argv.find((a) => a.startsWith("--replicas=")) ?? "";
      return [`scale ${name}=${replicas.slice("--replicas=".length)}`];
    }
    if (argv[0] === "set") return [`image ${name} ${argv.at(-1)}`];
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
}

Deno.test("Kubernetes: staged, stepped, parked, and promoted by a later process", async () => {
  fresh();
  await withStateDir(async (dir) => {
    const parked = await runCli(Deploy, ["ship"]);
    assertEquals(parked.code, 0, parked.err);
    assertEquals(moves(), [
      "scale api-canary=0",
      "image api-canary api=reg/api:2",
      "scale api-canary=1",
      "scale api=3",
      "scale api-canary=2",
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
    assertEquals(moves().slice(2), [
      "scale api-canary=1",
      "scale api=3",
      "image api api=reg/api:1",
      "scale api=4",
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
      "scale api-canary=0",
    ]);
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

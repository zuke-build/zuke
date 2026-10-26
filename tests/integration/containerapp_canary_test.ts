// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the canary engine from `@zuke/canary` driving the Container
 * Apps platform from `@zuke/az`, through the real CLI. The two packages never
 * import each other, so this is also where they are proven to fit:
 * `c.platform(containerAppCanary(...))` type-checks and runs end to end.
 *
 * The `az` CLI is the shared Container Apps model the unit tests use: apps
 * keyed by subscription, resource group and name, with revisions and ingress
 * traffic that `ingress traffic set` rescales as the CLI does.
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
import { splitShellArgs } from "../../packages/core/src/shell.ts";
import { canary } from "../../packages/canary/mod.ts";
import { containerAppCanary } from "../../packages/az/mod.ts";
import { ContainerAppModel } from "../../packages/az/tests/_containerapp_model.ts";
import { runCli, withStateDir } from "./_harness.ts";

/** The modelled Container Apps, fresh for each test. */
let model = new ContainerAppModel();

/** Whether the analysis passes. */
let healthy = true;

/** The revision a hand-run rollback goes back to, if the build names one. */
let stable: string | undefined;

/** The resource group the build is configured with. */
let resourceGroup = "rg-prod";

/** The subscription the build passes with `--subscription`, if any. */
let subscription: string | undefined;

/** The resource id of the app every test stages. */
const APP_ID =
  "/subscriptions/sub-prod/resourceGroups/rg-prod/providers/Microsoft.App/containerApps/api";

class Deploy extends Build {
  rollout = canary((c) =>
    c.platform(
      containerAppCanary((a) =>
        (stable === undefined ? a : a.stable(stable))
          .name("api").resourceGroup(resourceGroup)
          .image("acr.io/api:2").revisionSuffix("v2")
          .az((z) =>
            (subscription === undefined ? z : z.subscription(subscription))
              .runner(model.runner)
          )
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

/** Configuration and the modelled apps back to how every test starts. */
function fresh(): void {
  model = new ContainerAppModel();
  model.apps["sub-test/rg-prod/api"] = {
    mode: "Multiple",
    revisions: {
      "api--t1": {
        created: "2026-09-01T00:00:00Z",
        provisioning: "Provisioned",
      },
    },
    latest: "api--t1",
    image: "acr.io/api:0",
    traffic: [{ latestRevision: true, weight: 100 }],
  };
  healthy = true;
  stable = undefined;
  resourceGroup = "rg-prod";
  subscription = undefined;
}

/** The id of the only run under `dir`. */
async function onlyRun(dir: string): Promise<string> {
  const runs = await new FileSystemStateStore(dir, defaultStateHost).listRuns(
    {},
  );
  assertEquals(runs.length, 1);
  return runs[0].id;
}

/**
 * The command in backticks after `lead` in `message`, split back into argv
 * with core's POSIX quoting rules, as the operator's shell would read it.
 */
function quotedCommand(message: string, lead: string): string[] {
  const at = message.indexOf(lead);
  assertEquals(at === -1, false, `no "${lead}" in: ${message}`);
  const start = message.indexOf("`", at + lead.length) + 1;
  const text = message.slice(start, message.indexOf("`", start));
  return splitShellArgs(text);
}

Deno.test("Container Apps: staged, stepped, parked, and promoted by a later process", async () => {
  fresh();
  await withStateDir(async (dir) => {
    const parked = await runCli(Deploy, ["ship"]);
    assertEquals(parked.code, 0, parked.err);
    assertEquals(model.trafficMoves(), [
      ["api--v1=100"],
      ["api--v1=90", "api--v2=10"],
      ["api--v1=50", "api--v2=50"],
    ]);
    assertStringIncludes(parked.out, "api--v2");
    assertEquals(model.shares(), { "api--v1": 50, "api--v2": 50 });

    // The resume is a new main(): promote reads the rollout stage recorded,
    // and hands the traffic back to "latest", which it followed before.
    const resumed = await runCli(Deploy, [
      "resume",
      await onlyRun(dir),
      "--signal",
      "approved",
    ]);
    assertEquals(resumed.code, 0, resumed.err);
    assertEquals(model.trafficMoves().at(-1), ["latest=100"]);
    assertEquals(model.shares(), { "api--v2": 100 });
  });
});

Deno.test("Container Apps: a failed analysis takes the candidate's traffic back", async () => {
  fresh();
  healthy = false;
  await withStateDir(async () => {
    const { code, out, err } = await runCli(Deploy, ["ship"]);
    assertEquals(code, 1);
    assertStringIncludes(out + err, "error ratio 0.3 above 0.01");
    assertEquals(model.trafficMoves(), [
      ["api--v1=100"],
      ["api--v1=90", "api--v2=10"],
      ["api--v1=100", "api--v2=0"],
    ]);
    assertEquals(model.shares(), { "api--v1": 100 });
  });
});

Deno.test("Container Apps: a revision deployed mid-rollout is never promoted", async () => {
  fresh();
  await withStateDir(async (dir) => {
    await runCli(Deploy, ["ship"]);
    model.run([
      "containerapp",
      "update",
      "--name=api",
      "--resource-group=rg-prod",
      "--image=acr.io/api:3",
      "--revision-suffix=v3",
    ]);
    const resumed = await runCli(Deploy, [
      "resume",
      await onlyRun(dir),
      "--signal",
      "approved",
    ]);
    assertEquals(resumed.code, 1);
    assertStringIncludes(
      resumed.out + resumed.err,
      "the latest revision of api is api--v3",
    );
    // The rollback still took the candidate's share off; nothing promoted.
    assertEquals(model.trafficMoves().at(-1), ["api--v1=100", "api--v2=0"]);
    assertEquals(model.shares(), { "api--v1": 100 });
  });
});

/** Each way the configuration can change while a rollout is parked. */
const CHANGES: ReadonlyArray<readonly [label: string, change: () => void]> = [
  ["resource group", () => resourceGroup = "rg-test"],
  ["az flags", () => subscription = "sub-test"],
];

/**
 * Prove the recovery a refusal names works: with the configuration set back,
 * the read it gives prints the recorded resource id, and the command it gives
 * sends the staged app's traffic back to the stable revision.
 */
function recover(message: string): void {
  const check = quotedCommand(message, "check that ");
  assertEquals(check[0], "az");
  assertStringIncludes(model.run(check.slice(1)).stdout, APP_ID);
  const undo = quotedCommand(message, "stable revision api--v1 with ");
  assertEquals(undo, [
    "az",
    "containerapp",
    "ingress",
    "traffic",
    "set",
    "--name=api",
    "--resource-group=rg-prod",
    "--revision-weight",
    "api--v1=100",
    "api--v2=0",
  ]);
  assertEquals(model.run(undo.slice(1)).code, 0);
  assertEquals(model.shares(), { "api--v1": 100 });
}

Deno.test("Container Apps: a resume or cancel configured for another resource group or subscription changes nothing, and says how to recover", async () => {
  for (const [label, change] of CHANGES) {
    for (const command of ["resume", "cancel"]) {
      fresh();
      await withStateDir(async (dir) => {
        const parked = await runCli(Deploy, ["ship"]);
        assertEquals(parked.code, 0, parked.err);
        model.calls = [];
        change();
        const id = await onlyRun(dir);
        const args = command === "resume"
          ? ["resume", id, "--signal", "approved"]
          : ["cancel", id];
        const { code, out, err } = await runCli(Deploy, args);
        const message = out + err;
        assertEquals(code, 1, `${label} ${command}`);
        // Refused before any command at all — not even a read.
        assertEquals(model.calls, [], `${label} ${command}`);
        assertEquals(message.includes("Rolled back"), false);
        assertStringIncludes(message, `this rollout staged with the ${label}`);
        assertEquals(model.shares(), { "api--v1": 50, "api--v2": 50 });
        assertEquals(model.shares("sub-test/rg-prod/api"), { "api--t1": 100 });
        recover(message);
      });
    }
  }
});

Deno.test("Container Apps: an app the CLI now reaches in another subscription is neither promoted nor rolled back", async () => {
  for (const command of ["resume", "cancel"]) {
    fresh();
    await withStateDir(async (dir) => {
      const parked = await runCli(Deploy, ["ship"]);
      assertEquals(parked.code, 0, parked.err);
      // Same configuration — but the CLI's default subscription is another
      // one now, as `az account set` would leave it.
      model.calls = [];
      model.defaultSubscription = "sub-test";
      const id = await onlyRun(dir);
      const args = command === "resume"
        ? ["resume", id, "--signal", "approved"]
        : ["cancel", id];
      const { code, out, err } = await runCli(Deploy, args);
      const message = out + err;
      assertEquals(code, 1, command);
      assertStringIncludes(
        message,
        "the app the Azure CLI reaches now is " +
          '"/subscriptions/sub-test/resourceGroups/rg-prod/providers/Microsoft.App/containerApps/api"',
      );
      assertEquals(model.mutations(), [], command);
      assertEquals(model.calls.length > 0, true, command);
      assertEquals(model.shares(), { "api--v1": 50, "api--v2": 50 });
      assertEquals(model.shares("sub-test/rg-prod/api"), { "api--t1": 100 });
      model.defaultSubscription = "sub-prod";
      recover(message);
    });
  }
});

Deno.test("Container Apps: a rollback run by hand goes to the configured stable revision", async () => {
  fresh();
  stable = "api--v1";
  model.api.revisions["api--v2"] = {
    created: "2026-10-18T00:00:00Z",
    provisioning: "Provisioned",
  };
  model.api.latest = "api--v2";
  model.api.traffic = [
    { revisionName: "api--v1", weight: 50 },
    { revisionName: "api--v2", weight: 50 },
  ];
  await withStateDir(async () => {
    const { code, err } = await runCli(Deploy, ["rollout.abort"]);
    assertEquals(code, 0, err);
    assertEquals(model.trafficMoves(), [["api--v1=100"]]);
    assertEquals(model.shares(), { "api--v1": 100 });
  });
});

Deno.test("Container Apps: a rollback run by hand with no stable revision refuses", async () => {
  fresh();
  await withStateDir(async () => {
    const { code, out, err } = await runCli(Deploy, ["rollout.abort"]);
    assertEquals(code, 1);
    assertStringIncludes(out + err, "a.stable('<revision>')");
    assertEquals(model.calls, []);
  });
});

Deno.test("Container Apps: a stage whose candidate never took traffic rolls nothing back", async () => {
  // The candidate fails to provision, so stage refuses after the deploy; the
  // engine's inline rollback must not then move the traffic.
  fresh();
  stable = "api--v0";
  model.provisioning = "Failed";
  await withStateDir(async () => {
    const { code, out, err } = await runCli(Deploy, ["rollout.stage"]);
    assertEquals(code, 1);
    assertStringIncludes(out + err, "is Failed, not Provisioned");
    assertEquals(model.trafficMoves(), [["api--v1=100"]]);
    assertEquals(model.shares(), { "api--v1": 100 });
  });
});

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the canary engine from `@zuke/canary` driving the Cloud Run
 * platform from `@zuke/gcloud`, through the real CLI. The two packages never
 * import each other, so this is also where they are proven to fit:
 * `c.platform(cloudRunCanary(...))` type-checks and runs end to end.
 *
 * A recording runner stands in for gcloud. It keeps every command line,
 * answers the revision read-back with whatever `latest` is, and models just
 * enough of Cloud Run to tell services apart: each one is keyed by project,
 * region and name, has a uid, and remembers the last traffic move made on it.
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

/** The candidate image the build resolves; empty when a parameter is unset. */
let image = "gcr.io/p/api:2";

/** The service the build is configured with. */
let service = "api";

/** The region the build is configured with. */
let region = "europe-west1";

/** The project the build passes with `--project`, if any. */
let project: string | undefined;

/** The project gcloud resolves when no `--project` is given. */
let activeProject = "prod";

/** The uid of each service, keyed `<project>/<region>/<name>`. */
let uids: Record<string, string> = {};

/** The last traffic move made on each service, by the same key. */
let traffic: Record<string, string> = {};

/** The flag's value in `argv`, if the flag is there. */
function flagValue(argv: readonly string[], flag: string): string | undefined {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}

/** Run one gcloud command line (without the binary) against the model. */
function gcloud(argv: string[]): CommandOutput {
  calls.push(argv);
  const key = `${flagValue(argv, "--project") ?? activeProject}/` +
    `${flagValue(argv, "--region")}/${argv[3]}`;
  const uid = uids[key];
  if (uid === undefined) {
    return new CommandOutput(1, "", `NOT_FOUND: no service ${key}`);
  }
  if (argv.includes("describe")) {
    const value = flagValue(argv, "--format") === "value(metadata.uid)"
      ? uid
      : latest;
    return new CommandOutput(0, `${value}\n`, "");
  }
  if (argv.includes("update-traffic")) {
    traffic[key] = argv.includes("--to-latest")
      ? "--to-latest"
      : flagValue(argv, "--to-tags") ?? `${flagValue(argv, "--to-revisions")}`;
  }
  return new CommandOutput(0, "", "");
}

class Deploy extends Build {
  rollout = canary((c) =>
    c.platform(
      cloudRunCanary((r) =>
        (stable === undefined ? r : r.stable(stable))
          .service(service).region(region).image(image)
          .gcloud((g) => project === undefined ? g : g.project(project))
          .runner((settings) =>
            Promise.resolve(gcloud(settings.argv().slice(1)))
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

/** The traffic moves the platform made, as their gcloud flag and value. */
function trafficMoves(): string[] {
  return calls.filter((argv) => argv.includes("update-traffic")).map((argv) => {
    if (argv.includes("--to-latest")) return "--to-latest";
    const flag = argv.includes("--to-tags") ? "--to-tags" : "--to-revisions";
    return argv[argv.indexOf(flag) + 1];
  });
}

/** The commands that change something — everything but the reads. */
function mutations(): string[][] {
  return calls.filter((argv) => !argv.includes("describe"));
}

/** The id of the only run under `dir`. */
async function onlyRun(dir: string): Promise<string> {
  const runs = await new FileSystemStateStore(dir, defaultStateHost).listRuns(
    {},
  );
  assertEquals(runs.length, 1);
  return runs[0].id;
}

/** The uid of the service the rollouts stage. */
const API_UID = "a000a000-0000-4000-8000-000000000000";

/** Configuration and the modelled Cloud Run back to how every test starts. */
function fresh(): void {
  calls = [];
  latest = "api-00002-new";
  healthy = true;
  stable = undefined;
  image = "gcr.io/p/api:2";
  service = "api";
  region = "europe-west1";
  project = undefined;
  activeProject = "prod";
  uids = {
    "prod/europe-west1/api": API_UID,
    "prod/europe-west1/billing": "b111b111-0000-4000-8000-000000000001",
    "prod/us-central1/api": "c222c222-0000-4000-8000-000000000002",
    "other/europe-west1/api": "d333d333-0000-4000-8000-000000000003",
    "staging/europe-west1/api": "e444e444-0000-4000-8000-000000000004",
  };
  traffic = {};
}

/**
 * The command in backticks after `lead` in `message`, split back into argv
 * the way a shell would: a token in single quotes is one token.
 */
function quotedCommand(message: string, lead: string): string[] {
  const at = message.indexOf(lead);
  assertEquals(at === -1, false, `no "${lead}" in: ${message}`);
  const start = message.indexOf("`", at + lead.length) + 1;
  const text = message.slice(start, message.indexOf("`", start));
  return [...text.matchAll(/'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2]);
}

Deno.test("Cloud Run: staged, stepped, parked, and promoted by a later process", async () => {
  fresh();
  await withStateDir(async (dir) => {
    const parked = await runCli(Deploy, ["ship"]);
    assertEquals(parked.code, 0, parked.err);
    assertEquals(calls[0].slice(0, 4), ["run", "services", "describe", "api"]);
    assertEquals(calls[1].slice(0, 4), ["run", "services", "update", "api"]);
    assertEquals(calls[1].includes("--no-traffic"), true);
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
    assertEquals(traffic["prod/europe-west1/api"], "--to-latest");
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

/** Each way the configuration can change while a rollout is parked. */
const CHANGES: ReadonlyArray<readonly [label: string, change: () => void]> = [
  ["service", () => service = "billing"],
  ["region", () => region = "us-central1"],
  ["gcloud flags", () => project = "other"],
];

/**
 * Prove the recovery a refusal names works: with the configuration set back,
 * the uid check it gives prints the recorded uid, and the command it gives
 * takes the candidate's traffic back on the service that was staged. Then the
 * other course it names, the rollback run by hand, as well.
 */
async function recover(message: string): Promise<void> {
  fresh();
  traffic["prod/europe-west1/api"] = "canary=50";
  const check = quotedCommand(message, "check that ");
  assertEquals(check[0], "gcloud");
  assertEquals(gcloud(check.slice(1)).stdout, `${API_UID}\n`);
  const undo = quotedCommand(message, "traffic back with ");
  assertEquals(undo, [
    "gcloud",
    "run",
    "services",
    "update-traffic",
    "api",
    "--region",
    "europe-west1",
    "--to-tags",
    "canary=0",
  ]);
  assertEquals(gcloud(undo.slice(1)).code, 0);
  assertEquals(traffic, { "prod/europe-west1/api": "canary=0" });

  calls = [];
  stable = "api-00001-old";
  const recovered = await runCli(Deploy, ["rollout.abort"]);
  assertEquals(recovered.code, 0, recovered.err);
  assertEquals(trafficMoves(), ["api-00001-old=100"]);
  assertEquals(traffic["prod/europe-west1/api"], "api-00001-old=100");
}

Deno.test("Cloud Run: a resume or cancel configured for another service changes nothing, and says how to recover", async () => {
  for (const [label, change] of CHANGES) {
    for (const command of ["resume", "cancel"]) {
      fresh();
      await withStateDir(async (dir) => {
        const parked = await runCli(Deploy, ["ship"]);
        assertEquals(parked.code, 0, parked.err);
        calls = [];
        change();
        const id = await onlyRun(dir);
        const args = command === "resume"
          ? ["resume", id, "--signal", "approved"]
          : ["cancel", id];
        const { code, out, err } = await runCli(Deploy, args);
        const message = out + err;
        assertEquals(code, 1, `${label} ${command}`);
        // Refused before any command at all — not even a read.
        assertEquals(calls, [], `${label} ${command}`);
        assertEquals(message.includes("Rolled back"), false);
        assertStringIncludes(message, `this rollout staged with the ${label}`);
        assertStringIncludes(message, "zuke rollout.abort");

        // The run is cancelled now: a second cancel cannot roll it back.
        const again = await runCli(Deploy, ["cancel", id]);
        assertEquals(mutations(), [], `${label} ${command} then cancel`);
        assertEquals((again.out + again.err).includes("Rolled back"), false);

        await recover(message);
      });
    }
  }
});

Deno.test("Cloud Run: a service gcloud now resolves elsewhere is neither promoted nor rolled back", async () => {
  for (const command of ["resume", "cancel"]) {
    fresh();
    await withStateDir(async (dir) => {
      const parked = await runCli(Deploy, ["ship"]);
      assertEquals(parked.code, 0, parked.err);
      // Same configuration — but gcloud's active project changed, as
      // `gcloud config set project staging` or CLOUDSDK_CORE_PROJECT would,
      // so the same name reaches another service.
      calls = [];
      activeProject = "staging";
      const id = await onlyRun(dir);
      const args = command === "resume"
        ? ["resume", id, "--signal", "approved"]
        : ["cancel", id];
      const { code, out, err } = await runCli(Deploy, args);
      const message = out + err;
      assertEquals(code, 1, command);
      assertStringIncludes(
        message,
        `the service "api" this rollout staged has the uid "${API_UID}", ` +
          "but the one gcloud reaches now has the uid " +
          '"e444e444-0000-4000-8000-000000000004"',
      );
      assertStringIncludes(message, "This call changed nothing");
      assertEquals(mutations(), [], command);
      assertEquals(calls.length > 0, true, command);
      // The staged service keeps its share; the other one was never touched.
      assertEquals(traffic, { "prod/europe-west1/api": "canary=50" });

      const again = await runCli(Deploy, ["cancel", id]);
      assertEquals(mutations(), [], `${command} then cancel`);
      assertEquals((again.out + again.err).includes("Rolled back"), false);

      await recover(message);
    });
  }
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

Deno.test("Cloud Run: a stage that fails on its own settings rolls nothing back", async () => {
  // A bad setting fails stage before it touches the service; the engine's
  // inline rollback must not then send production to the stable revision.
  fresh();
  stable = "api-00001-old";
  image = "";
  await withStateDir(async () => {
    const { code } = await runCli(Deploy, ["rollout.stage"]);
    assertEquals(code, 1);
    assertEquals(calls, []);
  });
});

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the canary engine from `@zuke/canary` driving the Lambda alias
 * platform from `@zuke/aws`, through the real CLI. The two packages never
 * import each other, so this is also where they are proven to fit:
 * `c.platform(lambdaCanary(...))` type-checks and runs end to end.
 *
 * The `aws` CLI is the shared Lambda model the unit tests use: functions keyed
 * by account, region and name, versions with code hashes, and aliases whose
 * revision every update changes.
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
import { lambdaCanary } from "../../packages/aws/mod.ts";
import { LambdaModel } from "../../packages/aws/tests/_lambda_model.ts";
import { runCli, withStateDir } from "./_harness.ts";

/** The modelled Lambda, fresh for each test. */
let model = new LambdaModel();

/** Whether the analysis passes. */
let healthy = true;

/** The version a hand-run rollback goes back to, if the build names one. */
let stable: string | undefined;

/** The alias the build is configured with. */
let alias = "live";

/** The profile the build passes with `--profile`, if any. */
let profile: string | undefined;

class Deploy extends Build {
  rollout = canary((c) =>
    c.platform(
      lambdaCanary((l) =>
        (stable === undefined ? l : l.stable(stable))
          .functionName("api").alias(alias)
          .zipFile("dist/api.zip")
          .aws((a) =>
            (profile === undefined ? a : a.profile(profile))
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

/** Configuration and the modelled Lambda back to how every test starts. */
function fresh(): void {
  model = new LambdaModel();
  model.accounts.other = "222222222222";
  model.functions["222222222222/eu-west-1/api"] = {
    versions: { "7": "sha-7" },
    aliases: { live: { version: "7", weights: {}, revision: "o-0" } },
    latest: "sha-7",
  };
  model.functions["111111111111/eu-west-1/api"].aliases.prod = {
    version: "1",
    weights: {},
    revision: "p-0",
  };
  healthy = true;
  stable = undefined;
  alias = "live";
  profile = undefined;
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

Deno.test("Lambda: staged, stepped, parked, and promoted by a later process", async () => {
  fresh();
  await withStateDir(async (dir) => {
    const parked = await runCli(Deploy, ["ship"]);
    assertEquals(parked.code, 0, parked.err);
    assertEquals(model.aliasUpdates(), [
      ['--routing-config={"AdditionalVersionWeights":{"4":0.1}}'],
      ['--routing-config={"AdditionalVersionWeights":{"4":0.5}}'],
    ]);
    assertStringIncludes(parked.out, "version 4");
    assertEquals(model.live.weights, { "4": 0.5 });

    // The resume is a new main(): promote reads the rollout stage recorded.
    const resumed = await runCli(Deploy, [
      "resume",
      await onlyRun(dir),
      "--signal",
      "approved",
    ]);
    assertEquals(resumed.code, 0, resumed.err);
    assertEquals(model.live.version, "4");
    assertEquals(model.live.weights, {});
  });
});

Deno.test("Lambda: a failed analysis takes the candidate's weight back", async () => {
  fresh();
  healthy = false;
  await withStateDir(async () => {
    const { code, out, err } = await runCli(Deploy, ["ship"]);
    assertEquals(code, 1);
    assertStringIncludes(out + err, "error ratio 0.3 above 0.01");
    assertEquals(model.aliasUpdates(), [
      ['--routing-config={"AdditionalVersionWeights":{"4":0.1}}'],
      ['--routing-config={"AdditionalVersionWeights":{}}'],
    ]);
    assertEquals(model.live, {
      version: "3",
      weights: {},
      revision: model.live.revision,
    });
  });
});

Deno.test("Lambda: an alias moved by someone else mid-rollout is never promoted", async () => {
  fresh();
  await withStateDir(async (dir) => {
    await runCli(Deploy, ["ship"]);
    model.live.version = "2";
    const resumed = await runCli(Deploy, [
      "resume",
      await onlyRun(dir),
      "--signal",
      "approved",
    ]);
    assertEquals(resumed.code, 1);
    assertStringIncludes(
      resumed.out + resumed.err,
      "something else changed it",
    );
    // The rollback still took the candidate's share off; nothing promoted it.
    assertEquals(model.live, {
      version: "2",
      weights: {},
      revision: model.live.revision,
    });
  });
});

/** Each way the configuration can change while a rollout is parked. */
const CHANGES: ReadonlyArray<readonly [label: string, change: () => void]> = [
  ["alias", () => alias = "prod"],
  ["AWS flags", () => profile = "other"],
];

/**
 * Prove the recovery a refusal names works: with the configuration set back,
 * the read it gives prints the recorded ARN, and the command it gives sends
 * the staged alias's traffic back to the stable version.
 */
function recover(message: string): void {
  const check = quotedCommand(message, "check that ");
  assertEquals(check[0], "aws");
  assertStringIncludes(
    model.run(check.slice(1)).stdout,
    "arn:aws:lambda:eu-west-1:111111111111:function:api:live",
  );
  const undo = quotedCommand(message, "stable version 3 with ");
  assertEquals(undo, [
    "aws",
    "lambda",
    "update-alias",
    "--function-name=api",
    "--name=live",
    "--function-version=3",
    '--routing-config={"AdditionalVersionWeights":{}}',
  ]);
  assertEquals(model.run(undo.slice(1)).code, 0);
  assertEquals(model.live.version, "3");
  assertEquals(model.live.weights, {});
}

Deno.test("Lambda: a resume or cancel configured for another alias or account changes nothing, and says how to recover", async () => {
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
        assertEquals(model.live.weights, { "4": 0.5 });
        assertEquals(
          model.functions["222222222222/eu-west-1/api"].aliases.live.weights,
          {},
        );
        recover(message);
      });
    }
  }
});

Deno.test("Lambda: an alias the CLI now reaches in another account is neither promoted nor rolled back", async () => {
  for (const command of ["resume", "cancel"]) {
    fresh();
    await withStateDir(async (dir) => {
      const parked = await runCli(Deploy, ["ship"]);
      assertEquals(parked.code, 0, parked.err);
      // Same configuration — but the default profile now resolves another
      // account, as a changed AWS_PROFILE or a re-pointed role would.
      model.calls = [];
      model.accounts.default = "222222222222";
      const id = await onlyRun(dir);
      const args = command === "resume"
        ? ["resume", id, "--signal", "approved"]
        : ["cancel", id];
      const { code, out, err } = await runCli(Deploy, args);
      const message = out + err;
      assertEquals(code, 1, command);
      assertStringIncludes(
        message,
        "the alias the AWS CLI reaches now is " +
          '"arn:aws:lambda:eu-west-1:222222222222:function:api:live"',
      );
      assertEquals(model.mutations(), [], command);
      assertEquals(model.calls.length > 0, true, command);
      assertEquals(model.live.weights, { "4": 0.5 });
      assertEquals(
        model.functions["222222222222/eu-west-1/api"].aliases.live,
        { version: "7", weights: {}, revision: "o-0" },
      );
      model.accounts.default = "111111111111";
      recover(message);
    });
  }
});

Deno.test("Lambda: a rollback run by hand goes to the configured stable version", async () => {
  fresh();
  stable = "2";
  model.live.weights = { "4": 0.5 };
  await withStateDir(async () => {
    const { code, err } = await runCli(Deploy, ["rollout.abort"]);
    assertEquals(code, 0, err);
    assertEquals(model.aliasUpdates(), [[
      "--function-version=2",
      '--routing-config={"AdditionalVersionWeights":{}}',
    ]]);
    assertEquals(model.live.version, "2");
  });
});

Deno.test("Lambda: a rollback run by hand with no stable version refuses", async () => {
  fresh();
  await withStateDir(async () => {
    const { code, out, err } = await runCli(Deploy, ["rollout.abort"]);
    assertEquals(code, 1);
    assertStringIncludes(out + err, "l.stable('<version>')");
    assertEquals(model.calls, []);
  });
});

Deno.test("Lambda: a stage that fails before reaching the alias rolls nothing back", async () => {
  // The package is the one already serving, so stage refuses after
  // publishing; the engine's inline rollback must not then move the alias.
  fresh();
  stable = "2";
  model.functions["111111111111/eu-west-1/api"].versions["3"] =
    "sha-fileb://dist/api.zip";
  await withStateDir(async () => {
    const { code, out, err } = await runCli(Deploy, ["rollout.stage"]);
    assertEquals(code, 1);
    assertStringIncludes(out + err, "nothing to roll out");
    assertEquals(model.aliasUpdates(), []);
    assertEquals(model.live.version, "3");
  });
});

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: AWS through the real CLI. A build gates on a CloudWatch metric
 * read with `AwsTasks.metricValue`; a secret read with `AwsTasks.secretString`
 * stays masked when the build goes on to print it; and a canary rollout's
 * `cloudwatch(...)` analysis promotes a healthy candidate and rolls back an
 * unhealthy one. Every `aws` command is answered by an injected runner, so
 * nothing is spawned and no account is needed.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { CommandOutput } from "../../packages/core/src/shell.ts";
import {
  type AwsSettings,
  AwsTasks,
  cloudwatch,
} from "../../packages/aws/mod.ts";
import { canary } from "../../packages/canary/mod.ts";
import { FakePlatform } from "../../packages/canary/tests/_platform.ts";
import { runCli, withoutMaskDirectives, withStateDir } from "./_harness.ts";

/** The datapoints the fake CloudWatch answers with; set per test. */
let datapoints: number[] = [0];

/** Every argv the fake `aws` was handed. */
let calls: string[][] = [];

/** A fake `aws`: get-metric-data answers from `datapoints`. */
function fakeAws(settings: AwsSettings): Promise<CommandOutput> {
  const argv = settings.argv();
  calls.push(argv);
  if (argv.includes("get-secret-value")) {
    return Promise.resolve(new CommandOutput(0, `"${SECRET}"\n`, ""));
  }
  const queries = argv[argv.indexOf("--metric-data-queries") + 1];
  const returned = JSON.parse(queries).filter(
    (q: { ReturnData: boolean }) => q.ReturnData,
  );
  const results = [{
    Id: returned[0].Id,
    Timestamps: datapoints.map((_, i) =>
      new Date(Date.UTC(2026, 9, 7, 11, 59 - i)).toISOString()
    ),
    Values: datapoints,
    StatusCode: "Complete",
  }];
  return Promise.resolve(
    new CommandOutput(0, JSON.stringify({ MetricDataResults: results }), ""),
  );
}

/** The secret the fake Secrets Manager holds — obviously fake. */
const SECRET = "fake-db-password-value";

class Gate extends Build {
  gate = target()
    .description("Fail when the Lambda's errors over 15 minutes are too many")
    .executes(async () => {
      const errors = await AwsTasks.metricValue((s) =>
        s.metricStat(
          "errors",
          (m) =>
            m.namespace("AWS/Lambda").metricName("Errors")
              .dimension("FunctionName", "api").stat("Sum"),
        )
          .window("15m").aggregate("sum").missingDataAs(0)
          .region("eu-west-1").runner(fakeAws)
      );
      if (!(errors <= 3)) throw new Error(`api had ${errors} errors, over 3`);
    });
}

Deno.test("a build gates on a CloudWatch metric read through AwsTasks", async () => {
  calls = [];
  datapoints = [1, 0, 1];
  const passed = await runCli(Gate, ["gate"]);
  assertEquals(passed.code, 0, passed.err);
  assertEquals(calls[0].slice(1, 3), ["cloudwatch", "get-metric-data"]);
  assertEquals(calls[0].includes("eu-west-1"), true);

  datapoints = [2, 2, 1];
  const failed = await runCli(Gate, ["gate"]);
  assertEquals(failed.code, 1);
  assertStringIncludes(failed.out + failed.err, "api had 5 errors, over 3");
});

class Leaky extends Build {
  leak = target()
    .description("Read a secret, then fail with it in the message")
    .executes(async () => {
      const password = await AwsTasks.secretString((s) =>
        s.secretId("prod/db").runner(fakeAws)
      );
      throw new Error(`could not connect with ${password}`);
    });
}

Deno.test("a secret read through AwsTasks is masked in the build's output", async () => {
  calls = [];
  const { code, out, err } = await runCli(Leaky, ["leak"]);
  assertEquals(code, 1);
  assertStringIncludes(out + err, "could not connect with");
  // Under Actions the raw value is printed in `::add-mask::` on purpose, so
  // the runner censors it; everything else must not carry it.
  assertEquals(withoutMaskDirectives(out + err).includes(SECRET), false);
  assertEquals(calls[0].slice(1, 3), ["secretsmanager", "get-secret-value"]);
});

/** The platform the canary below drives; reset per test. */
let platform = new FakePlatform();

class Deploy extends Build {
  rollout = canary((c) =>
    c.platform({
      exposure: "traffic",
      describe: () => platform.describe(),
      stage: (ctx) => platform.stage(ctx),
      expose: (percent, ctx) => platform.expose(percent, ctx),
      promote: (ctx) => platform.promote(ctx),
      abort: (ctx) => platform.abort(ctx),
    })
      .steps(10)
      .analysis(cloudwatch((m) =>
        m.name("canary 5xx").namespace("AWS/ApplicationELB")
          .metricName("HTTPCode_Target_5XX_Count")
          .dimension("TargetGroup", "targetgroup/api-canary/0a1b")
          .stat("Sum").window("5m").max(5).missingDataAs(0)
          .aws((a) => a.region("eu-west-1").runner(fakeAws))
      ))
  );
}

Deno.test("canary's cloudwatch analysis promotes a healthy candidate", async () => {
  platform = new FakePlatform();
  calls = [];
  datapoints = [0, 1, 0];
  await withStateDir(async () => {
    const { code, err } = await runCli(Deploy, ["rollout.promote"]);
    assertEquals(code, 0, err);
    assertEquals(platform.calls, ["stage", "expose 10 rev-2", "promote rev-2"]);
    assertEquals(calls.length > 0, true);
    assertEquals(calls[0].slice(1, 3), ["cloudwatch", "get-metric-data"]);
  });
});

Deno.test("canary's cloudwatch analysis rolls an unhealthy candidate back", async () => {
  platform = new FakePlatform();
  datapoints = [9];
  await withStateDir(async () => {
    const { code, out, err } = await runCli(Deploy, ["rollout.promote"]);
    assertEquals(code, 1);
    assertStringIncludes(out + err, "canary 5xx at");
    assertStringIncludes(out + err, "is 9, above the maximum 5");
    assertEquals(platform.calls, ["stage", "expose 10 rev-2", "abort rev-1"]);
  });
});

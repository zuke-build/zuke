// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: Azure through the real CLI entry point. A build gates on an
 * Azure Monitor metric read with `AzTasks.metricValue`; a Key Vault secret
 * read with `AzTasks.secretValue` stays masked when the build goes on to
 * print it; and a canary rollout's `azureMonitor(...)` analysis promotes a
 * healthy candidate and rolls back an unhealthy one. Every `az` command is
 * answered by an injected runner, so nothing is spawned and no subscription
 * is needed.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { CommandOutput } from "../../packages/core/src/shell.ts";
import {
  type AzSettings,
  AzTasks,
  azureMonitor,
} from "../../packages/az/mod.ts";
import { canary } from "../../packages/canary/mod.ts";
import { FakePlatform } from "../../packages/canary/tests/_platform.ts";
import { runCli, withoutMaskDirectives, withStateDir } from "./_harness.ts";

/** The per-minute totals the fake Azure Monitor answers with; set per test. */
let totals: number[] = [0];

/** Every argv the fake `az` was handed. */
let calls: string[][] = [];

/** The secret the fake Key Vault holds — obviously fake. */
const SECRET = "fake-db-password-value";

/** A fake `az`: metrics list answers from `totals`, keyvault from `SECRET`. */
function fakeAz(settings: AzSettings): Promise<CommandOutput> {
  const argv = settings.argv();
  calls.push(argv);
  if (argv.includes("keyvault")) {
    return Promise.resolve(new CommandOutput(0, `"${SECRET}"\n`, ""));
  }
  const metric = [{
    name: { value: "requests/failed" },
    timeseries: [{
      metadatavalues: [],
      data: totals.map((total, i) => ({
        timeStamp: new Date(Date.UTC(2026, 9, 7, 11, 59 - i)).toISOString(),
        total,
      })),
    }],
    errorCode: "Success",
  }];
  return Promise.resolve(new CommandOutput(0, JSON.stringify(metric), ""));
}

/** The Application Insights component the metrics are read from. */
const APP = "/subscriptions/0000/resourceGroups/rg/providers/" +
  "Microsoft.Insights/components/api";

class Gate extends Build {
  gate = target()
    .description(
      "Fail when the API's failed requests over 15 minutes are too many",
    )
    .executes(async () => {
      const failures = await AzTasks.metricValue((s) =>
        s.resource(APP).metrics("requests/failed").aggregation("Count")
          .window("15m").aggregate("sum").missingDataAs(0)
          .subscription("prod").runner(fakeAz)
      );
      if (!(failures <= 3)) {
        throw new Error(`api had ${failures} failed requests, over 3`);
      }
    });
}

Deno.test("a build gates on an Azure Monitor metric read through AzTasks", async () => {
  calls = [];
  // The fake answers under `total` whatever was asked, so the gate reads
  // Count from a key the answer does not carry: no data, which is 0.
  totals = [9, 9, 9];
  const passed = await runCli(Gate, ["gate"]);
  assertEquals(passed.code, 0, passed.err);
  assertEquals(calls[0].slice(1, 4), ["monitor", "metrics", "list"]);
  assertEquals(calls[0].includes("--subscription=prod"), true);
});

class TotalGate extends Build {
  gate = target()
    .description("Fail when the API's failed requests are too many")
    .executes(async () => {
      const failures = await AzTasks.metricValue((s) =>
        s.resource(APP).metrics("requests/failed").aggregation("Total")
          .window("15m").aggregate("sum").runner(fakeAz)
      );
      if (!(failures <= 3)) {
        throw new Error(`api had ${failures} failed requests, over 3`);
      }
    });
}

Deno.test("the metric gate fails a build over its limit", async () => {
  totals = [1, 0, 1];
  const passed = await runCli(TotalGate, ["gate"]);
  assertEquals(passed.code, 0, passed.err);
  totals = [2, 2, 1];
  const failed = await runCli(TotalGate, ["gate"]);
  assertEquals(failed.code, 1);
  assertStringIncludes(
    failed.out + failed.err,
    "api had 5 failed requests, over 3",
  );
});

class Leaky extends Build {
  leak = target()
    .description("Read a secret, then fail with it in the message")
    .executes(async () => {
      const password = await AzTasks.secretValue((s) =>
        s.vaultName("kv-prod").name("db-password").runner(fakeAz)
      );
      throw new Error(`could not connect with ${password}`);
    });
}

Deno.test("a secret read through AzTasks is masked in the build's output", async () => {
  calls = [];
  const { code, out, err } = await runCli(Leaky, ["leak"]);
  assertEquals(code, 1);
  assertStringIncludes(out + err, "could not connect with");
  // Under Actions the raw value is printed in `::add-mask::` on purpose, so
  // the runner censors it; everything else must not carry it.
  assertEquals(withoutMaskDirectives(out + err).includes(SECRET), false);
  assertEquals(calls[0].slice(1, 4), ["keyvault", "secret", "show"]);
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
      .analysis(azureMonitor((m) =>
        m.name("canary failures").resource(APP).metric("requests/failed")
          .aggregation("Total").dimension("cloud/roleName", "api-canary")
          .window("5m").max(5).missingDataAs(0)
          .az((a) => a.subscription("prod").runner(fakeAz))
      ))
  );
}

Deno.test("canary's azureMonitor analysis promotes a healthy candidate", async () => {
  platform = new FakePlatform();
  calls = [];
  totals = [0, 1, 0];
  await withStateDir(async () => {
    const { code, err } = await runCli(Deploy, ["rollout.promote"]);
    assertEquals(code, 0, err);
    assertEquals(platform.calls, ["stage", "expose 10 rev-2", "promote rev-2"]);
    assertEquals(calls.length > 0, true);
    assertEquals(calls[0].slice(1, 4), ["monitor", "metrics", "list"]);
    assertEquals(
      calls[0].includes("--filter=cloud/roleName eq 'api-canary'"),
      true,
    );
  });
});

Deno.test("canary's azureMonitor analysis rolls an unhealthy candidate back", async () => {
  platform = new FakePlatform();
  totals = [9];
  await withStateDir(async () => {
    const { code, out, err } = await runCli(Deploy, ["rollout.promote"]);
    assertEquals(code, 1);
    assertStringIncludes(out + err, "canary failures at");
    assertStringIncludes(out + err, "is 9, above the maximum 5");
    assertEquals(platform.calls, ["stage", "expose 10 rev-2", "abort rev-1"]);
  });
});

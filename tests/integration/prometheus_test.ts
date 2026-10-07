// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: Prometheus through the real CLI. A build gates on a metric read
 * with `PrometheusTasks`, authenticated by a secret parameter that never
 * reaches the output; and a canary rollout's `prometheus(...)` analysis — now
 * built on the same client — promotes a healthy candidate and rolls back an
 * unhealthy one.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, parameter, target } from "../../packages/core/mod.ts";
import { PrometheusTasks } from "../../packages/prometheus/mod.ts";
import { canary, prometheus } from "../../packages/canary/mod.ts";
import { FakePlatform } from "../../packages/canary/tests/_platform.ts";
import { fakeFetch, vector } from "../../packages/prometheus/tests/_fetch.ts";
import { runCli, withoutMaskDirectives, withStateDir } from "./_harness.ts";

/** What the fake Prometheus answers; set per test. */
let answer: () => Response = () => vector([{}, "0"]);

/** The fake every build below queries through. */
let prom = fakeFetch(() => answer());

/** The token the builds are run with — obviously fake. */
const TOKEN = "test-token-value";

class Gate extends Build {
  token = parameter("Prometheus bearer token").secret().required();
  gate = target()
    .description("Fail when the error ratio is too high")
    .executes(async () => {
      const result = await PrometheusTasks.query((s) =>
        s.url("https://prom.example").bearerToken(this.token.value)
          .fetch(prom).query("sum(rate(errors[5m])) or vector(0)")
      );
      const ratio = PrometheusTasks.value(result);
      if (!(ratio <= 0.01)) throw new Error(`error ratio ${ratio} above 0.01`);
    });
}

Deno.test("a build gates on a metric read through PrometheusTasks", async () => {
  prom = fakeFetch(() => answer());
  answer = () => vector([{}, "0.001"]);
  const passed = await runCli(Gate, ["gate", "--token", TOKEN]);
  assertEquals(passed.code, 0, passed.err);
  assertEquals(prom.sent[0].headers.get("authorization"), `Bearer ${TOKEN}`);
  assertEquals(prom.sent[0].url.pathname, "/api/v1/query");

  answer = () => vector([{}, "0.3"]);
  const failed = await runCli(Gate, ["gate", "--token", TOKEN]);
  assertEquals(failed.code, 1);
  assertStringIncludes(failed.out + failed.err, "error ratio 0.3 above 0.01");
});

Deno.test("a Prometheus refusal echoing the token never prints it", async () => {
  prom = fakeFetch(() => answer());
  answer = () =>
    Response.json({
      status: "error",
      errorType: "bad_data",
      error: `invalid token ${TOKEN}`,
    }, { status: 401 });
  const { code, out, err } = await runCli(Gate, ["gate", "--token", TOKEN]);
  assertEquals(code, 1);
  assertStringIncludes(out + err, "HTTP 401 (bad_data)");
  // Under Actions the executor prints the raw token in `::add-mask::` on
  // purpose, so the runner censors it; everything else must not carry it.
  assertEquals(withoutMaskDirectives(out + err).includes(TOKEN), false);
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
      .analysis(prometheus((p) =>
        p.name("error ratio").url("https://prom.example")
          .query('sum(rate(errors{rev="canary"}[5m])) or vector(0)')
          .header("Authorization", `Bearer ${TOKEN}`).max(0.01).fetch(prom)
      ))
  );
}

Deno.test("canary's prometheus analysis promotes a healthy candidate", async () => {
  platform = new FakePlatform();
  prom = fakeFetch(() => answer());
  answer = () => vector([{ rev: "canary" }, "0.001"]);
  await withStateDir(async () => {
    const { code, err } = await runCli(Deploy, ["rollout.promote"]);
    assertEquals(code, 0, err);
    assertEquals(platform.calls, ["stage", "expose 10 rev-2", "promote rev-2"]);
    const [sent] = prom.sent;
    assertEquals(sent.method, "GET");
    assertEquals(
      sent.url.searchParams.get("query"),
      'sum(rate(errors{rev="canary"}[5m])) or vector(0)',
    );
  });
});

class InCluster extends Build {
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
      .analysis(prometheus((p) =>
        p.name("error ratio").url("http://prometheus.monitoring.svc:9090")
          .query("sum(rate(errors[5m])) or vector(0)").max(0.01).fetch(prom)
      ))
  );
}

Deno.test("canary queries an unauthenticated in-cluster http Prometheus", async () => {
  platform = new FakePlatform();
  prom = fakeFetch(() => answer());
  answer = () => vector([{}, "0"]);
  await withStateDir(async () => {
    const { code, err } = await runCli(InCluster, ["rollout.promote"]);
    assertEquals(code, 0, err);
    assertEquals(
      prom.sent[0].url.origin,
      "http://prometheus.monitoring.svc:9090",
    );
  });
});

Deno.test("canary's prometheus analysis rolls an unhealthy candidate back", async () => {
  platform = new FakePlatform();
  prom = fakeFetch(() => answer());
  answer = () => vector([{ rev: "canary" }, "0.3"]);
  await withStateDir(async () => {
    const { code, out, err } = await runCli(Deploy, ["rollout.promote"]);
    assertEquals(code, 1);
    assertStringIncludes(
      out + err,
      "error ratio is 0.3, above the maximum 0.01",
    );
    assertEquals(platform.calls, ["stage", "expose 10 rev-2", "abort rev-1"]);
  });
});

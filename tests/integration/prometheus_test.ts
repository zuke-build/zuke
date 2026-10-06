// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: Prometheus through the real CLI. A build gates on a metric read
 * with `PrometheusTasks`, authenticated by a secret parameter that never
 * reaches the output.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, parameter, target } from "../../packages/core/mod.ts";
import { PrometheusTasks } from "../../packages/prometheus/mod.ts";
import { fakeFetch, vector } from "../../packages/prometheus/tests/_fetch.ts";
import { runCli } from "./_harness.ts";

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
      if (ratio > 0.01) throw new Error(`error ratio ${ratio} above 0.01`);
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
  assertEquals((out + err).includes(TOKEN), false);
});

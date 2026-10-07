// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Regression tests for the adversarial review of the Cloud Logging and Cloud
 * Monitoring additions to `@zuke/gcloud`. Each names the finding it guards
 * (S = security, L = logic), and each failed against the code before its
 * fix — or proves a refusal fires before anything runs, with a runner or a
 * `fetch` that ignores what it is handed and would otherwise answer
 * "success".
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { CommandError, CommandOutput } from "@zuke/core/shell";
import {
  cloudMonitoring,
  CloudMonitoringTasks,
  GcloudTasks,
  GcsTasks,
  SecretManagerTasks,
} from "../mod.ts";
import { NOW, pages, TOKEN } from "./_monitoring.ts";

/** A runner that never reads the settings it is handed. */
function ignoring(stdout: string, code = 0) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    run: () => {
      calls++;
      return Promise.resolve(new CommandOutput(code, stdout, ""));
    },
  };
}

/** A `fetch` that never reads the request and answers an empty page. */
function ignoringFetch() {
  let calls = 0;
  const fetch: typeof globalThis.fetch = () => {
    calls++;
    return Promise.resolve(new Response("{}"));
  };
  return {
    fetch,
    get calls() {
      return calls;
    },
  };
}

/** A context whose redactor masks nothing. */
const plain = { redact: (text: string) => text };

Deno.test("S1: a token with a line break is refused without quoting it", async () => {
  // Deno's own refusal of the header value is `Invalid header value:
  // "Bearer <token>"` — the token, quoted whole, in the error.
  const token = ["eeeeeeee", "ffffffff"].join("\n");
  const fetch = ignoringFetch();
  const error = await assertRejects(
    () =>
      CloudMonitoringTasks.timeSeriesList((s) =>
        s.project("p").metricType("m").token(token).fetch(fetch.fetch)
      ),
    Error,
    "control character",
  );
  assertEquals(error.message.includes("eeeeeeee"), false);
  assertEquals(error.message.includes("ffffffff"), false);
  assertEquals(fetch.calls, 0);
  // The same guard covers every REST group: it lives in the shared resolver.
  for (
    const call of [
      () => GcsTasks.readJson("b", "o", { token, fetch: fetch.fetch }),
      () =>
        SecretManagerTasks.access("s", {
          project: "p",
          token,
          fetch: fetch.fetch,
        }),
    ]
  ) {
    const refused = await assertRejects(call, Error, "control character");
    assertEquals(refused.message.includes("ffffffff"), false);
  }
});

Deno.test("S1: a provider's truncation notice is a refusal, not a header", async () => {
  // gcloudAccessToken reads `.text()`, which prefixes a truncated capture
  // with a notice line: the token would then hold a line break.
  const fetch = ignoringFetch();
  await assertRejects(
    () =>
      CloudMonitoringTasks.timeSeriesList((s) =>
        s.project("p").metricType("m").fetch(fetch.fetch).gcloud((g) =>
          g.runner(() =>
            Promise.resolve(
              new CommandOutput(0, "gggggggg", "", true, 4),
            )
          )
        )
      ),
    Error,
    "control character",
  );
  assertEquals(fetch.calls, 0);
  // Surrounding whitespace is not refused: the header trims it.
  const ok = pages({});
  await CloudMonitoringTasks.timeSeriesList((s) =>
    s.project("p").metricType("m").token(`${TOKEN}\n`).fetch(ok.fetch)
  );
  assertEquals(ok.headers[0].get("authorization"), `Bearer ${TOKEN}`);
});

Deno.test("S2: a typed monitoring value cannot widen the filter, before any request", async () => {
  const fetch = ignoringFetch();
  await assertRejects(
    () =>
      CloudMonitoringTasks.metricValue((s) =>
        s.project("p").metricType("m").token(TOKEN).fetch(fetch.fetch)
          .resourceLabel("revision_name", 'x" OR resource.type = "y')
      ),
    Error,
    "quotation mark",
  );
  await assertRejects(
    () =>
      CloudMonitoringTasks.metricValue((s) =>
        s.project("p").metricType("m").token(TOKEN).fetch(fetch.fetch)
          .metricLabel('k = "v" OR metric.labels.k', "v")
      ),
    Error,
    "not a label key",
  );
  assertEquals(fetch.calls, 0);
});

Deno.test("S3: a policy operand that reads as a flag is refused before the runner", async () => {
  const runner = ignoring("");
  await assertRejects(
    () =>
      GcloudTasks.monitoringPoliciesDescribe((s) =>
        s.policy("--project=other").runner(runner.run)
      ),
    Error,
    "starts with '-'",
  );
  assertEquals(runner.calls, 0);
});

Deno.test("L1: a count over the limit fails even when the runner ignores --limit", async () => {
  const many = JSON.stringify(Array.from({ length: 50 }, () => ({})));
  await assertRejects(
    () =>
      GcloudTasks.logEntryCount((s) => s.limit(10).runner(ignoring(many).run)),
    Error,
    "more than 10 log entries match",
  );
});

Deno.test("L2: a bad limit is refused before the runner, not made valid by the + 1", async () => {
  const runner = ignoring("[]");
  await assertRejects(
    () => GcloudTasks.logEntryCount((s) => s.limit(0).runner(runner.run)),
    Error,
    ".limit(0) is not a count",
  );
  assertEquals(runner.calls, 0);
});

Deno.test("L3: a failed read is not a count of zero, even after noThrow", async () => {
  await assertRejects(
    () =>
      GcloudTasks.logEntryCount((s) =>
        s.noThrow().runner(ignoring("[]", 1).run)
      ),
    CommandError,
  );
  await assertRejects(
    () =>
      cloudMonitoring((m) =>
        m.max(0).logEntries((l) => l.noThrow())
          .gcloud((g) => g.noThrow().runner(ignoring("[]", 1).run))
      ).validate(plain),
    Error,
    "could not be read",
  );
});

Deno.test("L4: a distribution with no samples is no data, not a value of 0", async () => {
  const empty = {
    timeSeries: [{
      points: [{
        interval: { endTime: "2026-10-07T12:09:00Z" },
        value: { distributionValue: { count: "0" } },
      }],
    }],
  };
  // A latency floor would otherwise pass on a mean of 0 that no request had.
  await assertRejects(
    () =>
      cloudMonitoring((m) =>
        m.project("p").metricType("m").token(TOKEN).now(NOW)
          .fetch(pages(empty).fetch).max(500)
      ).validate(plain),
    Error,
    "has no data",
  );
  assertEquals(
    await CloudMonitoringTasks.metricValue((s) =>
      s.project("p").metricType("m").token(TOKEN)
        .fetch(pages(empty).fetch).missingDataAs(-1)
    ),
    -1,
  );
});

Deno.test("L5: an invalid date is refused rather than thrown as a RangeError", async () => {
  const fetch = ignoringFetch();
  await assertRejects(
    () =>
      CloudMonitoringTasks.timeSeriesList((s) =>
        s.project("p").metricType("m").token(TOKEN).fetch(fetch.fetch)
          .interval(new Date("not a date"), new Date())
      ),
    Error,
    "invalid date",
  );
  await assertRejects(
    () =>
      CloudMonitoringTasks.timeSeriesList((s) =>
        s.project("p").metricType("m").token(TOKEN).fetch(fetch.fetch)
          .now(() => new Date(Number.NaN))
      ),
    Error,
    "gave an invalid date",
  );
  assertEquals(fetch.calls, 0);
});

Deno.test("L6: a blank raw filter is no filter, not ()", async () => {
  const runner = ignoring("[]");
  await GcloudTasks.logEntryCount((s) =>
    s.filter("  ").runner((settings) => {
      assertEquals(settings.argv().slice(1, 4), [
        "logging",
        "read",
        "--limit=1001",
      ]);
      return runner.run();
    })
  );
  await assertRejects(
    () =>
      CloudMonitoringTasks.timeSeriesList((s) =>
        s.project("p").token(TOKEN).filter(" ").fetch(ignoringFetch().fetch)
      ),
    Error,
    "no metric named",
  );
});

Deno.test("S4: a log count never captures a payload, and a bad answer is not quoted", async () => {
  const seen: string[][] = [];
  const secret = "hhhhhhhh";
  const error = await assertRejects(
    () =>
      GcloudTasks.logEntryCount((s) =>
        s.runner((settings) => {
          seen.push(settings.argv());
          return Promise.resolve(
            new CommandOutput(0, `{"textPayload":"${secret}"`, ""),
          );
        })
      ),
    Error,
    "not JSON",
  );
  assertEquals(error.message.includes(secret), false);
  assertStringIncludes(seen[0].join(" "), "--format json(insertId)");
});

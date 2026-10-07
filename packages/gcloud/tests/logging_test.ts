// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { CommandError, CommandOutput } from "@zuke/core/shell";
import {
  DEFAULT_COUNT_LIMIT,
  GcloudLoggingLogsListSettings,
  GcloudLoggingReadSettings,
  type GcloudSettings,
  GcloudTasks,
} from "../mod.ts";

// Every argv shape asserted here was run through Google Cloud SDK 588.0.0:
// each parses (gcloud gets as far as asking for credentials), and the
// refusals below mirror gcloud's own parse errors.

Deno.test("logging read: typed parts, quoted, then raw text, joined by AND", () => {
  const argv = new GcloudLoggingReadSettings()
    .resourceType("cloud_run_revision")
    .resourceLabel("service_name", "api")
    .label("env", "prod")
    .minSeverity("ERROR")
    .since(new Date(Date.UTC(2026, 9, 7, 12)))
    .until("2026-10-07T12:05:00Z")
    .filter("textPayload:timeout")
    .freshness("10m").order("asc").limit(5).project("p")
    .argv();
  assertEquals(argv, [
    "gcloud",
    "logging",
    "read",
    'resource.type="cloud_run_revision" AND ' +
    'resource.labels.service_name="api" AND labels.env="prod" AND ' +
    'severity>=ERROR AND timestamp>="2026-10-07T12:00:00.000Z" AND ' +
    'timestamp<"2026-10-07T12:05:00Z" AND (textPayload:timeout)',
    "--freshness=600s",
    "--order=asc",
    "--limit=5",
    "--project",
    "p",
  ]);
});

Deno.test("logging read: no filter emits no positional", () => {
  assertEquals(new GcloudLoggingReadSettings().argv(), [
    "gcloud",
    "logging",
    "read",
  ]);
});

Deno.test("logging read: a typed value is escaped so it cannot end its string", () => {
  const [, , , filter] = new GcloudLoggingReadSettings()
    .resourceLabel("revision_name", 'api" OR resource.type="gce_instance')
    .argv();
  assertEquals(
    filter,
    'resource.labels.revision_name="api\\" OR resource.type=\\"gce_instance"',
  );
  const [, , , slashed] = new GcloudLoggingReadSettings()
    .resourceType("a\\").argv();
  assertEquals(slashed, 'resource.type="a\\\\"');
});

Deno.test("logging read: control characters and odd label keys are refused", () => {
  assertThrows(
    () => new GcloudLoggingReadSettings().resourceType("a\nb"),
    Error,
    "control character",
  );
  assertThrows(
    () => new GcloudLoggingReadSettings().label("a.b", "x"),
    Error,
    "not a label key",
  );
  assertThrows(
    () => new GcloudLoggingReadSettings().resourceLabel("", "x"),
    Error,
    "not a label key",
  );
});

Deno.test("logging read: a raw filter starting with '-' cannot become a flag", () => {
  // gcloud: "unrecognized arguments: -severity=ERROR" for the bare form.
  const argv = new GcloudLoggingReadSettings().filter("-severity=DEBUG").argv();
  assertEquals(argv[3], "(-severity=DEBUG)");
});

Deno.test("logging read: the parent and the place to read from", () => {
  assertEquals(
    new GcloudLoggingReadSettings().organization("123")
      .logView("b", "global", "_AllLogs").argv().slice(3),
    [
      "--organization=123",
      "--bucket=b",
      "--location=global",
      "--view=_AllLogs",
    ],
  );
  assertEquals(
    new GcloudLoggingReadSettings().folder("9")
      .resourceNames("projects/p", "projects/q").argv().slice(3),
    ["--folder=9", "--resource-names=projects/p,projects/q"],
  );
  assertEquals(
    new GcloudLoggingReadSettings().billingAccount("0-0-0").argv().slice(3),
    ["--billing-account=0-0-0"],
  );
});

Deno.test("logging read: refusals in gcloud's own terms", () => {
  assertThrows(
    () =>
      new GcloudLoggingReadSettings().logView("b", "l", "v")
        .resourceNames("projects/p").argv(),
    Error,
    "accepts one",
  );
  assertThrows(
    () => new GcloudLoggingReadSettings().limit(0).argv(),
    Error,
    "GcloudTasks.loggingRead: .limit(0) is not a count",
  );
  assertThrows(
    () => new GcloudLoggingReadSettings().freshness("500ms"),
    Error,
    "under a second",
  );
  assertThrows(
    () => new GcloudLoggingReadSettings().resourceNames("a,b").argv(),
    Error,
    "joins its values with commas",
  );
  // Freshness rounds up to whole seconds, and takes ms.
  assertEquals(
    new GcloudLoggingReadSettings().freshness(1500).argv()[3],
    "--freshness=2s",
  );
});

Deno.test("logging logs list: view, filter, limit and sort", () => {
  assertEquals(
    new GcloudLoggingLogsListSettings().logView("b", "l", "v")
      .filter("name:x").limit(2).sortBy("~name").project("p").argv(),
    [
      "gcloud",
      "logging",
      "logs",
      "list",
      "--bucket=b",
      "--location=l",
      "--view=v",
      "--filter=name:x",
      "--limit=2",
      "--sort-by=~name",
      "--project",
      "p",
    ],
  );
  assertEquals(new GcloudLoggingLogsListSettings().argv(), [
    "gcloud",
    "logging",
    "logs",
    "list",
  ]);
  assertThrows(
    () => new GcloudLoggingLogsListSettings().limit(-1).argv(),
    Error,
    "loggingLogsList",
  );
});

/** A runner that records argv and answers with `stdout` (exit `code`). */
function answering(stdout: string, code = 0, stderr = "") {
  const calls: string[][] = [];
  const run = (settings: GcloudSettings) => {
    calls.push(settings.argv());
    return Promise.resolve(new CommandOutput(code, stdout, stderr));
  };
  return { calls, run };
}

/** `n` entries as the pinned `json(insertId)` projection prints them. */
function entries(n: number): string {
  return JSON.stringify(
    Array.from({ length: n }, (_, i) => ({ insertId: `id${i}` })),
  );
}

Deno.test("logEntryCount reads ids only, one past the limit, quietly", async () => {
  const fake = answering(entries(3));
  const count = await GcloudTasks.logEntryCount((s) =>
    s.minSeverity("ERROR").limit(10).format("yaml").runner(fake.run)
  );
  assertEquals(count, 3);
  const argv = fake.calls[0];
  assertEquals(argv.includes("--limit=11"), true);
  // Pinned after the caller's lambda: the caller's yaml is replaced.
  assertEquals(argv.slice(-2), ["--format", "json(insertId)"]);
});

Deno.test("logEntryCount: an empty list is zero", async () => {
  const fake = answering("[]\n");
  assertEquals(
    await GcloudTasks.logEntryCount((s) => s.runner(fake.run)),
    0,
  );
  assertEquals(
    fake.calls[0].includes(`--limit=${DEFAULT_COUNT_LIMIT + 1}`),
    true,
  );
});

Deno.test("logEntryCount: exactly the limit is exact, one more is refused", async () => {
  assertEquals(
    await GcloudTasks.logEntryCount((s) =>
      s.limit(5).runner(answering(entries(5)).run)
    ),
    5,
  );
  await assertRejects(
    () =>
      GcloudTasks.logEntryCount((s) =>
        s.limit(5).runner(answering(entries(6)).run)
      ),
    Error,
    "more than 5 log entries match",
  );
});

Deno.test("logEntryCount: a bad limit is refused before the + 1 hides it", async () => {
  const fake = answering("[]");
  await assertRejects(
    () => GcloudTasks.logEntryCount((s) => s.limit(0).runner(fake.run)),
    Error,
    "GcloudTasks.logEntryCount: .limit(0) is not a count",
  );
  assertEquals(fake.calls.length, 0);
});

Deno.test("logEntryCount fails on a failed exit, even after noThrow", async () => {
  await assertRejects(
    () =>
      GcloudTasks.logEntryCount((s) =>
        s.noThrow().runner(answering("", 1, "PERMISSION_DENIED").run)
      ),
    CommandError,
  );
});

Deno.test("logEntryCount refuses output that is not a JSON list, without quoting it", async () => {
  const secret = "aaaaaaaa-not-json";
  const error = await assertRejects(
    () => GcloudTasks.logEntryCount((s) => s.runner(answering(secret).run)),
    Error,
    "not JSON",
  );
  assertEquals(error.message.includes(secret), false);
  await assertRejects(
    () => GcloudTasks.logEntryCount((s) => s.runner(answering("{}").run)),
    Error,
    "did not print a list",
  );
});

Deno.test("logEntryCount refuses a truncated capture", async () => {
  const run = () => Promise.resolve(new CommandOutput(0, "]", "", true, 16));
  await assertRejects(
    () => GcloudTasks.logEntryCount((s) => s.runner(run)),
    Error,
    "capture cap",
  );
});

Deno.test("loggingRead runs through a runner with the settings' argv", async () => {
  const fake = answering("[]");
  const out = await GcloudTasks.loggingRead((s) =>
    s.resourceType("global").runner(fake.run)
  );
  assertEquals(out.code, 0);
  assertStringIncludes(fake.calls[0][3], 'resource.type="global"');
});

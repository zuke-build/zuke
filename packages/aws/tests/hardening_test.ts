// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Regression tests for the adversarial review of `@zuke/aws`. Each test names
 * the finding it guards (S = security, L = logic, C = CLI fidelity), and each
 * failed against the code before its fix.
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { CommandError, CommandOutput } from "@zuke/core/shell";
import {
  AwsCloudformationDeleteStackSettings,
  AwsCloudformationDeploySettings,
  AwsCloudwatchDescribeAlarmsSettings,
  AwsCloudwatchGetMetricDataSettings,
  AwsConfigureGetSettings,
  AwsConfigureSetSettings,
  AwsEcrDescribeRepositoriesSettings,
  AwsEcsDescribeServicesSettings,
  AwsEcsRegisterTaskDefinitionSettings,
  AwsEcsUpdateServiceSettings,
  AwsLambdaInvokeSettings,
  AwsLambdaPublishVersionSettings,
  AwsLambdaUpdateFunctionCodeSettings,
  AwsLambdaUpdateFunctionConfigurationSettings,
  AwsLogsFilterLogEventsSettings,
  AwsLogsStartQuerySettings,
  AwsLogsTailSettings,
  AwsOutputError,
  AwsS3CpSettings,
  AwsS3PresignSettings,
  AwsSecretsmanagerGetSecretValueSettings,
  AwsSettings,
  AwsSsmGetParameterSettings,
  AwsSsmPutParameterSettings,
  AwsStsAssumeRoleSettings,
  AwsTasks,
  cloudwatch,
} from "../mod.ts";
import { FakeAws, json, withEmptyPath } from "./_fake.ts";

/** Record what a settings instance registers with the run's redactor. */
function recording<S extends AwsSettings>(settings: S): {
  settings: S;
  marked: string[];
} {
  const marked: string[] = [];
  // A recording subclass per class would be four near-identical classes; the
  // redactor's seam is the protected markSecret, so wrap it on the instance.
  Object.defineProperty(settings, "markSecret", {
    value: (value: string) => marked.push(value),
  });
  return { settings, marked };
}

Deno.test("S1: a text-output secret is still found and masked", async () => {
  const { settings, marked } = recording(
    new AwsSecretsmanagerGetSecretValueSettings().secretId("s")
      .output("text").query("SecretString"),
  );
  const fake = new FakeAws('{"username":"a","password":"Pa55w0rdXYZ"}\n');
  await settings.runner(fake.run).run();
  assertEquals(fake.flag(0, "--output"), "json");
  assertEquals(marked.includes("Pa55w0rdXYZ"), true);
});

Deno.test("S2: a numeric parameter and a reshaped assume-role are masked", async () => {
  const parameter = recording(new AwsSsmGetParameterSettings().name("/pin"));
  await parameter.settings.runner(new FakeAws("48213977\n").run).run();
  assertEquals(parameter.marked.includes("48213977"), true);

  const role = recording(
    new AwsStsAssumeRoleSettings().roleArn("r").roleSessionName("n")
      .query("Credentials.[SecretAccessKey,SessionToken]").output("text"),
  );
  const fake = new FakeAws(json(["sk-value-1234", "st-value-5678"]));
  await role.settings.runner(fake.run).run();
  assertEquals(fake.flag(0, "--output"), "json");
  assertEquals(role.marked.includes("sk-value-1234"), true);
  assertEquals(role.marked.includes("st-value-5678"), true);
});

Deno.test("S3: credential fields are found nested, by name segment, 8+ chars", async () => {
  const secret = JSON.stringify({
    db: { password: "nested-pass-123" },
    apiKey: "short",
    clientSecret: "client-secret-value",
    keyId: "key-identifier-12",
    hostname: "db.example.internal",
    list: [{ token: "token-in-a-list" }],
  });
  const { settings, marked } = recording(
    new AwsSecretsmanagerGetSecretValueSettings().secretId("s"),
  );
  await settings.runner(new FakeAws(json({ SecretString: secret })).run).run();
  for (
    const masked of [
      "nested-pass-123",
      "client-secret-value",
      "token-in-a-list",
    ]
  ) {
    assertEquals(marked.includes(masked), true, masked);
  }
  for (const kept of ["short", "key-identifier-12", "db.example.internal"]) {
    assertEquals(marked.includes(kept), false, kept);
  }
});

Deno.test("S4: a SecretBinary is masked", async () => {
  const { settings, marked } = recording(
    new AwsSecretsmanagerGetSecretValueSettings().secretId("s"),
  );
  await settings.runner(
    new FakeAws(json({ Name: "s", SecretBinary: "binary-secret-base64==" }))
      .run,
  ).run();
  assertEquals(marked.includes("binary-secret-base64=="), true);
});

Deno.test("S5: configure get of a credential setting is masked", async () => {
  const { settings, marked } = recording(
    new AwsConfigureGetSettings().varname("profile.ci.aws_secret_access_key"),
  );
  await settings.runner(new FakeAws("example-secret-key-value\n").run).run();
  assertEquals(marked, ["example-secret-key-value"]);
  const plain = recording(new AwsConfigureGetSettings().varname("region"));
  await plain.settings.runner(new FakeAws("eu-west-1\n").run).run();
  assertEquals(plain.marked, []);
});

Deno.test("S6: configure set matches the dotted form's last segment", () => {
  const { settings, marked } = recording(new AwsConfigureSetSettings());
  settings.varname("profile.ci.aws_session_token").value("tok-value-1234");
  assertEquals(marked, ["tok-value-1234"]);
});

Deno.test("S7: no list element or operand can be read as an option", async () => {
  const injected = "--endpoint-url=http://attacker.example";
  const refusals: Array<() => unknown> = [
    () =>
      new AwsEcrDescribeRepositoriesSettings().repositoryNames("api", injected)
        .argv(),
    () => new AwsEcsDescribeServicesSettings().services(injected).argv(),
    () =>
      new AwsEcsRegisterTaskDefinitionSettings().family("f")
        .requiresCompatibilities(injected).argv(),
    () =>
      new AwsLambdaUpdateFunctionCodeSettings().functionName("f").zipFile("a")
        .architectures(injected).argv(),
    () =>
      new AwsLambdaUpdateFunctionConfigurationSettings().functionName("f")
        .layers(injected).argv(),
    () =>
      new AwsCloudformationDeploySettings().templateFile("t").stackName("s")
        .capabilities(injected).argv(),
    () =>
      new AwsCloudformationDeploySettings().templateFile("t").stackName("s")
        .tag("-k", "v").argv(),
    () =>
      new AwsCloudformationDeploySettings().templateFile("t").stackName("s")
        .parameterOverride("-k", "v").argv(),
    () =>
      new AwsCloudformationDeleteStackSettings().stackName("s")
        .retainResources(injected).argv(),
    () => new AwsCloudwatchDescribeAlarmsSettings().alarmNames(injected).argv(),
    () =>
      new AwsLogsStartQuerySettings().logGroupNames(injected).queryString("q")
        .window("5m").argv(),
    () =>
      new AwsLogsFilterLogEventsSettings().logGroupName("g")
        .logStreamNames(injected).argv(),
    () => new AwsLogsTailSettings().groupName(injected).argv(),
    () => new AwsS3CpSettings().source(injected).destination("s3://b").argv(),
    () => new AwsConfigureSetSettings().varname("region").value("-x").argv(),
    () => new AwsLambdaInvokeSettings().functionName("f").outfile("-o").argv(),
  ];
  for (const refuse of refusals) {
    assertThrows(refuse, Error, "starts with '-'");
  }
  await assertRejects(
    () => AwsTasks.alarmState(injected, (s) => s.runner(new FakeAws("[]").run)),
    Error,
    "starts with '-'",
  );
  // A single-valued option keeps a hyphen-led value as its value.
  assertEquals(
    new AwsEcsUpdateServiceSettings().cluster("-odd").service("api").argv()
      .includes("--cluster=-odd"),
    true,
  );
});

Deno.test("S8: free-text setters refuse what the CLI would read as a file", () => {
  const files = "file://~/.aws/credentials";
  const refusals: Array<() => unknown> = [
    () => new AwsLambdaPublishVersionSettings().description(files),
    () => new AwsLambdaUpdateFunctionConfigurationSettings().description(files),
    () => new AwsSsmPutParameterSettings().description(files),
    () => new AwsStsAssumeRoleSettings().externalId(files),
    () => new AwsStsAssumeRoleSettings().policy("fileb://policy.json"),
    () => new AwsLambdaInvokeSettings().payload(files),
    () => new AwsLogsStartQuerySettings().queryString(files),
    () => new AwsLogsFilterLogEventsSettings().filterPattern(files),
    () => new AwsLogsTailSettings().filterPattern(files),
  ];
  for (const refuse of refusals) assertThrows(refuse, Error, "file://");
});

Deno.test("S9: a presigned URL and its session token are masked", async () => {
  const url = "https://b.s3.amazonaws.com/k?X-Amz-Signature=abcdef123456" +
    "&X-Amz-Security-Token=SessionTokenValue123";
  const { settings, marked } = recording(
    new AwsS3PresignSettings().path("s3://b/k"),
  );
  await settings.runner(new FakeAws(`${url}\n`).run).run();
  assertEquals(marked.includes(url), true);
  assertEquals(marked.includes("SessionTokenValue123"), true);
  // No token, no URL, or nothing at all: what there is, and no more.
  const others: Array<[string, number]> = [
    ["https://b.s3.amazonaws.com/k?X-Amz-Signature=abc\n", 1],
    ["not a url at all\n", 1],
    ["\n", 0],
  ];
  for (const [printed, expected] of others) {
    const other = recording(new AwsS3PresignSettings().path("s3://b/k"));
    await other.settings.runner(new FakeAws(printed).run).run();
    assertEquals(other.marked.length, expected);
  }
});

Deno.test("S10: debug output's credentials are masked", () => {
  const names = [
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_ACCESS_KEY_ID",
  ];
  const previous = names.map((name) => Deno.env.get(name));
  names.forEach((name, i) => Deno.env.set(name, `debug-${i}-credential`));
  try {
    const { settings, marked } = recording(new AwsSettings());
    settings.debug();
    assertEquals(marked.sort(), [
      "debug-0-credential",
      "debug-1-credential",
      "debug-2-credential",
    ]);
  } finally {
    names.forEach((name, i) => {
      const value = previous[i];
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    });
  }
});

/** A Logs Insights query against `fake`. */
function insights(
  fake: FakeAws,
  timeout: number,
  interval: number,
  signal?: AbortSignal,
) {
  return AwsTasks.logsInsightsQuery((q) => {
    q.logGroupNames("g").queryString("q").window("5m").timeout(timeout)
      .pollInterval(interval).aws((a) => a.runner(fake.run));
    return signal === undefined ? q : q.signal(signal);
  });
}

Deno.test("L2: the Logs Insights timeout does not wait out a long poll interval", async () => {
  const fake = new FakeAws(json({ queryId: "q" }), json({ status: "Running" }));
  const started = Date.now();
  await assertRejects(() => insights(fake, 30, 10_000), Error, "still Running");
  assertEquals(Date.now() - started < 2_000, true);
});

Deno.test("L3: a Logs Insights query is stopped when cancelled or broken", async () => {
  const controller = new AbortController();
  const cancelled = new FakeAws(json({ queryId: "q" }), (argv) => {
    if (argv.includes("get-query-results")) controller.abort();
    return new CommandOutput(0, json({ status: "Running" }), "");
  });
  await assertRejects(() =>
    insights(cancelled, 60_000, 60_000, controller.signal)
  );
  const lastCancelled = cancelled.calls[cancelled.calls.length - 1];
  assertEquals(lastCancelled.slice(1, 3), ["logs", "stop-query"]);

  const broken = new FakeAws(
    json({ queryId: "q" }),
    (argv) =>
      new CommandOutput(0, argv.includes("stop-query") ? "{}" : "{}", ""),
  );
  await assertRejects(() => insights(broken, 60_000, 1), AwsOutputError);
  const lastBroken = broken.calls[broken.calls.length - 1];
  assertEquals(lastBroken.slice(1, 3), ["logs", "stop-query"]);
});

Deno.test("L3: a signal cancels the pause between polls, and lets a healthy query finish", async () => {
  const controller = new AbortController();
  const sleeping = new FakeAws(
    json({ queryId: "q" }),
    json({ status: "Running" }),
  );
  const pending = insights(sleeping, 60_000, 60_000, controller.signal);
  setTimeout(() => controller.abort(new Error("cancelled by the run")), 20);
  await assertRejects(() => pending, Error, "cancelled by the run");
  const last = sleeping.calls[sleeping.calls.length - 1];
  assertEquals(last.slice(1, 3), ["logs", "stop-query"]);

  const healthy = new FakeAws(
    json({ queryId: "q" }),
    json({ status: "Running" }),
    json({ status: "Complete", results: [] }),
  );
  assertEquals(
    await insights(healthy, 60_000, 1, new AbortController().signal),
    [],
  );
});

Deno.test("L4: a long series aggregates without a RangeError", async () => {
  const count = 300_000;
  const values = Array.from({ length: count }, (_, i) => i % 1000);
  const start = Date.UTC(2026, 0, 1);
  const timestamps = values.map((_, i) =>
    new Date(start + i * 1000).toISOString()
  );
  const fake = new FakeAws(JSON.stringify({
    MetricDataResults: [{ Id: "e", Timestamps: timestamps, Values: values }],
  }));
  const read = (aggregate: "maximum" | "minimum") =>
    AwsTasks.metricValue((s) =>
      s.expression("e", "1").window("5m").aggregate(aggregate).runner(fake.run)
    );
  assertEquals(await read("maximum"), 999);
  assertEquals(await read("minimum"), 0);
});

const redactor = {
  redact: (text: string) => text.replaceAll("s3cr3t", "[redacted]"),
};

Deno.test("L5: an error from the analysis's own lambda is redacted", async () => {
  const error = await assertRejects(() =>
    cloudwatch(() => {
      throw new Error("could not resolve s3cr3t");
    }).validate(redactor)
  );
  assertEquals(error.message.includes("s3cr3t"), false);
});

Deno.test("R6: the analysis spawns aws when .aws(...) sets no runner", async () => {
  await withEmptyPath(async () => {
    await assertRejects(
      () =>
        cloudwatch((m) => m.namespace("n").metricName("m").stat("Sum").max(1))
          .validate(redactor),
      Error,
      "could not be read",
    );
  });
});

Deno.test("L6: missingDataAs refuses a number that is not finite, for the reader too", async () => {
  await assertRejects(
    () => AwsTasks.metricValue((s) => s.missingDataAs(NaN)),
    Error,
    "finite",
  );
});

Deno.test("L7a: the analysis's missing-statistic hint uses its own names", async () => {
  const error = await assertRejects(() =>
    cloudwatch((m) =>
      m.namespace("n").metricName("m").max(1)
        .aws((a) => a.runner(new FakeAws("[]").run))
    ).validate(redactor)
  );
  assertStringIncludes(error.message, ".stat(");
  assertEquals(error.message.includes("AwsTasks."), false);
});

Deno.test("L7b: a reader's failed command is a CommandError even under noThrow", async () => {
  const failing = () => new FakeAws(new CommandOutput(254, "", "AccessDenied"));
  await assertRejects(
    () =>
      AwsTasks.metricValue((s) =>
        s.expression("e", "1").window("5m").noThrow().runner(failing().run)
      ),
    CommandError,
  );
  await assertRejects(
    () => AwsTasks.accountId((s) => s.noThrow().runner(failing().run)),
    CommandError,
  );
  await assertRejects(
    () =>
      AwsTasks.logsInsightsQuery((q) =>
        q.logGroupNames("g").queryString("q").window("5m")
          .aws((a) => a.noThrow().runner(failing().run))
      ),
    CommandError,
  );
});

Deno.test("L7c: a query set through .aws(...) does not reach the query's commands", async () => {
  const fake = new FakeAws(
    json({ queryId: "q" }),
    json({ status: "Complete", results: [] }),
  );
  await AwsTasks.logsInsightsQuery((q) =>
    q.logGroupNames("g").queryString("q").window("5m")
      .aws((a) => a.query("bogus").runner(fake.run))
  );
  for (const call of fake.calls) assertEquals(call.includes("bogus"), false);
});

Deno.test("L-window: the analysis window ends on a period boundary of an injected clock", async () => {
  const fake = new FakeAws(json({
    MetricDataResults: [{ Id: "m1", Timestamps: [], Values: [] }],
  }));
  await cloudwatch((m) =>
    m.namespace("n").metricName("m").stat("Sum").period(300).window("10m")
      .max(1).missingDataAs(0).now(() => new Date("2026-10-07T12:07:30Z"))
      .aws((a) => a.runner(fake.run))
  ).validate(redactor);
  assertEquals(fake.flag(0, "--start-time"), "2026-10-07T11:55:00.000Z");
  assertEquals(fake.flag(0, "--end-time"), "2026-10-07T12:05:00.000Z");
});

Deno.test("C1: metricValue refuses maxDatapoints and a partial page", async () => {
  await assertRejects(
    () =>
      AwsTasks.metricValue((s) =>
        s.expression("e", "1").window("5m").maxDatapoints(10)
          .runner(new FakeAws("[]").run)
      ),
    Error,
    "maxDatapoints",
  );
  const partial = new FakeAws(json({
    MetricDataResults: [{
      Id: "e",
      Timestamps: ["2026-10-07T11:59:00Z"],
      Values: [1],
      StatusCode: "PartialData",
    }],
    NextToken: "more",
  }));
  await assertRejects(
    () =>
      AwsTasks.metricValue((s) =>
        s.expression("e", "1").window("5m").runner(partial.run)
      ),
    AwsOutputError,
    "PartialData",
  );
});

Deno.test("C2: a Complete Logs Insights answer is followed through nextToken", async () => {
  const page = (value: string) => [[{ field: "n", value }]];
  const fake = new FakeAws(
    json({ queryId: "q" }),
    json({ status: "Complete", results: page("1"), nextToken: "t2" }),
    json({ status: "Complete", results: page("2") }),
  );
  const rows = await AwsTasks.logsInsightsQuery((q) =>
    q.logGroupNames("g").queryString("q").window("5m")
      .aws((a) => a.runner(fake.run))
  );
  assertEquals(rows, [{ n: "1" }, { n: "2" }]);
  assertEquals(fake.flag(2, "--next-token"), "t2");
});

Deno.test("C3: alarmState reads log alarms too", async () => {
  const fake = new FakeAws(
    json([{ AlarmName: "errors", StateValue: "ALARM" }]),
  );
  assertEquals(
    await AwsTasks.alarmState("errors", (s) => s.runner(fake.run)),
    "ALARM",
  );
  assertEquals(
    fake.flag(0, "--query"),
    "[MetricAlarms, CompositeAlarms, LogAlarms][]",
  );
  assertEquals(fake.calls[0].includes("LogAlarm"), true);
});

Deno.test("C5/C7: the off output format, and auto-prompt off in the environment", async () => {
  assertEquals(new AwsSettings().output("off").argv(), [
    "aws",
    "--output",
    "off",
  ]);
  const output = await new AwsSettings()
    .toolPath(Deno.execPath())
    .command("eval", "console.log(Deno.env.get('AWS_CLI_AUTO_PROMPT'))")
    .quiet()
    .run();
  assertEquals(output.stdout.trim(), "off");
});

Deno.test("C4: IQM is a statistic", () => {
  const argv = new AwsCloudwatchGetMetricDataSettings()
    .metricStat("m", (m) => m.namespace("n").metricName("x").stat("IQM"))
    .window("5m").argv();
  const queries = JSON.parse(argv[argv.indexOf("--metric-data-queries") + 1]);
  assertEquals(queries[0].MetricStat.Stat, "IQM");
});

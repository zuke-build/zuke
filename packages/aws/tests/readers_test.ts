// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { CommandOutput } from "@zuke/core/shell";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  AwsEcrGetLoginPasswordSettings,
  AwsOutputError,
  AwsSecretsmanagerGetSecretValueSettings,
  AwsSsmGetParameterSettings,
  AwsStsAssumeRoleSettings,
  AwsTasks,
} from "../mod.ts";
// Internal to the package: the public surface is the task-shaped readers, so
// these are imported from their modules rather than re-exported by mod.ts.
import { readJson, readScalar } from "../src/scalar_output.ts";
import { secretsIn } from "../src/secret_output.ts";
import { FakeAws, json, withEmptyPath } from "./_fake.ts";

const CAP = 8388608;

Deno.test("readScalar returns the single line the CLI printed", () => {
  assertEquals(
    readScalar(
      { stdout: "123456789012\n", truncated: false, maxCapturedBytes: CAP },
      "AwsTasks.accountId",
      "account id",
    ),
    "123456789012",
  );
});

Deno.test("readScalar refuses empty, multi-line and truncated output", () => {
  const empty = assertThrows(
    () =>
      readScalar(
        { stdout: " \n", truncated: false, maxCapturedBytes: CAP },
        "AwsTasks.accountId",
        "account id",
      ),
    AwsOutputError,
    "printed nothing",
  );
  assertEquals(
    empty instanceof AwsOutputError && empty.task,
    "AwsTasks.accountId",
  );
  assertThrows(
    () =>
      readScalar(
        { stdout: "a\nb\n", truncated: false, maxCapturedBytes: CAP },
        "AwsTasks.accountId",
        "account id",
      ),
    AwsOutputError,
    "more than one line",
  );
  assertThrows(
    () =>
      readScalar(
        { stdout: "x", truncated: true, maxCapturedBytes: 1024 },
        "AwsTasks.accountId",
        "account id",
      ),
    AwsOutputError,
    "1024-byte",
  );
});

Deno.test("readJson parses, and never quotes output it cannot parse", () => {
  assertEquals(
    readJson(
      { stdout: '{"a":1}', truncated: false, maxCapturedBytes: CAP },
      "t",
    ),
    { a: 1 },
  );
  const error = assertThrows(
    () =>
      readJson(
        { stdout: "hunter2-not-json", truncated: false, maxCapturedBytes: CAP },
        "AwsTasks.secretString",
      ),
    AwsOutputError,
    "not JSON",
  );
  assertEquals(error.message.includes("hunter2"), false);
  assertThrows(
    () => readJson({ stdout: "{}", truncated: true, maxCapturedBytes: 9 }, "t"),
    AwsOutputError,
    "9-byte",
  );
});

Deno.test("secretsIn finds secrets in JSON, a JSON string, or plain text", () => {
  assertEquals(
    secretsIn(
      json({ Credentials: { SecretAccessKey: "sk", SessionToken: "st" } }),
      ["SecretAccessKey", "SessionToken"],
    ),
    ["sk", "st"],
  );
  assertEquals(
    secretsIn(json([{ Value: "a" }, { Value: 1 }, "x"]), ["Value"]),
    ["a"],
  );
  assertEquals(secretsIn(json("line1\nline2"), []), ["line1\nline2"]);
  assertEquals(secretsIn("eyJwYXNzd29yZCI6\n", []), ["eyJwYXNzd29yZCI6"]);
  assertEquals(secretsIn("\n", []), []);
  // A reshaped answer without the expected keys has every scalar registered.
  assertEquals(secretsIn("42", ["Value"]), ["42"]);
  assertEquals(secretsIn(json({ a: true, b: null }), ["Value"]), ["true"]);
  assertEquals(secretsIn("null\n", ["Value"]), []);
  assertEquals(secretsIn(json({}), ["Value"]), ["{}"]);
  // A JSON secret also yields its credential-named fields, and only those.
  const rds = JSON.stringify({
    username: "admin",
    password: "pw-inside-json",
    engine: "postgres",
    port: 5432,
    apiKey: "key-inside-json",
  });
  assertEquals(secretsIn(json({ SecretString: rds }), ["SecretString"]), [
    rds,
    "pw-inside-json",
    "key-inside-json",
  ]);
  assertEquals(secretsIn(json("[1,2]"), []), ["[1,2]"]);
});

Deno.test("accountId pins --query Account --output text, quietly", async () => {
  const fake = new FakeAws("123456789012\n");
  const id = await AwsTasks.accountId((s) =>
    s.profile("deploy").output("json").query("UserId").runner(fake.run)
  );
  assertEquals(id, "123456789012");
  assertEquals(fake.calls[0], [
    "aws",
    "sts",
    "get-caller-identity",
    "--profile",
    "deploy",
    "--output",
    "text",
    "--query",
    "Account",
  ]);
});

Deno.test("accountId reports an empty answer by name", async () => {
  const fake = new FakeAws("\n");
  await assertRejects(
    () => AwsTasks.accountId((s) => s.runner(fake.run)),
    AwsOutputError,
    "AwsTasks.accountId: the AWS CLI printed nothing",
  );
});

Deno.test("ecrLoginPassword reads the password", async () => {
  const fake = new FakeAws("registry-password-value\n");
  assertEquals(
    await AwsTasks.ecrLoginPassword((s) =>
      s.region("eu-west-1").runner(fake.run)
    ),
    "registry-password-value",
  );
  assertEquals(fake.calls[0].slice(1, 3), ["ecr", "get-login-password"]);
});

Deno.test("lambdaPublishedVersion pins --query Version --output text", async () => {
  const fake = new FakeAws("7\n");
  assertEquals(
    await AwsTasks.lambdaPublishedVersion((s) =>
      s.functionName("api").runner(fake.run)
    ),
    "7",
  );
  assertEquals(fake.flag(0, "--query"), "Version");
  assertEquals(fake.flag(0, "--output"), "text");
});

Deno.test("secretString reads a multi-line secret exactly", async () => {
  const pem = "-----BEGIN KEY-----\nabc\n-----END KEY-----\n";
  const fake = new FakeAws(json(pem));
  assertEquals(
    await AwsTasks.secretString((s) => s.secretId("prod/key").runner(fake.run)),
    pem,
  );
  assertEquals(fake.flag(0, "--query"), "SecretString");
  assertEquals(fake.flag(0, "--output"), "json");
});

Deno.test("secretString refuses a binary secret", async () => {
  const fake = new FakeAws("null\n");
  await assertRejects(
    () => AwsTasks.secretString((s) => s.secretId("bin").runner(fake.run)),
    AwsOutputError,
    "SecretBinary",
  );
});

Deno.test("parameterValue pins --query Parameter.Value", async () => {
  const fake = new FakeAws(json("postgres://db"));
  assertEquals(
    await AwsTasks.parameterValue((s) =>
      s.name("/api/db").withDecryption().runner(fake.run)
    ),
    "postgres://db",
  );
  assertEquals(fake.flag(0, "--query"), "Parameter.Value");
  const missing = new FakeAws("null\n");
  await assertRejects(
    () => AwsTasks.parameterValue((s) => s.name("/a").runner(missing.run)),
    AwsOutputError,
    "Parameter.Value",
  );
});

Deno.test("stackOutput projects one output by key", async () => {
  const fake = new FakeAws(json(["https://api.example"]));
  assertEquals(
    await AwsTasks.stackOutput(
      "api",
      "ServiceUrl",
      (s) => s.region("eu-west-1").runner(fake.run),
    ),
    "https://api.example",
  );
  assertEquals(fake.flag(0, "--stack-name"), "api");
  assertEquals(
    fake.flag(0, "--query"),
    "Stacks[0].Outputs[?OutputKey=='ServiceUrl'].OutputValue",
  );
  assertEquals(fake.flag(0, "--output"), "json");
});

Deno.test("stackOutput fails on a missing output, a bad shape, a bad key", async () => {
  await assertRejects(
    () =>
      AwsTasks.stackOutput(
        "api",
        "Nope",
        (s) => s.runner(new FakeAws("[]").run),
      ),
    AwsOutputError,
    'stack "api" has no output "Nope"',
  );
  await assertRejects(
    () =>
      AwsTasks.stackOutput(
        "api",
        "Url",
        (s) => s.runner(new FakeAws("{}").run),
      ),
    AwsOutputError,
    "not a list",
  );
  await assertRejects(
    () => AwsTasks.stackOutput("api", "x']|[0", (s) => s),
    Error,
    "alphanumeric",
  );
});

/** Recording variants: what each credential-bearing command registers. */
class RecordingAssumeRole extends AwsStsAssumeRoleSettings {
  readonly marked: string[] = [];
  protected override markSecret(value: string): void {
    this.marked.push(value);
  }
}
class RecordingLogin extends AwsEcrGetLoginPasswordSettings {
  readonly marked: string[] = [];
  protected override markSecret(value: string): void {
    this.marked.push(value);
  }
}
class RecordingSecret extends AwsSecretsmanagerGetSecretValueSettings {
  readonly marked: string[] = [];
  protected override markSecret(value: string): void {
    this.marked.push(value);
  }
}
class RecordingParameter extends AwsSsmGetParameterSettings {
  readonly marked: string[] = [];
  protected override markSecret(value: string): void {
    this.marked.push(value);
  }
}

Deno.test("credential-bearing commands register what they return", async () => {
  const assume = new RecordingAssumeRole().roleArn("r").roleSessionName("n")
    .runner(
      new FakeAws(json({
        Credentials: {
          AccessKeyId: "ASIA",
          SecretAccessKey: "secret-key-value",
          SessionToken: "session-token-value",
        },
      })).run,
    );
  await assume.run();
  assertEquals(assume.marked, ["secret-key-value", "session-token-value"]);

  const login = new RecordingLogin().runner(new FakeAws("pw-value\n").run);
  await login.run();
  assertEquals(login.marked, ["pw-value"]);

  const secret = new RecordingSecret().secretId("s").runner(
    new FakeAws(json({ Name: "s", SecretString: "the-secret" })).run,
  );
  await secret.run();
  assertEquals(secret.marked, ["the-secret"]);

  const parameter = new RecordingParameter().name("/a").runner(
    new FakeAws(json({ Parameter: { Name: "/a", Value: "the-value" } })).run,
  );
  await parameter.run();
  assertEquals(parameter.marked, ["the-value"]);
});

Deno.test("a reader's failed command surfaces as a CommandError", async () => {
  const fake = new FakeAws(
    new CommandOutput(254, "", "An error occurred (ResourceNotFoundException)"),
  );
  const error = await assertRejects(
    () => AwsTasks.secretString((s) => s.secretId("gone").runner(fake.run)),
  );
  assertStringIncludes(error.message, "ResourceNotFoundException");
});

Deno.test("readers run without a lambda", async () => {
  await withEmptyPath(async () => {
    // These need no operand, so they reach the spawn and find no binary.
    const spawning: Array<() => Promise<unknown>> = [
      () => AwsTasks.accountId(),
      () => AwsTasks.ecrLoginPassword(),
      () => AwsTasks.stackOutput("api", "Url"),
      () => AwsTasks.alarmState("api-5xx"),
      () =>
        AwsTasks.logsInsightsQuery((q) =>
          q.logGroupNames("g").queryString("q").window("5m")
        ),
    ];
    for (const read of spawning) await assertRejects(read, ToolNotFoundError);
    // These demand an operand, and say so before anything is spawned.
    await assertRejects(() => AwsTasks.secretString(), Error, "secretId");
    await assertRejects(() => AwsTasks.parameterValue(), Error, "name");
    await assertRejects(
      () => AwsTasks.lambdaPublishedVersion(),
      Error,
      "functionName",
    );
  });
});

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for finding the secrets in a credential-bearing command's output
 * — the rules behind `ToolSettings.markSecretsInOutput` — including the
 * regression cases from the `@zuke/aws` and `@zuke/az` reviews whose two copies
 * this one implementation replaces. The findings of its own review are pinned
 * in `secret_output_review_test.ts`. Every value is a low-entropy fake.
 *
 * @module
 */

import { assertEquals } from "./_assert.ts";
import { keepNumberSource, secretsInOutput } from "../src/secret_output.ts";
import { SecretOutputSettings } from "../src/tooling.ts";

/** The secrets found in `stdout`, described by `configure`. */
function found(
  stdout: string,
  configure: (s: SecretOutputSettings) => SecretOutputSettings = (s) => s,
): string[] {
  return secretsInOutput(stdout, configure(new SecretOutputSettings()));
}

/** Assert each of `secrets` was found in `actual`. */
function assertFound(actual: string[], ...secrets: string[]): void {
  for (const secret of secrets) {
    assertEquals(actual.includes(secret), true, `${secret} not in ${actual}`);
  }
}

/** Assert none of `values` was found in `actual`. */
function assertNotFound(actual: string[], ...values: string[]): void {
  for (const value of values) {
    assertEquals(actual.includes(value), false, `${value} in ${actual}`);
  }
}

/** JSON text, as a CLI prints it. */
function json(value: unknown): string {
  return `${JSON.stringify(value, null, 4)}\n`;
}

Deno.test("settings accumulate keys and record the query", () => {
  const settings = new SecretOutputSettings().keys("a").keys("b", "c")
    .queried(true);
  assertEquals(settings.keys_, ["a", "b", "c"]);
  assertEquals(settings.queried_, true);
  assertEquals(new SecretOutputSettings().queried_, false);
});

Deno.test("only the value under an expected key is registered when it is present", () => {
  const secrets = found(
    json({ Name: "prod/db", SecretString: "pin1", VersionId: "aaaa-bbbb-1" }),
    (s) => s.keys("SecretString"),
  );
  assertEquals(secrets, ["pin1"]);
});

Deno.test("expected keys are found at any depth", () => {
  const secrets = found(
    json({ Parameter: { Name: "/pin", Value: "aaaaaaaaa", Version: 3 } }),
    (s) => s.keys("Value"),
  );
  assertEquals(secrets, ["aaaaaaaaa"]);
});

Deno.test("SecretBinary-style keys: every expected key is registered", () => {
  const secrets = found(
    json({ Name: "s", SecretBinary: "gICAgICAgIA=" }),
    (s) => s.keys("SecretString", "SecretBinary"),
  );
  // Binary that decodes to no printable text has nothing more to register.
  assertEquals(secrets, ["gICAgICAgIA="]);
});

Deno.test("a text-output JSON secret is the secret, and its fields are too", () => {
  const inner = JSON.stringify({ username: "app", password: "aaaaaaaaaaa" });
  const secrets = found(
    `${JSON.stringify(inner)}\n`,
    (s) => s.keys("SecretString").queried(true),
  );
  assertFound(secrets, inner, "aaaaaaaaaaa");
  assertNotFound(secrets, "app");
});

Deno.test("a JSON string answer is the secret whatever its length", () => {
  assertEquals(found(json("pin1")), ["pin1"]);
});

Deno.test("a numeric parameter is registered as written", () => {
  assertEquals(found("48213977\n", (s) => s.keys("Value")), ["48213977"]);
  assertEquals(found("12\n", (s) => s.keys("Value")), ["12"]);
});

Deno.test("a reshaped assume-role query registers every scalar it moved", () => {
  // Neither expected key survives the query, so every leaf may be a secret —
  // the duration too, as a keyed value of three or more characters.
  const secrets = found(
    json(["aaaaaaaaaaaa", "bbbbbbbbbbbb", 3600, 12]),
    (s) => s.keys("SecretAccessKey", "SessionToken").queried(true),
  );
  assertFound(secrets, "aaaaaaaaaaaa", "bbbbbbbbbbbb", "3600");
  assertNotFound(secrets, "12");
});

Deno.test("a query that moves the secret to another key still masks it", () => {
  // `{accessToken: tokenType, moved: accessToken}`: the expected key now holds
  // `Bearer`, which is registered too — a short queried PIN must be.
  const secrets = found(
    json({ accessToken: "Bearer", moved: "aaaaaaaaaaaaaaa" }),
    (s) => s.keys("accessToken").queried(true),
  );
  assertFound(secrets, "aaaaaaaaaaaaaaa", "Bearer");
});

Deno.test("short derived values are not registered", () => {
  // The expected key is present, so the other leaves are only derived.
  const secrets = found(
    json({ x: "xxxxxxxx", other: [true, 12, "Bearer", "aaaaaaaaaa"] }),
    (s) => s.keys("x").queried(true),
  );
  assertFound(secrets, "xxxxxxxx", "aaaaaaaaaa");
  assertNotFound(secrets, "true", "12", "Bearer");
  assertNotFound(
    found(json({ password: "ab", token: true, x: "y", n: 1 })),
    "ab",
    "true",
    "1",
  );
});

Deno.test("a long number found as a leaf is registered; a boolean is not", () => {
  const secrets = found(
    json([1791633600, true]),
    (s) => s.keys("accessToken").queried(true),
  );
  assertFound(secrets, "1791633600");
  assertNotFound(secrets, "true");
});

Deno.test("with no expected key present, every long scalar is registered", () => {
  const secrets = found(
    json({ moved: "aaaaaaaaaa", count: 123456789, flag: false, note: "ok" }),
    (s) => s.keys("SecretString"),
  );
  assertFound(secrets, "123456789", "aaaaaaaaaa");
  assertNotFound(secrets, "false", "ok");
});

Deno.test("a number under an expected key is the key's secret", () => {
  assertEquals(found(json({ Value: 1234 }), (s) => s.keys("Value")), ["1234"]);
});

Deno.test("credential-named fields are registered across the whole document", () => {
  const secrets = found(
    json({
      accessToken: "aaaaaaaaaaaa",
      expiresOn: "2026-10-08 12:00:00.000000",
      tenant: "aaaa-tenant-id",
      nested: { clientSecret: "bbbbbbbbbbbb" },
      list: [{ password: "cccccccccccc" }],
    }),
    (s) => s.keys("accessToken"),
  );
  assertEquals(secrets.sort(), [
    "aaaaaaaaaaaa",
    "bbbbbbbbbbbb",
    "cccccccccccc",
  ]);
});

Deno.test("credential fields and long leaves of a JSON secret are registered", () => {
  const secret = JSON.stringify({
    db: { password: "aaaaaaaaaaaaaaa" },
    apiKey: "abc",
    clientSecret: "bbbbbbbbbbbbbbbbbbb",
    host: "db",
    list: [{ token: "ddddddddddddddd" }],
  });
  const secrets = found(
    json({ SecretString: secret }),
    (s) => s.keys("SecretString"),
  );
  assertFound(
    secrets,
    secret,
    "aaaaaaaaaaaaaaa",
    "abc",
    "bbbbbbbbbbbbbbbbbbb",
    "ddddddddddddddd",
  );
  assertNotFound(secrets, "db");
});

Deno.test("a JSON secret's number leaves are registered as written when long", () => {
  const secret = '{"port": 5432, "account": 12345678901234567891}';
  const secrets = found(json({ value: secret }), (s) => s.keys("value"));
  assertFound(secrets, secret, "12345678901234567891");
  assertNotFound(secrets, "5432");
});

Deno.test("a secret that is a JSON list has the credential fields of its items", () => {
  const secret = JSON.stringify([
    { db: { password: "aaaaaaaaaaaaaaa" } },
    { note: "short" },
  ]);
  const secrets = found(json({ value: secret }), (s) => s.keys("value"));
  assertFound(secrets, secret, "aaaaaaaaaaaaaaa");
  assertNotFound(secrets, "short");
});

Deno.test("Azure's credential field names are registered", () => {
  const fields = {
    db_pwd: "pwd",
    accountKey: "bbbbbbbbbbbbbbb",
    sas: "ccc",
    connectionString: "Endpoint=sb://x;Key=y",
    connection_string: "Server=x;Password=y",
    privateKeyPem: "-----BEGIN KEY-----",
    SharedAccessKey: "ddd",
    keyId: "kid",
    hostname: "db",
  };
  // The expected key is present, so only the names decide.
  const document = json({ ...fields, value: "vvvvvvvv" });
  const secrets = found(document, (s) => s.keys("value"));
  for (const [name, value] of Object.entries(fields)) {
    const secret = name !== "keyId" && name !== "hostname";
    assertEquals(secrets.includes(value), secret, name);
  }
});

Deno.test("a credential-named number or list of scalars is registered", () => {
  const secrets = found(
    json({
      password: 123456789,
      tokens: ["aaaaaaaaaa", "bbbbbbbbbb", "ok"],
      credentials: { user: "app-user-name", secret: "cccccccccc" },
    }),
    (s) => s.keys("unused"),
  );
  assertFound(secrets, "123456789", "aaaaaaaaaa", "bbbbbbbbbb", "cccccccccc");
  assertNotFound(secrets, "ok");
});

Deno.test("output that is not JSON is registered whole, trimmed", () => {
  assertEquals(found("aaaaaaaaaaaaaaaa\n"), ["aaaaaaaaaaaaaaaa"]);
  // It is the secret itself, so even a short one is registered.
  assertEquals(found("  pin1 \n"), ["pin1"]);
});

Deno.test("empty output, or an empty answer, registers nothing", () => {
  for (const stdout of ["", "  \n", '""\n', "null\n", "{}\n", "[]\n"]) {
    assertEquals(found(stdout, (s) => s.keys("value")), [], stdout);
  }
});

Deno.test("a blank value is never registered, even under an expected key", () => {
  // Registering " " would replace every space in the build's output.
  assertEquals(found(json({ value: " " }), (s) => s.keys("value")), []);
  assertEquals(found(json("\t \n")), []);
});

Deno.test("a connection string's credential pairs are registered on their own", () => {
  const connection = "DefaultEndpointsProtocol=https;AccountName=acct-name;" +
    "AccountKey=aaaaaaaaaaaaaa==;EndpointSuffix=core.windows.net";
  const secrets = found(
    json({ connectionString: connection }),
    (s) => s.keys("connectionString"),
  );
  assertFound(secrets, connection, "aaaaaaaaaaaaaa==");
  assertNotFound(secrets, "acct-name", "core.windows.net", "https");
  const sql = "Server=tcp:db.example,1433;User ID=app;Password=bbbbbbbbbb;";
  assertFound(
    found(json({ value: sql }), (s) => s.keys("value")),
    "bbbbbbbbbb",
  );
});

Deno.test("a dotenv or YAML secret's credential lines are registered", () => {
  const dotenv = [
    "DB_HOST=db.example.internal",
    "DB_PASSWORD=aaaaaaaaaa",
    "export API_TOKEN='bbbbbbbbbb'",
    'SIGNING_KEY="cccc cccc cc"',
    "# a comment",
  ].join("\n");
  const secrets = found(
    json({ SecretString: dotenv }),
    (s) => s.keys("SecretString"),
  );
  assertFound(secrets, dotenv, "aaaaaaaaaa", "bbbbbbbbbb", "cccc cccc cc");
  assertNotFound(secrets, "db.example.internal", "'bbbbbbbbbb'");
  const yaml = "user: app\npassword: dddddddddd\n";
  assertFound(found(yaml), "dddddddddd");
});

Deno.test("a URL's password is registered on its own, raw and decoded", () => {
  const url = "postgres://app:aaaaaaaa%40b@db.example:5432/app";
  const secrets = found(
    json({ SecretString: url }),
    (s) => s.keys("SecretString"),
  );
  assertFound(secrets, url, "aaaaaaaa%40b", "aaaaaaaa@b");
  // A two-character password is not: the URL as a whole still is.
  const short = found(json("redis://:pw@cache:6379"));
  assertFound(short, "redis://:pw@cache:6379");
  assertNotFound(short, "pw");
});

Deno.test("a URL inside a connection string or a JSON secret has its password found", () => {
  const secrets = found(
    json({
      value: JSON.stringify({ dsn: "mysql://app:bbbbbbbbbb@db/app" }),
    }),
    (s) => s.keys("value"),
  );
  assertFound(secrets, "bbbbbbbbbb");
  const pairs = found("Url=https://app:cccccccccc@host/x;Mode=rw");
  assertFound(pairs, "cccccccccc");
});

Deno.test("a JSON-encoded secret registers the string it decodes to", () => {
  const inner = JSON.stringify("aaaaaaaaaaaa");
  const secrets = found(json({ value: inner }), (s) => s.keys("value"));
  assertFound(secrets, inner, "aaaaaaaaaaaa");
});

Deno.test("a secret that nests without end is searched to a bounded depth", () => {
  // Each `db_pwd=` layer is a credential pair holding the rest; the search
  // stops after a few layers instead of walking the whole string pair by pair.
  const nested = `${"db_pwd=".repeat(50)}aaaaaaaaaa`;
  const secrets = found(nested);
  assertEquals(secrets.length, 5);
  assertEquals(secrets[0], nested);
  // And a large one finishes in linear time, not quadratic.
  const huge = `${"db_pwd=".repeat(150_000)}aaaaaaaaaa`;
  const start = performance.now();
  assertEquals(found(huge).length, 5);
  assertEquals(performance.now() - start < 5_000, true);
});

Deno.test("a deeply nested document neither overflows the stack nor throws", () => {
  const depth = 200_000;
  const deep = `${"[".repeat(depth)}"aaaaaaaaaa"${"]".repeat(depth)}`;
  assertFound(found(deep), "aaaaaaaaaa");
  // Too deep for the number-keeping parse: numbers fall back to their value.
  const numbers = `${"[".repeat(depth)}[123456789, 2]${"]".repeat(depth)}`;
  assertFound(found(numbers), "123456789");
  const objects = `${'{"a":'.repeat(depth)}{"password":"bbbbbbbbbb"}${
    "}".repeat(depth)
  }`;
  assertFound(found(objects, (s) => s.keys("x")), "bbbbbbbbbb");
});

Deno.test("a number's spelling falls back to its value without source access", () => {
  // Engines without JSON source text access pass the reviver no context.
  const kept = keepNumberSource("n", 1e21);
  assertEquals(
    typeof kept === "object" && kept !== null && "source" in kept
      ? kept.source
      : undefined,
    "1e+21",
  );
  assertEquals(keepNumberSource("s", "text"), "text");
});

Deno.test("a base64 credential that decodes to control characters is left encoded", () => {
  const encoded = btoa("aaaa\u0001bbbb");
  const secrets = found(json({ password: encoded }), (s) => s.keys("x"));
  assertFound(secrets, encoded);
  assertNotFound(secrets, "aaaa\u0001bbbb");
});

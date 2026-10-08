// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Regression tests for the adversarial review of `markSecretsInOutput`: each
 * test is named after the finding it pins (H1, M4, L2, …) and failed before
 * the fix. Every value is a low-entropy fake.
 *
 * @module
 */

import { assertEquals } from "./_assert.ts";
import { secretsInOutput } from "../src/secret_output.ts";
import { SecretOutputSettings } from "../src/tooling.ts";
import { maskPatterns, Redactor } from "../src/redact.ts";
import { withAmbientRedactor } from "../src/ambient_redactor.ts";
import { isCredentialName } from "../src/credential_name.ts";

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

/** Whether `fn` finishes within `ms` milliseconds. */
function within(ms: number, fn: () => unknown): boolean {
  const start = performance.now();
  fn();
  return performance.now() - start < ms;
}

Deno.test("H1: a JSON object printed as text is registered whole", () => {
  // `--query SecretString --output text` prints the secret's own JSON.
  const text = '{"username":"admin","password":"hunter2"}';
  const queried = found(
    `${text}\n`,
    (s) => s.keys("SecretString").queried(true),
  );
  assertFound(queried, text, "hunter2");
  // With no expected key present, the same holds without a query.
  assertFound(found(text, (s) => s.keys("SecretString")), text, "hunter2");
});

Deno.test("H1: a document whose expected key matched is not registered whole", () => {
  const text = '{"Name":"prod/db","SecretString":"aaaaaaaaaa"}';
  assertNotFound(found(text, (s) => s.keys("SecretString")), text);
});

Deno.test("H2: a number, boolean or long numeric answer is registered as written", () => {
  assertEquals(found("123456\n"), ["123456"]);
  const long = "12345678901234567891";
  const secrets = found(`${long}\n`);
  assertFound(secrets, long);
  assertNotFound(secrets, "12345678901234567000");
  assertEquals(found("1e10\n"), ["1e10"]);
  assertEquals(found("true\n"), ["true"]);
  assertEquals(found("null\n"), []);
});

Deno.test("H2: a number leaf is registered in its source spelling", () => {
  const long = "12345678901234567891";
  const keyed = found(`{"Value": ${long}}`, (s) => s.keys("Value"));
  assertFound(keyed, long);
  assertNotFound(keyed, "12345678901234567000");
  assertFound(
    found('{"password": 1e10, "x": "y"}', (s) => s.keys("x")),
    "1e10",
  );
});

Deno.test("M1: a short credential or keyed value is registered from 3 characters", () => {
  assertFound(
    found(
      '{"username":"admin","password":"hunter2"}',
      (s) => s.keys("SecretString"),
    ),
    "hunter2",
  );
  // A short PIN under an expected key is masked even after a query.
  assertFound(
    found(
      '{"Value":"1234","Name":"pin"}',
      (s) => s.keys("Value").queried(true),
    ),
    "1234",
  );
  assertEquals(found('{"Value":"on"}', (s) => s.keys("Value")), []);
  for (
    const word of [
      "true",
      "false",
      "null",
      "none",
      "enabled",
      "disabled",
      "default",
    ]
  ) {
    assertEquals(
      found(`{"Value":"${word}","password":"${word}"}`, (s) => s.keys("Value")),
      [],
      word,
    );
  }
});

Deno.test("M1: a one-element array or a lone string leaf is the answer", () => {
  assertFound(found('["ab"]', (s) => s.keys("Value").queried(true)), "ab");
  assertFound(found("[12]", (s) => s.keys("Value")), "12");
  assertFound(
    found('{"t":"abc","n":5}', (s) => s.keys("Value").queried(true)),
    "abc",
  );
});

Deno.test("M1b: short array elements under an expected key are not registered", () => {
  const secrets = found('{"value":["1","ab","abcd"]}', (s) => s.keys("value"));
  assertFound(secrets, "abcd");
  assertNotFound(secrets, "1", "ab");
});

Deno.test("M2: every long leaf of a secret that is itself JSON is registered", () => {
  const secret = JSON.stringify({ value: "aaaaaaaaaa", note: "x", pin: "123" });
  const secrets = found(
    JSON.stringify({ value: secret }),
    (s) => s.keys("value"),
  );
  assertFound(secrets, secret, "aaaaaaaaaa", "123");
  assertNotFound(secrets, "x");
});

Deno.test("M3: a value JSON escapes is registered in its escaped spellings", () => {
  const value = 'p"a\\ss/<&>aa';
  const secrets = found(JSON.stringify({ value }), (s) => s.keys("value"));
  const escaped = JSON.stringify(value).slice(1, -1);
  assertFound(
    secrets,
    value,
    escaped,
    escaped.replaceAll("/", "\\/"),
    escaped.replaceAll("<", "\\u003c").replaceAll(">", "\\u003e")
      .replaceAll("&", "\\u0026"),
  );
});

Deno.test("M4: pair values lose their JSON punctuation", () => {
  const pretty = [
    "{",
    '  "aws_secret_access_key": "aaaaaaaaaaaa",',
    '  "region": "eu-west-1"',
    "}",
    "Done.",
  ].join("\n");
  const secrets = found(pretty);
  assertFound(secrets, "aaaaaaaaaaaa");
  assertNotFound(secrets, '"aaaaaaaaaaaa",');
  const ndjson = '{"token":"bbbbbbbbbb"}\n{"token":"cccccccccc"}';
  const lines = found(ndjson);
  assertFound(lines, "bbbbbbbbbb", "cccccccccc");
  assertNotFound(lines, '"bbbbbbbbbb"}');
});

Deno.test("M4: a quoted value keeps its separators, and names are unquoted", () => {
  assertFound(found('Server=db;Password="word;other";Mode=rw'), "word;other");
  assertFound(found("'password': 'aaaaaaaa'"), "aaaaaaaa");
});

Deno.test("M4: query-string and XML attribute pairs are found", () => {
  assertFound(
    found("jdbc:mysql://db/app?user=app&password=aaaaaaaa"),
    "aaaaaaaa",
  );
  assertFound(found("sv=2020-01-01&sr=b&sig=bbbbbbbbbb"), "bbbbbbbbbb");
  const xml =
    '<publishProfile profileName="app" userName="$app" userPWD="cccccccccc" />';
  const secrets = found(xml);
  assertFound(secrets, "cccccccccc");
  assertNotFound(secrets, "$app");
});

Deno.test("M5: credential names gained and lost", () => {
  for (
    const name of [
      "auth",
      "Authorization",
      "client-key-data",
      "keyMaterial",
      "SecretString",
      "SecretBinary",
      "PasswordData",
      "pin",
      "otp",
      "jwt",
      "client_assertion",
      "cookie",
      "primaryKey",
      "secondaryKey",
      "primaryMasterKey",
      "clientKey",
      "signingKey",
      "subscriptionKey",
      "user_pwd",
      "db_pwd",
      "sig",
    ]
  ) {
    assertEquals(isCredentialName(name), true, name);
  }
  for (
    const name of [
      "key",
      "pwd",
      "PWD",
      "publicKey",
      "ssh_public_key",
      "partitionKey",
      "sortKey",
      "rowKey",
      "hashKey",
      "rangeKey",
      "objectKey",
      "keyName",
      "keyType",
    ]
  ) {
    assertEquals(isCredentialName(name), false, name);
  }
});

Deno.test("M6: derived leaves skip non-secret vocabulary", () => {
  const secrets = found(
    JSON.stringify({
      region: "eu-west-1-zone",
      Location: "westeurope-zone",
      type: "Microsoft.KeyVault",
      Arn: "arn:aws:iam::000000000000:role/app",
      Id: "aaaa-bbbb-cccc",
      roleId: "dddd-eeee-ffff",
      CreatedDate: "2026-10-08T00:00:00Z",
      LastModifiedTime: "2026-10-08T00:00:00Z",
      updated_at: "2026-10-08T00:00:00Z",
      VersionStages: ["AWSCURRENT"],
      status: "Succeeded-ok",
      state: "Provisioned",
      error: { message: "something went wrong" },
      moved: "gggggggggggg",
      // The key is still present, so the other leaves are only derived.
      SecretString: "ssssssssss",
    }),
    (s) => s.keys("SecretString").queried(true),
  );
  assertFound(secrets, "gggggggggggg");
  assertNotFound(
    secrets,
    "eu-west-1-zone",
    "westeurope-zone",
    "Microsoft.KeyVault",
    "arn:aws:iam::000000000000:role/app",
    "aaaa-bbbb-cccc",
    "dddd-eeee-ffff",
    "2026-10-08T00:00:00Z",
    "AWSCURRENT",
    "Succeeded-ok",
    "Provisioned",
    "something went wrong",
  );
});

Deno.test("M7: a padded secret is registered trimmed too", () => {
  assertFound(
    found('{"SecretString":"hunter2\\n"}', (s) => s.keys("SecretString")),
    "hunter2\n",
    "hunter2",
  );
});

Deno.test("M8: a long name is no credential and costs linear time", () => {
  const name = `${"A".repeat(100_000)}aPassword`;
  let matched = true;
  assertEquals(within(1_000, () => (matched = isCredentialName(name))), true);
  assertEquals(matched, false);
  // An acronym run with nothing after it was quadratic to segment.
  assertEquals(
    within(500, () => isCredentialName(`${"A".repeat(50_000)}!`)),
    true,
  );
});

Deno.test("M8: registering many patterns is not quadratic", () => {
  const lines = Array.from({ length: 50_000 }, (_, i) => `line-${i}-aaaaaaa`);
  assertEquals(
    within(
      2_000,
      () => assertEquals(maskPatterns(lines.join("\n")).length, 50_001),
    ),
    true,
  );
  const redactor = new Redactor();
  assertEquals(
    within(2_000, () => lines.forEach((l) => redactor.add(l))),
    true,
  );
  assertEquals(redactor.redact("x line-7-aaaaaaa y"), "x [redacted] y");
});

Deno.test("M8: a large output registers in bounded time and count", async () => {
  const leaves = Array.from({ length: 40_000 }, (_, i) => `leaf-${i}-aaaaaaa`);
  // The key is present, so the 40000 other leaves are derived and capped.
  const stdout = JSON.stringify({ SecretString: "ssssssssss", items: leaves });
  const settings = new SecretOutputSettings().keys("SecretString").queried(
    true,
  );
  let secrets: string[] = [];
  assertEquals(
    within(2_000, () => (secrets = secretsInOutput(stdout, settings))),
    true,
  );
  // At most 2000 derived leaves, plus the secret and the whole output in its
  // spellings.
  assertEquals(secrets.length <= 2_010, true, String(secrets.length));
  assertEquals(secrets.length >= 2_000, true, String(secrets.length));
  const redactor = new Redactor();
  const start = performance.now();
  await withAmbientRedactor(redactor, () => {
    for (const secret of secrets) redactor.add(secret);
    return Promise.resolve();
  });
  assertEquals(performance.now() - start < 2_000, true);
});

Deno.test("M8: a large moved output registers in bounded time", async () => {
  // With no expected key every leaf is keyed and uncapped, so this is the
  // worst case for registration: still linear.
  const leaves = Array.from({ length: 40_000 }, (_, i) => `leaf-${i}-aaaaaaa`);
  const stdout = JSON.stringify({ items: leaves });
  const settings = new SecretOutputSettings().keys("SecretString");
  const redactor = new Redactor();
  const start = performance.now();
  await withAmbientRedactor(redactor, () => {
    for (const secret of secretsInOutput(stdout, settings)) {
      redactor.add(secret);
    }
    return Promise.resolve();
  });
  assertEquals(performance.now() - start < 4_000, true);
  assertEquals(redactor.redact("leaf-39999-aaaaaaa"), "[redacted]");
});

Deno.test("L1: a base64 credential is registered decoded, with its password", () => {
  const auth = btoa("app:aaaaaaaa");
  const secrets = found(
    JSON.stringify({ auths: { "registry.example": { auth } } }),
    (s) => s.keys("value"),
  );
  assertFound(secrets, auth, "app:aaaaaaaa", "aaaaaaaa");
  // Not every credential is base64: a plain word is left as it is.
  assertNotFound(found('{"token":"abcd"}', (s) => s.keys("x")), "i·");
});

Deno.test("L2: a URL password hidden by # or ? is still found", () => {
  assertFound(found("postgres://u:1234#abcd@host/db"), "1234#abcd");
  assertFound(found("mysql://u:12345?ab@host/db"), "12345?ab");
});

Deno.test("L2: a JSON-escaped URL in a secret has its password found", () => {
  const secret = '{"dsn":"mysql:\\/\\/app:aaaaaaaaaa@db\\/app"}';
  assertFound(
    found(JSON.stringify({ value: secret }), (s) => s.keys("value")),
    "aaaaaaaaaa",
  );
});

Deno.test("M8: no pattern in the pair search is quadratic", () => {
  // A long word with no `=` after it, and a long run of JSON closers, were
  // each rescanned from every character — seconds at this size.
  for (
    const text of [
      "a".repeat(300_000),
      `password=${",".repeat(300_000)}x`,
      `password=x${"}".repeat(300_000)}`,
    ]
  ) {
    assertEquals(within(1_000, () => found(text)), true, text.slice(0, 12));
  }
  assertFound(found(`password=aaaaaaaa${"}".repeat(3)}`), "aaaaaaaa");
});

Deno.test("M8: a 50k-line output registers and redacts in bounded time", async () => {
  const stdout = Array.from(
    { length: 50_000 },
    (_, i) => `line ${i}: value-${i}-aaaaaaa`,
  ).join("\n");
  const redactor = new Redactor();
  const start = performance.now();
  await withAmbientRedactor(redactor, () => {
    for (const secret of found(stdout)) redactor.add(secret);
    return Promise.resolve();
  });
  assertEquals(redactor.redact("x line 7: value-7-aaaaaaa"), "x [redacted]");
  assertEquals(performance.now() - start < 2_000, true);
});

Deno.test("moved: a secret renamed onto ordinary vocabulary is still registered", () => {
  // `--query "{id:SecretString,Name:Name}"` and its kin: the expected key is
  // gone, so no field name says anything about what its value is.
  for (const key of ["id", "type", "status", "region", "CreatedDate"]) {
    const secrets = found(
      JSON.stringify({ [key]: "Sup3r-Value-9", Name: "name-x" }),
      (s) => s.keys("SecretString").queried(true),
    );
    assertFound(secrets, "Sup3r-Value-9", "name-x");
  }
  const inError = found(
    JSON.stringify({ error: { message: "Sup3r-Value-9" }, Name: "name-x" }),
    (s) => s.keys("SecretString").queried(true),
  );
  assertFound(inError, "Sup3r-Value-9");
});

Deno.test("moved: a short secret moved into a list is registered", () => {
  // `--query "[Name,SecretString]"`.
  const secrets = found(
    JSON.stringify(["name-x", "pin7"]),
    (s) => s.keys("SecretString").queried(true),
  );
  assertFound(secrets, "name-x", "pin7");
  // Words a setting takes are still not registered.
  assertNotFound(
    found(
      JSON.stringify(["name-x", "true", "on"]),
      (s) => s.keys("SecretString").queried(true),
    ),
    "true",
    "on",
  );
});

Deno.test("moved: a renamed JSON secret has its inner password found", () => {
  const inner = JSON.stringify({ username: "app", password: "hunter2" });
  const secrets = found(
    JSON.stringify({ id: inner, Name: "name-x" }),
    (s) => s.keys("SecretString").queried(true),
  );
  assertFound(secrets, inner, "hunter2");
});

Deno.test("moved: a renamed connection string has its password found", () => {
  const connection = "Server=db;User ID=app;Password=hunter2;";
  const secrets = found(
    JSON.stringify({ type: connection, Name: "name-x" }),
    (s) => s.keys("connectionString").queried(true),
  );
  assertFound(secrets, connection, "hunter2");
});

Deno.test("moved: output with none of the keys and no query is read the same way", () => {
  // No query, but none of the expected keys either: the wrapper's knowledge
  // of the shape is void, exactly as when a query moved the secret.
  const secrets = found(
    JSON.stringify({ id: "Sup3r-Value-9", note: "pin7" }),
    (s) => s.keys("SecretString"),
  );
  assertFound(secrets, "Sup3r-Value-9", "pin7");
});

Deno.test("moved: keyed leaves are not starved by the derived budget", () => {
  // Thousands of moved leaves, each a candidate; the 2000 cap on *derived*
  // values must not drop the ones past it.
  const leaves = Array.from({ length: 3_000 }, (_, i) => `leaf-${i}-aaaa`);
  const secrets = found(
    JSON.stringify({ items: leaves }),
    (s) => s.keys("SecretString").queried(true),
  );
  assertFound(secrets, "leaf-0-aaaa", "leaf-2999-aaaa");
});

Deno.test("kept: a queried output that still has its key skips vocabulary", () => {
  // The key is present, so the secret did not move: the other leaves are only
  // derived, and ordinary vocabulary and short values stay unregistered.
  const secrets = found(
    JSON.stringify({
      SecretString: "aaaaaaaaaa",
      region: "eu-west-1-zone",
      CreatedDate: "2026-10-08T00:00:00Z",
      Name: "pin7",
      moved: "gggggggggggg",
    }),
    (s) => s.keys("SecretString").queried(true),
  );
  assertFound(secrets, "aaaaaaaaaa", "gggggggggggg");
  assertNotFound(secrets, "eu-west-1-zone", "2026-10-08T00:00:00Z", "pin7");
});

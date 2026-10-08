// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: a credential-bearing tool's output stays masked through the real
 * CLI entry point. A wrapper whose `onOutput` calls
 * `ToolSettings.markSecretsInOutput` reads a secret — a real `deno`
 * subprocess prints it, so the full spawn → onOutput → redactor path runs —
 * and the build then fails with the secret, and a part of it, in its error and
 * in a later command line. Neither may reach the build's output.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import type { CommandOutput } from "../../packages/core/src/shell.ts";
import { ToolSettings } from "../../packages/core/src/tooling.ts";
import { withEnv } from "../../packages/core/tests/_env.ts";
import { runCli, withoutMaskDirectives } from "./_harness.ts";

/** The password inside the fake secret — low-entropy and obviously fake. */
const PASSWORD = "aaaaaaaa1";

/** The secret the fake tool prints: a database URL carrying the password. */
const SECRET = `postgres://app:${PASSWORD}@db.example/app`;

/**
 * A fake `get-secret-value`: a `deno eval` that prints the secret under
 * `SecretString`, as a secrets manager's CLI would, and registers what it
 * printed with the run's redactor.
 */
class GetSecretSettings extends ToolSettings {
  protected override defaultTool(): string {
    return Deno.execPath();
  }

  protected override buildArgs(): string[] {
    const answer = JSON.stringify({ Name: "prod/db", SecretString: SECRET });
    return ["eval", `console.log(${JSON.stringify(answer)})`];
  }

  protected override onOutput(output: CommandOutput): void {
    this.markSecretsInOutput(output.stdout, (s) => s.keys("SecretString"));
  }
}

/** The short password inside a secret printed as text — low-entropy. */
const SHORT_PASSWORD = "hunter2";

/**
 * A fake `get-secret-value --query SecretString --output text`: the secret's
 * own JSON, printed bare, with a password under eight characters in it.
 */
class GetSecretTextSettings extends ToolSettings {
  protected override defaultTool(): string {
    return Deno.execPath();
  }

  protected override buildArgs(): string[] {
    const secret = JSON.stringify({
      username: "app",
      password: SHORT_PASSWORD,
    });
    return ["eval", `console.log(${JSON.stringify(secret)})`];
  }

  protected override onOutput(output: CommandOutput): void {
    this.markSecretsInOutput(
      output.stdout,
      (s) => s.keys("SecretString").queried(true),
    );
  }
}

/** A command that fails with `secret` in its argv, as a careless build's would. */
class ConnectSettings extends ToolSettings {
  #secret = "";

  /** The value the command line carries. */
  secret(value: string): this {
    this.#secret = value;
    return this;
  }

  protected override defaultTool(): string {
    return Deno.execPath();
  }

  protected override buildArgs(): string[] {
    return ["eval", "Deno.exit(3)", this.#secret];
  }
}

/** Read the secret's `SecretString` through the fake tool. */
async function readSecret(): Promise<string> {
  const output = await new GetSecretSettings().quiet().run();
  const answer: unknown = JSON.parse(output.stdout);
  if (
    typeof answer !== "object" || answer === null ||
    !("SecretString" in answer) || typeof answer.SecretString !== "string"
  ) {
    throw new Error("the fake tool printed no SecretString");
  }
  return answer.SecretString;
}

class Leaky extends Build {
  leakWhole = target()
    .description("Read a secret, then fail with it in the message")
    .executes(async () => {
      const url = await readSecret();
      throw new Error(`could not connect to ${url}`);
    });

  leakPart = target()
    .description("Read a secret, then fail with only its password")
    .executes(async () => {
      const password = new URL(await readSecret()).password;
      throw new Error(`login refused for password ${password}`);
    });

  leakShort = target()
    .description("Read a secret printed as text, then fail with its password")
    .executes(async () => {
      const output = await new GetSecretTextSettings().quiet().run();
      const secret: unknown = JSON.parse(output.stdout);
      const password = typeof secret === "object" && secret !== null &&
          "password" in secret
        ? String(secret.password)
        : "";
      throw new Error(`login refused for password ${password}`);
    });

  leakArgv = target()
    .description("Read a secret, then pass its password to a failing command")
    .executes(async () => {
      const password = new URL(await readSecret()).password;
      await new ConnectSettings().secret(password).quiet().run();
    });
}

for (
  const [name, expected] of [
    ["leakWhole", "could not connect to"],
    ["leakPart", "login refused for password"],
    ["leakArgv", "Command failed (exit 3)"],
  ]
) {
  Deno.test(`a secret a tool printed is masked when ${name} prints it`, async () => {
    // Plain mode: no CI host, so nothing but the redactor stands between the
    // secret and the output.
    await withEnv({ CI: undefined, GITHUB_ACTIONS: undefined }, async () => {
      const { code, out, err } = await runCli(Leaky, [name]);
      assertEquals(code, 1);
      assertStringIncludes(out + err, expected);
      const body = withoutMaskDirectives(out + err);
      assertEquals(body.includes(PASSWORD), false, body);
      assertEquals(body.includes(SECRET), false, body);
    });
  });
}

Deno.test("a short password in a secret printed as text is masked", async () => {
  await withEnv({ CI: undefined, GITHUB_ACTIONS: undefined }, async () => {
    const { code, out, err } = await runCli(Leaky, ["leakShort"]);
    assertEquals(code, 1);
    assertStringIncludes(out + err, "login refused for password");
    const body = withoutMaskDirectives(out + err);
    assertEquals(body.includes(SHORT_PASSWORD), false, body);
  });
});

Deno.test("a secret a tool printed stays masked under GitHub Actions", async () => {
  await withEnv({ CI: "true", GITHUB_ACTIONS: "true" }, async () => {
    const { code, out, err } = await runCli(Leaky, ["leakPart"]);
    assertEquals(code, 1);
    assertStringIncludes(out + err, "login refused for password");
    assertEquals(withoutMaskDirectives(out + err).includes(PASSWORD), false);
  });
});

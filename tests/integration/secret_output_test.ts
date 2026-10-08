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

  leakArgv = target()
    .description("Read a secret, then pass its password to a failing command")
    .executes(async () => {
      const password = new URL(await readSecret()).password;
      await new ConnectSettings().secret(password).quiet().run();
    });
}

/** Run `fn` with the environment GitHub Actions gives a job, then restore it. */
async function underActions(fn: () => Promise<void>): Promise<void> {
  const previous = {
    CI: Deno.env.get("CI"),
    GITHUB_ACTIONS: Deno.env.get("GITHUB_ACTIONS"),
  };
  Deno.env.set("CI", "true");
  Deno.env.set("GITHUB_ACTIONS", "true");
  try {
    await fn();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
}

for (
  const [name, expected] of [
    ["leakWhole", "could not connect to"],
    ["leakPart", "login refused for password"],
    ["leakArgv", "Command failed (exit 3)"],
  ]
) {
  Deno.test(`a secret a tool printed is masked when ${name} prints it`, async () => {
    const { code, out, err } = await runCli(Leaky, [name]);
    assertEquals(code, 1);
    assertStringIncludes(out + err, expected);
    const body = withoutMaskDirectives(out + err);
    assertEquals(body.includes(PASSWORD), false, body);
    assertEquals(body.includes(SECRET), false, body);
  });
}

Deno.test("a secret a tool printed stays masked under GitHub Actions", async () => {
  await underActions(async () => {
    const { code, out, err } = await runCli(Leaky, ["leakPart"]);
    assertEquals(code, 1);
    assertStringIncludes(out + err, "login refused for password");
    assertEquals(withoutMaskDirectives(out + err).includes(PASSWORD), false);
  });
});

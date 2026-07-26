/**
 * Integration: a secret used as an argv token must not surface in a command
 * echo. Under `--dry-run` a `.dryRunnable()` target's body runs with `$` in echo
 * mode, so the resolved command line is printed — the one place a secret
 * parameter reaches Zuke's own output verbatim. Driven through the real CLI.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, parameter, REDACTED, target } from "../../packages/core/mod.ts";
import { $ } from "../../packages/core/src/shell.ts";
import { runCli } from "./_harness.ts";

const SECRET = "fake-not-a-real-token";

class Deploy extends Build {
  token = parameter("Registry token").secret().required();
  push = target()
    .description("log in with the token")
    .dryRunnable()
    .executes(async () => {
      await $`docker login --username ci --password ${this.token.value}`;
    });
}

Deno.test("a dry-run command echo masks a secret argv token", async () => {
  const { code, out } = await runCli(Deploy, [
    "push",
    "--dry-run",
    "--token",
    SECRET,
  ]);
  assertEquals(code, 0);
  // The echo is there…
  assertStringIncludes(out, "docker login --username ci --password");
  // …with the secret masked, and the raw value nowhere in the output.
  assertStringIncludes(out, REDACTED);
  assertEquals(out.includes(SECRET), false, `secret leaked:\n${out}`);
});

Deno.test("a failing command's error message masks a secret argv token", async () => {
  // The command line also reaches output through CommandError, reported when the
  // target fails — the same argv, a different sink.
  class Fail extends Build {
    token = parameter("Registry token").secret().required();
    run = target().executes(async () => {
      await $`${Deno.execPath()} eval ${`Deno.exit(4)`} ${this.token.value}`
        .quiet();
    });
  }
  const { code, err } = await runCli(Fail, ["run", "--token", SECRET]);
  assertEquals(code, 1);
  assertStringIncludes(err, REDACTED);
  assertEquals(err.includes(SECRET), false, `secret leaked:\n${err}`);
});

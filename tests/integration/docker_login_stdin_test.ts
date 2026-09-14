// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration coverage for `docker login --password-stdin`: the password
 * reaches a real child process on its standard input.
 *
 * The unit tests assert the argv the real `subcommandArgs()` builds. This
 * asserts the other half — that something is actually piped — because that is
 * the half that was missing. `passwordStdin()` used to append the flag and
 * write nothing, leaving docker reading a stream no one opened, so a test that
 * only checked the flag would have passed against the broken version.
 *
 * Hermetic per AGENTS.md guideline 5: the child is the running `deno`
 * (`Deno.execPath()`), which is always present and needs no shell. Only the
 * binary and the subcommand are swapped — `passwordStdin` and the
 * `stdinInput()` override under test are the real ones, inherited.
 *
 * @module
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { DockerLoginSettings } from "../../packages/docker/mod.ts";
import { runCli } from "./_harness.ts";

/** The password the build hands the wrapper. */
const TOKEN = "registry-value-that-must-not-escape";

/** A script that echoes whatever arrives on stdin, prefixed. */
const ECHO_STDIN =
  "const b = new Uint8Array(1024); const n = Deno.stdin.readSync(b) ?? 0; " +
  "console.log('got:' + new TextDecoder().decode(b.subarray(0, n)).trim())";

/**
 * `docker login`'s settings pointed at the running `deno` instead of docker.
 * Everything about the password — the setter, the stored value, the
 * `stdinInput()` hook core reads — is inherited unchanged.
 */
class EchoLogin extends DockerLoginSettings {
  protected override defaultTool(): string {
    return Deno.execPath();
  }
  protected override subcommandArgs(): string[] {
    return ["eval", ECHO_STDIN];
  }
}

Deno.test("the login password reaches the child on stdin, not its argv", async () => {
  let received = "";
  let argv: string[] = [];

  class Deploy extends Build {
    login = target()
      .description("authenticate to the registry")
      .executes(async () => {
        const settings = new EchoLogin().passwordStdin(TOKEN).quiet();
        argv = settings.argv();
        const out = await settings.run();
        received = out.stdout;
      });
  }

  const { code } = await runCli(Deploy, ["login"]);
  assertEquals(code, 0);

  // The child really read it: proof that something is piped, which is what
  // the flag on its own never guaranteed.
  assertEquals(received.includes(`got:${TOKEN}`), true);

  // And it was nowhere on the command line that carried it there.
  assertEquals(argv.some((a) => a.includes(TOKEN)), false);
});

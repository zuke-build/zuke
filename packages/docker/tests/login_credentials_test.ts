// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Where `docker login`'s password ends up.
 *
 * A child's argv is world-readable on a default Linux host — `ps`,
 * `/proc/<pid>/cmdline` — to every other user and every process the build
 * starts. `--password-stdin` exists so the password does not go there, and
 * these pin that it actually does not: the argv is asserted whole, so a
 * regression that passes the token positionally or glued to a flag fails here
 * rather than shipping.
 *
 * @module
 */

import { assertEquals } from "../../core/tests/_assert.ts";
import { DockerLoginSettings } from "../src/registry.ts";

/** The password these tests hand the wrapper. */
const TOKEN = "registry-value-that-must-not-escape";

/**
 * A settings class that records what it registers with the run's redactor, and
 * exposes the stdin the tool would receive.
 *
 * Both are protected — `markSecret`'s effect lands on an ambient redactor a
 * wrapper package cannot install, and `stdinInput` is core's hook — so the
 * observable thing here is what this class hands over. That the redactor then
 * masks, and that the command then pipes, are core's halves and core tests
 * them.
 */
class SpyLogin extends DockerLoginSettings {
  readonly marked: string[] = [];
  protected override markSecret(value: string): void {
    this.marked.push(value);
  }
  /** The stdin core would attach to the child. */
  peekStdin(): string | undefined {
    return this.stdinInput();
  }
}

Deno.test("passwordStdin keeps the token off the command line", () => {
  const settings = new SpyLogin().username("u").passwordStdin(TOKEN).registry(
    "ghcr.io",
  );
  const argv = settings.argv();

  assertEquals(argv, [
    "docker",
    "login",
    "-u",
    "u",
    "--password-stdin",
    "ghcr.io",
  ]);
  // Asserted over the whole argv, not just the flag: the failure being pinned
  // is the token reaching the process table by any spelling.
  assertEquals(argv.some((a) => a.includes(TOKEN)), false);
});

Deno.test("passwordStdin actually pipes the token to the child", () => {
  // The defect this replaces: the setter appended the flag and piped nothing,
  // so docker was left reading a stream no one ever wrote to.
  const settings = new SpyLogin().username("u").passwordStdin(TOKEN);
  assertEquals(settings.peekStdin(), TOKEN);
});

Deno.test("a login without passwordStdin leaves stdin alone", () => {
  // `undefined`, not an empty string: core only attaches stdin when there is
  // something to attach, and every other docker command must keep inheriting.
  assertEquals(new SpyLogin().username("u").peekStdin(), undefined);
  assertEquals(new SpyLogin().password("p").peekStdin(), undefined);
});

Deno.test("both password routes register the value with the redactor", () => {
  // The stdin route for the renderings, and `-p` because masking the rendering
  // is the only thing that can be done for a flag docker itself accepts.
  assertEquals(new SpyLogin().passwordStdin(TOKEN).marked, [TOKEN]);
  assertEquals(new SpyLogin().password(TOKEN).marked, [TOKEN]);
});

Deno.test("password still renders -p, because docker accepts it", () => {
  // Kept deliberately: the wrapper mirrors the real CLI. The JSDoc carries the
  // warning rather than the API silently dropping a flag docker supports.
  assertEquals(new SpyLogin().password(TOKEN).argv(), [
    "docker",
    "login",
    "-p",
    TOKEN,
  ]);
});

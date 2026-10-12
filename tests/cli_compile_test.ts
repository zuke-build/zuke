// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for compiling the CLI's standalone binaries: what each compile is
 * asked for, and the version check run on the binary built for this machine.
 *
 * The version check runs a real executable — the running `deno`, whose
 * `--version` first line is known — so it is exercised without a compile.
 *
 * @module
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../packages/core/tests/_assert.ts";
import { withTemp } from "../packages/core/tests/_temp.ts";
import { DenoCompileSettings } from "@zuke/deno";
import {
  assertReportsVersion,
  cliSpecifier,
  compileCliBinaries,
} from "../build/cli_compile.ts";
import { binaryPath } from "../build/cli_package.ts";
import { CLI_TARGETS } from "../build/cli_release.ts";

/** The first line `deno --version` prints. */
async function denoVersionLine(): Promise<string> {
  const { stdout } = await new Deno.Command(Deno.execPath(), {
    args: ["--version"],
  }).output();
  return new TextDecoder().decode(stdout).split("\n")[0];
}

Deno.test("the binaries are compiled from the published JSR release", () => {
  assertEquals(cliSpecifier("1.14.0"), "jsr:@zuke/cli@1.14.0");
});

Deno.test("compileCliBinaries compiles every target with -A into its own directory", async () => {
  await withTemp(async (dir) => {
    const compiles: string[][] = [];
    const host = CLI_TARGETS.find((t) => t.triple === Deno.build.target);
    const expected = host === undefined ? "1.14.0" : await denoVersionLine();
    await compileCliBinaries(expected, `${dir}/bin`, async (configure) => {
      const settings = configure(new DenoCompileSettings());
      compiles.push(settings.argv());
      // Stand in for the binary built for this machine with the running
      // deno, whose --version the check then reads.
      const target = settings.argv()[settings.argv().indexOf("--target") + 1];
      if (target === host?.triple) {
        await Deno.symlink(Deno.execPath(), binaryPath(`${dir}/bin`, target));
      }
    });
    assertEquals(compiles.length, CLI_TARGETS.length);
    for (const [i, argv] of compiles.entries()) {
      const target = CLI_TARGETS[i].triple;
      assertEquals(argv.includes("--allow-all"), true, argv.join(" "));
      assertEquals(argv[argv.indexOf("--target") + 1], target);
      assertEquals(
        argv[argv.indexOf("--output") + 1],
        binaryPath(`${dir}/bin`, target),
      );
      assertEquals(argv.at(-1), `jsr:@zuke/cli@${expected}`);
    }
  });
});

Deno.test("assertReportsVersion accepts exactly the version asked for", async () => {
  await assertReportsVersion(Deno.execPath(), await denoVersionLine());
  await assertRejects(
    () => assertReportsVersion(Deno.execPath(), "1.14.0"),
    Error,
    "did not resolve the release it was asked for",
  );
});

Deno.test("assertReportsVersion names the binary and what it reported", async () => {
  const error = await assertRejects(
    () => assertReportsVersion(Deno.execPath(), "9.9.9"),
    Error,
  );
  assertStringIncludes(error.message, Deno.execPath());
  assertStringIncludes(error.message, JSON.stringify(await denoVersionLine()));
});

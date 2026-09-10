// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * End-to-end: a Windows `node_modules` batch shim is spawned as itself, so a
 * caller operand carrying a `cmd.exe` metacharacter stays one argument.
 *
 * This is the one property an in-process test cannot establish. The wrapper
 * layer used to launch a resolved `.cmd`/`.bat` through `cmd /c`, which made
 * `cmd.exe` the direct child: `Deno.Command` then builds its command line with
 * C-runtime quoting, which quotes on spaces but leaves `&`, `|` and `^` bare,
 * and cmd.exe re-parses them. An operand like `A=1&whoami` — no space, so
 * nothing quotes it — therefore ran as a second command, in the build's own
 * context. Whether that happens is a fact about the real Windows process
 * boundary, so only a real Windows run can show it does not.
 *
 * The build under test resolves `zuke-shim` out of a planted
 * `node_modules/.bin`, so this exercises the same resolution every JS-ecosystem
 * wrapper uses. On other platforms the shim is a shell script with the same
 * name, which keeps the argv assertion meaningful everywhere while the
 * injection half only means something on Windows.
 *
 * @module
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { runFixture } from "./_harness.ts";

const FIXTURE = new URL("./fixtures/windows_shim_build.ts", import.meta.url);

/** An operand with no space, so nothing quotes it, and a cmd separator. */
const HOSTILE = "A=1&echo INJECTED";

/** The marker the shim prints for a command that was never supposed to run. */
const INJECTED = "INJECTED";

const IS_WINDOWS = Deno.build.os === "windows";

/**
 * Plant a `node_modules/.bin` shim that echoes one line per argument it
 * received, in the form the platform's resolver looks for.
 */
async function plantShim(dir: string): Promise<void> {
  const bin = `${dir}/node_modules/.bin`;
  await Deno.mkdir(bin, { recursive: true });
  if (IS_WINDOWS) {
    // A real batch shim, as npm writes: %* forwards every argument.
    await Deno.writeTextFile(
      `${bin}/zuke-shim.cmd`,
      "@echo off\r\nfor %%a in (%*) do @echo arg:%%~a\r\n",
    );
    return;
  }
  const shim = `${bin}/zuke-shim`;
  await Deno.writeTextFile(
    shim,
    '#!/bin/sh\nfor a in "$@"; do echo "arg:$a"; done\n',
  );
  await Deno.chmod(shim, 0o755);
}

Deno.test("a batch shim receives a cmd metacharacter as one argument", async () => {
  const dir = await Deno.makeTempDir({ prefix: "zuke-e2e-shim-" });
  try {
    await plantShim(dir);
    const { code, out, err } = await runFixture(FIXTURE, ["spawn"], {
      ZUKE_SHIM_DIR: dir,
      ZUKE_SHIM_ARG: HOSTILE,
    });
    const output = out + err;

    assertEquals(code, 0, `expected a passing build:\n${output}`);
    // The operand arrived whole. On Windows a `cmd /c` wrap would have split it
    // at the `&`, so the shim would have seen only `A=1`.
    assertEquals(
      out.includes(`arg:${HOSTILE}`),
      true,
      `the operand did not survive as one argument:\n${output}`,
    );
    // And nothing executed the tail of it as a command of its own.
    assertEquals(
      out.split("SHIM_STDOUT_BEGIN")[1]?.includes(`\n${INJECTED}`) ?? false,
      false,
      `the operand's tail was executed as a command:\n${output}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

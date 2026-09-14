// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * End-to-end: a *build* compiled with `deno compile`, running the build CLI's
 * `doc` command — which spawns Deno.
 *
 * The sibling of `compiled_cli_e2e.ts`, one layer down. #586 fixed the global
 * `zuke`; the same shape survived in `@zuke/core`'s own `doc` runner (#587),
 * where a compiled build's `Deno.execPath()` is the build rather than Deno — so
 * `deno doc <spec>` becomes the build being asked for a target named `doc`,
 * which spawns itself again, without bound.
 *
 * Only a real compiled binary separates the two: under `deno test` the
 * executable running the code *is* Deno, so `Deno.execPath()` happens to be the
 * right answer and the bug is invisible. Pinning it here does not make
 * compiling a build a supported deployment mode — it keeps the resolution
 * honest for the day one is compiled anyway.
 *
 * @module
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { withTemp } from "../../packages/core/tests/_temp.ts";

/** The `doc` command is build-independent, so the registry e2e's build serves. */
const BUILD =
  new URL("./fixtures/discoverable_build.ts", import.meta.url).pathname;

/** The compiled build's name on this platform. */
const BINARY = Deno.build.os === "windows" ? "build.exe" : "build";

/** A self-contained module for `deno doc` to read, with nothing to resolve. */
const LIBRARY = `/** A documented greeting. */
export function greet(): string {
  return "hi";
}
`;

/**
 * How long a run of the compiled binary is given.
 *
 * The pre-fix failure is unbounded process creation rather than an error — the
 * binary spawns itself with the same argv, and that copy does it again — so
 * every run is bounded and a regression fails this test instead of wedging the
 * OS-matrix job. Documenting a single local module takes about a second.
 */
const RUN_TIMEOUT_MS = 30_000;

/** Compile `BUILD` into `dir`, returning the binary's path. */
async function compileBuild(dir: string): Promise<string> {
  const binary = `${dir}/${BINARY}`;
  // `--no-lock` because the fixture's only import is a relative path into this
  // repository: there is nothing to pin, and a compile that touched the
  // committed lock would fail `lockCheck` for a resolution it never made.
  const { code, stderr } = await new Deno.Command(Deno.execPath(), {
    args: ["compile", "-A", "--no-lock", "--output", binary, BUILD],
    stdout: "null",
    stderr: "piped",
  }).output();
  if (code !== 0) {
    throw new Error(`deno compile failed: ${new TextDecoder().decode(stderr)}`);
  }
  return binary;
}

/** Run the compiled build's `doc` command with `path` as its whole `PATH`. */
async function docWith(
  binary: string,
  dir: string,
  spec: string,
  path: string,
): Promise<{ code: number; stderr: string }> {
  const { code, stderr } = await new Deno.Command(binary, {
    args: ["doc", spec],
    cwd: dir,
    clearEnv: true,
    env: { PATH: path, HOME: dir },
    stdout: "null",
    stderr: "piped",
    signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
  }).output();
  return { code, stderr: new TextDecoder().decode(stderr) };
}

Deno.test({
  name: "a compiled build documents a module with Deno rather than with itself",
  // The binary is ~90 MB and the compile is the expensive part; the resolution
  // itself is unit tested on every OS, and this proves the compiled case on the
  // ones the sibling CLI test already carries. The shim below is a shell
  // script, which is the same boundary.
  ignore: Deno.build.os === "windows",
  fn: async (t) => {
    await withTemp(async (dir) => {
      // One compile for both steps: it is the expensive part, and neither step
      // changes the binary.
      const binary = await compileBuild(dir);
      const library = `${dir}/lib.ts`;
      await Deno.writeTextFile(library, LIBRARY);

      await t.step(
        "it spawns the deno on PATH, with the doc argv",
        async () => {
          // A stand-in `deno` that records how it was called. Only a run that
          // resolves the *name* `deno` reaches it — a binary spawning its own
          // executable never looks at PATH at all.
          const shimDir = `${dir}/shim`;
          const marker = `${dir}/argv.txt`;
          await Deno.mkdir(shimDir);
          await Deno.writeTextFile(
            `${shimDir}/deno`,
            `#!/bin/sh\necho "$@" > ${marker}\n`,
          );
          await Deno.chmod(`${shimDir}/deno`, 0o755);

          const { code, stderr } = await docWith(binary, dir, library, shimDir);
          assertEquals(code, 0, `the compiled build failed: ${stderr}`);
          assertEquals(
            (await Deno.readTextFile(marker)).trim(),
            `doc ${library}`,
          );
        },
      );

      await t.step("and documents the module with a real one", async () => {
        const denoBin = new URL(".", `file://${Deno.execPath()}`).pathname;
        const { code, stderr } = await docWith(
          binary,
          dir,
          library,
          `${denoBin}:/usr/bin:/bin`,
        );
        assertEquals(
          code,
          0,
          `the compiled build could not document a module: ${stderr}`,
        );
      });
    }, { prefix: "zuke-compiled-build-" });
  },
});

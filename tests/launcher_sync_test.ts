// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for the launcher sync (`build/launchers.ts`): the committed `./zuke`
 * and `zuke.ps1` must be exactly what `@zuke/cli`'s launcher template renders
 * in its bootstrap variant, so the scripts `zuke setup` stamps into a project
 * are the ones this repository runs on every CI job.
 *
 * @module
 */

import { assertEquals } from "../packages/core/tests/_assert.ts";
import {
  BASH_LAUNCHER,
  checkRootLaunchers,
  PWSH_LAUNCHER,
  renderRootLaunchers,
  syncRootLaunchers,
} from "../build/launchers.ts";
import { withTemp } from "../packages/core/tests/_temp.ts";

Deno.test("the committed launchers match the CLI's template", async () => {
  assertEquals(await checkRootLaunchers(), []);
});

Deno.test("the rendered launchers are the bootstrap variant", () => {
  const files = renderRootLaunchers();
  assertEquals([...files.keys()], [BASH_LAUNCHER, PWSH_LAUNCHER]);
  assertEquals(files.get(BASH_LAUNCHER)?.includes("deno_checksum_for()"), true);
  assertEquals(files.get(PWSH_LAUNCHER)?.includes("$DenoChecksums"), true);
});

Deno.test("syncRootLaunchers round-trips through generate then check", async () => {
  await withTemp(async (dir) => {
    // Never sync into the repository root from a test: write only into the
    // temp dir, and assert that so re-introducing the default fails here.
    const written = await syncRootLaunchers(dir);
    assertEquals(written, [
      `${dir}/${BASH_LAUNCHER}`,
      `${dir}/${PWSH_LAUNCHER}`,
    ]);
    assertEquals(written.every((path) => path.startsWith(`${dir}/`)), true);
    assertEquals(await checkRootLaunchers(dir), []);
    if (Deno.build.os !== "windows") {
      const mode = (await Deno.stat(`${dir}/${BASH_LAUNCHER}`)).mode ?? 0;
      assertEquals(mode & 0o111, 0o111, "./zuke must be executable");
    }
    // No staging file is left behind by the rename.
    const leftovers: string[] = [];
    for await (const entry of Deno.readDir(dir)) leftovers.push(entry.name);
    assertEquals(leftovers.sort(), [BASH_LAUNCHER, PWSH_LAUNCHER]);
  });
});

Deno.test("checkRootLaunchers reports a missing and a drifted launcher", async () => {
  await withTemp(async (dir) => {
    assertEquals(await checkRootLaunchers(dir), [
      `${dir}/${BASH_LAUNCHER} (missing)`,
      `${dir}/${PWSH_LAUNCHER} (missing)`,
    ]);
    await syncRootLaunchers(dir);
    await Deno.writeTextFile(`${dir}/${BASH_LAUNCHER}`, "#!/bin/sh\nexit 1\n");
    assertEquals(await checkRootLaunchers(dir), [
      `${dir}/${BASH_LAUNCHER} (content differs from the template)`,
    ]);
  });
});

Deno.test("checkRootLaunchers tolerates CRLF from a Windows checkout", async () => {
  await withTemp(async (dir) => {
    await syncRootLaunchers(dir);
    for (const name of [BASH_LAUNCHER, PWSH_LAUNCHER]) {
      const path = `${dir}/${name}`;
      const lf = await Deno.readTextFile(path);
      await Deno.writeTextFile(path, lf.replaceAll("\n", "\r\n"));
    }
    assertEquals(await checkRootLaunchers(dir), []);
  });
});

Deno.test("checkRootLaunchers rethrows an error that is not a missing file", async () => {
  await withTemp(async (dir) => {
    // A directory where the launcher should be is neither missing nor
    // readable as text; that is a real error, not drift to report.
    await Deno.mkdir(`${dir}/${BASH_LAUNCHER}`);
    let thrown: unknown;
    try {
      await checkRootLaunchers(dir);
    } catch (error) {
      thrown = error;
    }
    assertEquals(thrown instanceof Error, true);
  });
});

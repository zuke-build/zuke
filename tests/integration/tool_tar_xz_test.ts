// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: a real build provisions a `.tar.xz`-only runtime (the Flutter
 * SDK's shape) through `ToolTasks.installTree` via the CLI `main()` — the
 * checksum is verified, the top directory stripped, the bins made executable,
 * and the symlinked `bin/dart` preserved — then puts its `bin/` on `PATH`.
 */

import { test } from "../_testing.ts";
import { assertEquals } from "../_assert.ts";
import {
  Build,
  EnvTasks,
  FileTasks,
  target,
  ToolTasks,
} from "../../packages/core/mod.ts";
import { sha256Hex } from "../../packages/core/src/internal.ts";
import { fixture, FLUTTER_TAR_XZ } from "../_xz.ts";
import { withTemp } from "../_temp.ts";
import { runCli } from "./_harness.ts";

/** Install the fixture SDK through a real build and report what it saw. */
async function installFlutter(): Promise<void> {
  await withTemp(async (dir) => {
    const bytes = fixture(FLUTTER_TAR_XZ);
    const checksum = await sha256Hex(bytes);
    const seen: string[] = [];
    class Flutter extends Build {
      sdk = target().description("Provision the Flutter SDK")
        .executes(async () => {
          const flutter = await ToolTasks.installTree((s) =>
            s.name("flutter").archive("tar.xz").strip(1)
              .bins("bin/flutter").destDir(dir)
              .url(() => "https://storage.googleapis.com/flutter.tar.xz")
              .checksum(checksum)
              .download(async (url, dest) => {
                seen.push(url);
                await FileTasks.writeBytes(String(dest), bytes);
              })
          );
          seen.push(await FileTasks.readText(String(flutter("version"))));
        });
    }
    const result = await runCli(Flutter, ["sdk"]);
    assertEquals(result.code, 0, result.err);
    assertEquals(seen, [
      "https://storage.googleapis.com/flutter.tar.xz",
      "3.47.7\n",
    ]);
  });
}

test(
  "a build installs a tar.xz runtime tree through ToolTasks.installTree",
  installFlutter,
);

test("a build installs a tar.xz tree with the built-in decoder when no xz is on PATH", async () => {
  const path = EnvTasks.get("PATH");
  EnvTasks.set("PATH", "");
  try {
    await installFlutter();
  } finally {
    if (path === undefined) EnvTasks.delete("PATH");
    else EnvTasks.set("PATH", path);
  }
});

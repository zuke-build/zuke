// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: a real build provisions a Unix-made `.zip` runtime tree (the
 * Flutter macOS SDK's shape) through `ToolTasks.installTree` via the CLI
 * `main()` with no `.bins(...)` — the archive's own mode makes the binary
 * executable, and its symlink comes back as a symlink.
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { Build, target, ToolTasks } from "../../packages/core/mod.ts";
import { makeZip } from "../../packages/core/tests/_zip.ts";
import { withTemp } from "../../packages/core/tests/_temp.ts";
import { runCli } from "./_harness.ts";

const enc = (s: string) => new TextEncoder().encode(s);

Deno.test({
  name: "a build installs a Unix zip tree keeping its modes and symlinks",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTemp(async (dir) => {
      const bytes = await makeZip([
        { name: "sdk/bin/tool", data: enc("#!/bin/sh\n"), unixMode: 0o100755 },
        { name: "sdk/bin/alias", data: enc("tool"), unixMode: 0o120777 },
      ]);
      const seen: string[] = [];
      class Sdk extends Build {
        sdk = target().executes(async () => {
          const root = await ToolTasks.installTree((s) =>
            s.name("sdk").archive("zip").strip(1).destDir(dir)
              .url(() => "https://example.test/sdk.zip")
              .download((_url, dest) => Deno.writeFile(String(dest), bytes))
          );
          const mode = (await Deno.stat(String(root("bin", "tool")))).mode;
          seen.push(((mode ?? 0) & 0o111).toString(8));
          seen.push(await Deno.readLink(String(root("bin", "alias"))));
        });
      }
      const result = await runCli(Sdk, ["sdk"]);
      assertEquals(result.code, 0, result.err);
      assertEquals(seen, ["111", "tool"]);
    });
  },
});

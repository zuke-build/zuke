// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration coverage for `FileTasks.symlink`/`readLink`: a real build,
 * driven through the CLI `main()` entry point, that links a sibling checkout
 * into a group directory the way a worktree-setup target does — and is re-run
 * to prove the link-creating target is idempotent rather than failing the
 * second time.
 *
 * Creating a symlink is privileged on Windows unless Developer Mode is on, so
 * the suite is POSIX-only; the unit tests draw the same line.
 *
 * @module
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { Build, FileTasks, target } from "../../packages/core/mod.ts";
import { runCli } from "./_harness.ts";

/** Whether this platform creates symlinks without elevation. */
const SYMLINKS_UNPRIVILEGED = Deno.build.os !== "windows";

Deno.test({
  name: "a link-creating target is idempotent across runs",
  ignore: !SYMLINKS_UNPRIVILEGED,
  fn: async () => {
    const root = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${root}/infra`);
      await Deno.mkdir(`${root}/other-infra`);
      await Deno.writeTextFile(`${root}/infra/mod.ts`, "// first");
      await Deno.writeTextFile(`${root}/other-infra/mod.ts`, "// second");
      await Deno.mkdir(`${root}/group`);

      let linkedTo = `${root}/infra`;
      const seen: string[] = [];
      class WorktreeBuild extends Build {
        link = target().description("link the shared build into the group")
          .executes(async () => {
            await FileTasks.symlink(linkedTo, `${root}/group/infra`, {
              type: "dir",
              force: true,
            });
            seen.push(await FileTasks.readLink(`${root}/group/infra`));
          });
      }

      const first = await runCli(WorktreeBuild, ["link"]);
      assertEquals(first.code, 0);
      // The second run is the one that used to need a remove-then-link dance:
      // symlinking onto an occupied path throws, so without force the target
      // is not re-runnable.
      const second = await runCli(WorktreeBuild, ["link"]);
      assertEquals(second.code, 0);

      // Re-pointing it is the same call, so a group can be moved onto a
      // different checkout without a separate teardown target.
      linkedTo = `${root}/other-infra`;
      const third = await runCli(WorktreeBuild, ["link"]);
      assertEquals(third.code, 0);

      assertEquals(seen, [
        `${root}/infra`,
        `${root}/infra`,
        `${root}/other-infra`,
      ]);
      assertEquals(
        await Deno.readTextFile(`${root}/group/infra/mod.ts`),
        "// second",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});

Deno.test({
  name: "linking onto an occupied path fails the build without force",
  ignore: !SYMLINKS_UNPRIVILEGED,
  fn: async () => {
    const root = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(`${root}/target.txt`, "t");
      await Deno.writeTextFile(`${root}/occupied`, "already here");
      class LinkBuild extends Build {
        link = target().executes(async () => {
          await FileTasks.symlink(`${root}/target.txt`, `${root}/occupied`);
        });
      }
      const { code } = await runCli(LinkBuild, ["link"]);
      assertEquals(code, 1);
      // The refusal left the existing file alone.
      assertEquals(
        await Deno.readTextFile(`${root}/occupied`),
        "already here",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});

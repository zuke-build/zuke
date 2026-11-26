// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Every package passes `deno publish`'s own checks — slow types in the public
 * API above all — before it is merged, not when the release job tries to
 * publish it. `@zuke/canary` 1.1.0 was released with a field whose type was
 * only inferred, every gate stayed green, and `publishJsr` then refused it.
 *
 * A workspace dry run checks all packages at once and needs no network: it
 * resolves `@zuke/core` from the workspace and uploads nothing.
 *
 * @module
 */

import { ProcessTasks, RuntimeTasks } from "@zuke/core";
import { test } from "./_testing.ts";
import { assertEquals } from "./_assert.ts";

test({
  name: "every workspace package passes deno publish --dry-run",
  denoOnly: "runs deno publish",
  fn: async () => {
    const { code, stderr } = await ProcessTasks.run(
      RuntimeTasks.execPath(),
      (s) =>
        // `--allow-dirty` so the check runs on a working tree with local edits,
        // which is the tree a contributor tests.
        s.args("publish", "--dry-run", "--allow-dirty").env("NO_COLOR", "1")
          .stdout("null").stderr("piped"),
    );
    assertEquals(code, 0, new TextDecoder().decode(stderr));
  },
});

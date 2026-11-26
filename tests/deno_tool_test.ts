// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for `build/deno_tool.ts`: the provisioned Deno is installed once
 * per run, however many targets ask for it at once, and a failed install
 * reaches every caller. A fake installer stands in, so nothing is downloaded.
 *
 * @module
 */

import { test } from "./_testing.ts";
import { type AbsolutePath, absolutePath } from "@zuke/core";
import { assertEquals, assertRejects } from "./_assert.ts";
import { sharedInstall } from "../build/deno_tool.ts";

test("concurrent callers share one install and get its path", async () => {
  let installs = 0;
  const deno = sharedInstall(() => {
    installs++;
    return Promise.resolve(absolutePath("/tools/deno"));
  });
  const paths = await Promise.all([deno(), deno(), deno()]);
  assertEquals(paths, ["/tools/deno", "/tools/deno", "/tools/deno"]);
  assertEquals(await deno(), "/tools/deno");
  assertEquals(installs, 1);
});

test("a failed install rejects every caller", async () => {
  let installs = 0;
  const deno = sharedInstall((): Promise<AbsolutePath> => {
    installs++;
    return Promise.reject(new Error("checksum mismatch"));
  });
  await assertRejects(() => deno(), Error, "checksum mismatch");
  await assertRejects(() => deno(), Error, "checksum mismatch");
  assertEquals(installs, 1);
});

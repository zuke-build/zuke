// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for `build/deno_tool.ts`: the provisioned Deno is installed once
 * per run, however many targets ask for it at once, and a failed install
 * reaches every caller. A fake installer stands in, so nothing is downloaded.
 * And every Deno step runs the Deno it is handed, not one from PATH.
 *
 * @module
 */

import { test } from "./_testing.ts";
import { type AbsolutePath, absolutePath } from "@zuke/core";
import { assertEquals, assertRejects } from "./_assert.ts";
import { sharedInstall } from "../build/deno_tool.ts";
import { collectDocLintReports, collectPackageDocs } from "../build/docs.ts";
import { collectApiJson } from "../build/api_reference.ts";
import { publishPackage } from "../build/publish.ts";

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

test("every Deno step runs the Deno it is handed, not one from PATH", async () => {
  // A binary that exists nowhere: each step must fail naming it, which shows the
  // provisioned path reaches the spawn, even with a real Deno on PATH. Only the
  // name is matched, and not the error class: Windows resolves the path onto a
  // drive and reports a failed spawn rather than a ToolNotFoundError.
  const fake = "/nonexistent/provisioned-deno";
  const deno = () => Promise.resolve(fake);
  const steps = [
    () => collectPackageDocs(deno),
    () => collectDocLintReports(deno),
    () => collectApiJson(deno),
    () => publishPackage("core", deno),
  ];
  for (const step of steps) {
    await assertRejects(step, Error, "provisioned-deno");
  }
});

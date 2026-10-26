// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The engine/worker spike stays unreleasable until it is promoted: it is not a
 * workspace member, nothing published imports it, and it reaches core only
 * through the published entrypoints, never by a relative path into
 * `packages/core/src`. Each rule here is what keeps the promotion a file move.
 */

import { PACKAGES } from "../build/packages.ts";
import { assertEquals } from "../packages/core/tests/_assert.ts";

async function tsFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) found.push(...await tsFiles(path));
    else if (entry.isFile && entry.name.endsWith(".ts")) found.push(path);
  }
  return found;
}

const SPECIFIER = /from\s+"([^"]+)"/g;

Deno.test("the spike is not a workspace member and is not in PACKAGES", async () => {
  const root = JSON.parse(await Deno.readTextFile("deno.json"));
  const members: string[] = root.workspace;
  assertEquals(members.filter((m) => m.includes("spike")), []);
  assertEquals(PACKAGES.filter((p) => p === "engine" || p === "spike"), []);
});

Deno.test("nothing under packages/ imports the spike", async () => {
  const offenders: string[] = [];
  for (const file of await tsFiles("packages")) {
    if ((await Deno.readTextFile(file)).includes("spike/")) {
      offenders.push(file);
    }
  }
  assertEquals(offenders, []);
});

Deno.test("the spike imports core only by bare specifier", async () => {
  const offenders: string[] = [];
  for (const file of await tsFiles("spike")) {
    const text = await Deno.readTextFile(file);
    for (const match of text.matchAll(SPECIFIER)) {
      const specifier = match[1];
      const local = specifier.startsWith("./") || specifier.startsWith("../");
      const intoCore = specifier.includes("packages/core/src");
      const bare = specifier.startsWith("@zuke/core");
      // Tests may reach the local assertion helper; sources may not reach
      // into any package by path.
      const allowedTest = file.includes("/tests/") &&
        specifier.endsWith("packages/core/tests/_assert.ts");
      if (!bare && !allowedTest && (!local || intoCore)) {
        offenders.push(`${file}: ${specifier}`);
      }
    }
  }
  assertEquals(offenders, []);
});

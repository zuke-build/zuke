// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for the workspace `package.json` each package carries: what it holds,
 * that the committed ones match their `deno.json`, and how drift is found.
 */

import { test } from "../packages/core/tests/_testing.ts";
import { assertEquals } from "../packages/core/tests/_assert.ts";
import { withTempCwd } from "../packages/core/tests/_temp.ts";
import {
  staleManifests,
  workspaceManifest,
  workspaceManifests,
} from "../build/workspace_manifest.ts";
import { PACKAGES } from "../build/packages.ts";

test("workspaceManifest names the package, keeps it private, and maps its exports to the sources", () => {
  const text = workspaceManifest({
    name: "@zuke/core",
    version: "1.84.0",
    exports: { ".": "./mod.ts", "./shell": "./src/shell.ts" },
  });
  assertEquals(JSON.parse(text), {
    name: "@zuke/core",
    private: true,
    type: "module",
    exports: { ".": "./mod.ts", "./shell": "./src/shell.ts" },
  });
  // No version: release-please bumps deno.json alone.
  assertEquals(text.includes("1.84.0"), false);
  assertEquals(text.endsWith("}\n"), true);
  // A single string export is the root export.
  assertEquals(
    JSON.parse(workspaceManifest({
      name: "@zuke/deno",
      version: "1.6.0",
      exports: "./mod.ts",
    })).exports,
    { ".": "./mod.ts" },
  );
});

test("every committed package.json matches its deno.json", async () => {
  assertEquals(await staleManifests(await workspaceManifests(PACKAGES)), []);
});

test("staleManifests names a manifest that is missing or differs, and not one that matches", async () => {
  await withTempCwd(async () => {
    await Deno.writeTextFile("same.json", "same\n");
    await Deno.writeTextFile("other.json", "before\n");
    const wanted = new Map([
      ["same.json", "same\n"],
      ["other.json", "after\n"],
      ["missing.json", "new\n"],
    ]);
    assertEquals(await staleManifests(wanted), ["other.json", "missing.json"]);
  });
});

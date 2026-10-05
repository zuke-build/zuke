// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Every workspace package depends on `@zuke/core` alone, unless
 * `PACKAGE_DEPENDENCIES` in `build/packages.ts` names the exemption — the rule
 * AGENTS.md states, enforced here so it cannot erode one import at a time.
 */

import { assertEquals } from "../packages/core/tests/_assert.ts";
import { PACKAGE_DEPENDENCIES, PACKAGES } from "../build/packages.ts";

/** The `@zuke/*` packages a `deno.json` imports, core excluded, sorted. */
function workspaceImports(pkg: string): string[] {
  const config: unknown = JSON.parse(
    Deno.readTextFileSync(`packages/${pkg}/deno.json`),
  );
  const imports = typeof config === "object" && config !== null &&
      "imports" in config && typeof config.imports === "object" &&
      config.imports !== null
    ? Object.keys(config.imports)
    : [];
  return imports
    .filter((name) => name.startsWith("@zuke/") && name !== "@zuke/core")
    .map((name) => name.slice("@zuke/".length))
    .sort();
}

Deno.test("a package depends on @zuke/core alone unless its exemption is listed", () => {
  for (const pkg of PACKAGES) {
    assertEquals(
      workspaceImports(pkg),
      [...(PACKAGE_DEPENDENCIES[pkg] ?? [])].sort(),
      `packages/${pkg}/deno.json: its @zuke/* imports beyond core must match ` +
        `PACKAGE_DEPENDENCIES in build/packages.ts`,
    );
  }
});

Deno.test("every exemption names workspace packages, and publishes after them", () => {
  for (const [pkg, deps] of Object.entries(PACKAGE_DEPENDENCIES)) {
    assertEquals(PACKAGES.includes(pkg), true, `${pkg} is not a package`);
    for (const dep of deps) {
      assertEquals(PACKAGES.includes(dep), true, `${dep} is not a package`);
    }
  }
  // The publish loop follows PACKAGES, so a package released together with a
  // new version of its dependency must come after it in the list.
  for (const [pkg, deps] of Object.entries(PACKAGE_DEPENDENCIES)) {
    for (const dep of deps) {
      assertEquals(
        PACKAGES.indexOf(dep) < PACKAGES.indexOf(pkg),
        true,
        `${pkg} publishes before its dependency ${dep}`,
      );
    }
  }
});

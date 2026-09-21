// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Guards the one duplicated constant in the workspace: the Zuke wordmark,
 * which exists in both `@zuke/core` and `@zuke/console`.
 *
 * Core is the home — a run's opening banner needs it, the executor is core,
 * and a project depends on core alone. Console cannot import it from there
 * yet: `coreFloorCheck` type-checks every package against the exact minimum of
 * its declared `@zuke/core` range resolved from JSR, and no published core
 * exports the module, so console's copy has to stand until a later PR raises
 * the floor (the `d8f51c0` pattern in `docs/versioning.md`).
 *
 * Until then this is what keeps the two from drifting. It lives in `tests/`
 * deliberately: the floor check only type-checks each package's `mod.ts`
 * graph, so importing core's copy here cannot reach the published surface.
 *
 * @module
 */

import { assertEquals } from "../../core/tests/_assert.ts";
import { ZUKE_LOGO as CONSOLE_LOGO } from "../src/logo.ts";
import { logoLines, ZUKE_LOGO as CORE_LOGO } from "../../core/src/logo.ts";
import { logoLines as consoleLogoLines } from "../src/logo.ts";

Deno.test("the console and core copies of the wordmark are identical", () => {
  assertEquals(CONSOLE_LOGO, CORE_LOGO);
});

Deno.test("the console and core logo renderers agree, plain and coloured", () => {
  for (const color of [false, true]) {
    assertEquals(consoleLogoLines(color), logoLines(color));
    assertEquals(
      consoleLogoLines(color, { tagline: "v1" }),
      logoLines(color, { tagline: "v1" }),
    );
  }
});

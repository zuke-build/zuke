/**
 * Integration: the wrapper conformance kit run against real, published wrapper
 * packages — a natively installed tool (`@zuke/git`, resolved from `PATH`) and a
 * JS-ecosystem one (`@zuke/biome`, resolved npx-style from `node_modules/.bin`).
 * The unit test drives the kit with fakes; this proves it holds for the settings
 * classes wrappers actually ship, including the `ToolNotFoundError` path.
 */

import { BiomeCheckSettings } from "../../packages/biome/mod.ts";
import { GitStatusSettings } from "../../packages/git/mod.ts";
// Through the published specifier, so the `./tooling/conformance` export a
// wrapper package imports is exercised too.
import { assertWrapperConformance } from "@zuke/core/tooling/conformance";

Deno.test("a PATH wrapper (@zuke/git) passes the conformance kit", async () => {
  await assertWrapperConformance(() => new GitStatusSettings(), "git");
});

Deno.test("a node_modules wrapper (@zuke/biome) passes the conformance kit", async () => {
  await assertWrapperConformance(() => new BiomeCheckSettings(), "biome", {
    resolution: "node_modules",
  });
});

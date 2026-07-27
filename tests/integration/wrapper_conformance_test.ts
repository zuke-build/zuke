/**
 * Integration: the wrapper conformance kit run against real, published wrapper
 * packages from inside a real build, driven through the CLI `main()`. Covers a
 * natively installed tool (`@zuke/git`, resolved from `PATH`), a JS-ecosystem
 * one (`@zuke/biome`, resolved npx-style from `node_modules/.bin`) and one that
 * resolves its invocation at run time (`@zuke/docker-compose`, pinned with
 * `.usePlugin()` so nothing ambient is probed). The unit test drives the kit
 * with fakes; this proves it holds for the settings classes wrappers actually
 * ship — and that a conformance failure fails the build rather than being
 * swallowed by the executor.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { runCli } from "./_harness.ts";
import { BiomeCheckSettings } from "../../packages/biome/mod.ts";
import { DockerComposeUpSettings } from "../../packages/docker-compose/mod.ts";
import { GitStatusSettings } from "../../packages/git/mod.ts";
// Through the published specifier, so the `./tooling/conformance` export a
// wrapper package imports is exercised too.
import { assertWrapperConformance } from "@zuke/core/tooling/conformance";

Deno.test("real wrappers pass the conformance kit inside a build", async () => {
  class Conformance extends Build {
    git = target()
      .description("@zuke/git resolves from PATH")
      .executes(async () => {
        await assertWrapperConformance(() => new GitStatusSettings(), "git", {
          resolution: "path",
        });
      });
    biome = target()
      .description("@zuke/biome resolves from node_modules/.bin")
      .dependsOn(this.git)
      .executes(async () => {
        await assertWrapperConformance(
          () => new BiomeCheckSettings(),
          "biome",
          { resolution: "node_modules" },
        );
      });
    // A wrapper that detects its invocation at run time conforms once that
    // detection is pinned in the factory — no ambient `docker compose version`.
    compose = target()
      .description("@zuke/docker-compose conforms when pinned")
      .dependsOn(this.biome)
      .executes(async () => {
        await assertWrapperConformance(
          () => new DockerComposeUpSettings().usePlugin(),
          "docker",
          { resolution: "path" },
        );
      });
  }
  const { code, err } = await runCli(Conformance, ["compose"]);
  assertEquals(code, 0, err);
});

Deno.test("a conformance failure fails the build through the CLI", async () => {
  class Wrong extends Build {
    // @zuke/biome really resolves npx-style; claiming PATH must fail loudly.
    biome = target().executes(async () => {
      await assertWrapperConformance(() => new BiomeCheckSettings(), "biome", {
        resolution: "path",
      });
    });
  }
  const { code, err } = await runCli(Wrong, ["biome"]);
  assertEquals(code, 1);
  assertStringIncludes(err, 'resolution: "node_modules"');
});

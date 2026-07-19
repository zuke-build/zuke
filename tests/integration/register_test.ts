/**
 * Integration: `zuke register` driven through the real CLI `main()`. Proves the
 * command resolves a registry from `ZUKE_REGISTRY_DIR`, writes a descriptor a
 * separate reader can load, keeps secrets out, and is idempotent.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import {
  Build,
  FileSystemBuildRegistry,
  parameter,
  target,
} from "../../packages/core/mod.ts";
import { runCli } from "./_harness.ts";

/** A build with a secret parameter and one target, registered by the tests. */
class RegBuild extends Build {
  apiToken = parameter("api token").secret();
  lint = target().description("Lint").executes(() => {});
  build = target().dependsOn(this.lint).executes(() => {});
}

/** Run `fn` with a fresh temporary `ZUKE_REGISTRY_DIR`, cleaned up afterwards. */
async function withRegistryDir(
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "zuke-reg-it-" });
  const prev = Deno.env.get("ZUKE_REGISTRY_DIR");
  Deno.env.set("ZUKE_REGISTRY_DIR", dir);
  try {
    await fn(dir);
  } finally {
    if (prev === undefined) Deno.env.delete("ZUKE_REGISTRY_DIR");
    else Deno.env.set("ZUKE_REGISTRY_DIR", prev);
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("zuke register writes a descriptor a reader can load", async () => {
  await withRegistryDir(async (dir) => {
    const first = await runCli(RegBuild, ["register"]);
    assertEquals(first.code, 0);
    assertStringIncludes(first.out, "Registered build");

    // A separate reader reconstructs the descriptor from the same directory.
    const registry = new FileSystemBuildRegistry(dir);
    const loaded = await registry.getBuild("RegBuild");
    assertEquals(loaded?.descriptor.id, "RegBuild");
    assertEquals(
      loaded?.descriptor.surface.targets.map((t) => t.name),
      ["lint", "build"],
    );
    // The secret parameter's flag is listed, but no value is anywhere in it.
    assertEquals(
      loaded?.descriptor.surface.parameters.map((p) => p.flag),
      ["api-token"],
    );
    const createdAt = loaded?.descriptor.createdAt;

    // Re-registering is idempotent: createdAt is preserved.
    const second = await runCli(RegBuild, ["register"]);
    assertEquals(second.code, 0);
    const reloaded = await registry.getBuild("RegBuild");
    assertEquals(reloaded?.descriptor.createdAt, createdAt);
    assertEquals((await registry.listBuilds({})).length, 1);
  });
});

Deno.test("zuke register --json prints the written descriptor", async () => {
  await withRegistryDir(async () => {
    const res = await runCli(RegBuild, ["register", "--json"]);
    assertEquals(res.code, 0);
    const parsed: unknown = JSON.parse(res.out);
    assertEquals(parsed !== null && typeof parsed === "object", true);
    assertStringIncludes(res.out, '"id": "RegBuild"');
  });
});

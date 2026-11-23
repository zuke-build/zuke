// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for the Node binary's entry: the same packages at the same releases
 * as the Deno binary's, by their names on JSR's npm registry, and the bundle
 * workflow around them with its network steps faked.
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../packages/core/tests/_assert.ts";
import { absolutePath } from "@zuke/core";
import { binaryEntry } from "../build/cli_binary.ts";
import {
  assertNodeBundleVersion,
  bundleNodeCli,
  JSR_NPMRC,
  jsrNpmName,
  npmEntry,
  npmManifest,
  REQUIRE_SHIM,
  tsdownConfig,
} from "../build/cli_node.ts";

const ENTRY = {
  cli: "jsr:@zuke/cli@2.3.0",
  engine: "jsr:@zuke/engine@1.3.0",
  engineVersion: "1.3.0",
  core: "jsr:@zuke/core@^1.80.0",
  coreVersion: "1.81.0",
  wrappers: [
    { name: "deno", version: "1.5.0", specifier: "jsr:@zuke/deno@1.5.0" },
  ],
};

Deno.test("npmEntry imports every package by its JSR npm name, at the release the JSR entry names", () => {
  assertEquals(jsrNpmName("core"), "@jsr/zuke__core");
  const { entry, dependencies } = npmEntry(ENTRY, "2.3.0");
  assertEquals(entry.cli, "@jsr/zuke__cli");
  assertEquals(entry.engine, "@jsr/zuke__engine");
  assertEquals(entry.core, "@jsr/zuke__core");
  assertEquals(entry.engineVersion, "1.3.0");
  assertEquals(entry.wrappers, [
    { name: "deno", version: "1.5.0", specifier: "@jsr/zuke__deno" },
  ]);
  // Exact releases, core at the one this checkout holds, not the range.
  assertEquals(dependencies, {
    "@jsr/zuke__cli": "2.3.0",
    "@jsr/zuke__engine": "1.3.0",
    "@jsr/zuke__core": "1.81.0",
    "@jsr/zuke__deno": "1.5.0",
  });
  // The rendered entry is the Deno binary's, by these names.
  const source = binaryEntry(entry);
  assertStringIncludes(source, '} from "@jsr/zuke__engine";');
  assertStringIncludes(source, 'load: () => import("@jsr/zuke__deno"),');
});

Deno.test("npmManifest pins the dependencies in a private ES module package, and the scope goes to JSR", () => {
  const manifest = JSON.parse(npmManifest(npmEntry(ENTRY, "2.3.0")));
  assertEquals(manifest.private, true);
  assertEquals(manifest.type, "module");
  assertEquals(manifest.dependencies["@jsr/zuke__cli"], "2.3.0");
  // The bundler is pinned beside them, not taken from wherever.
  assertEquals(manifest.devDependencies, { tsdown: "0.23.4" });
  assertEquals(JSR_NPMRC, "@jsr:registry=https://npm.jsr.io\n");
});

Deno.test("tsdownConfig bundles every dependency into one ES module, dynamic imports inlined", () => {
  const config = tsdownConfig();
  assertStringIncludes(config, "export default {");
  // One file: a single executable carries nothing beside it.
  assertStringIncludes(config, '"inlineDynamicImports":true');
  assertStringIncludes(config, "deps: { alwaysBundle: [/.*/] },");
  assertStringIncludes(config, '"format":"esm"');
  assertStringIncludes(config, '"platform":"node"');
  assertStringIncludes(config, JSON.stringify(REQUIRE_SHIM));
});

/** A fresh temporary directory, removed after `fn`. */
async function inTemp(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "zuke-node-test-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("bundleNodeCli writes the project, installs, bundles and copies the result, then removes its scratch", async () => {
  await inTemp(async (dir) => {
    const seen: { dir: string; files: string[] }[] = [];
    const out = absolutePath(dir, "dist", "zuke.mjs");
    await bundleNodeCli(npmEntry(ENTRY, "2.3.0"), out, {
      install: async (scratch) => {
        const files: string[] = [];
        for await (const e of Deno.readDir(scratch)) files.push(e.name);
        seen.push({ dir: scratch, files: files.sort() });
      },
      bundle: async (scratch) => {
        await Deno.mkdir(`${scratch}/out`);
        await Deno.writeTextFile(`${scratch}/out/entry.mjs`, "bundled");
      },
    });
    // Everything the steps need was written before the first ran.
    assertEquals(seen[0].files, [
      ".npmrc",
      "entry.mjs",
      "package.json",
      "tsdown.config.mjs",
    ]);
    assertEquals(await Deno.readTextFile(out.path), "bundled");
    assertEquals(await Deno.stat(seen[0].dir).catch(() => null), null);
  });
});

Deno.test("bundleNodeCli removes its scratch and writes nothing when a step fails", async () => {
  await inTemp(async (dir) => {
    let scratch = "";
    const out = absolutePath(dir, "zuke.mjs");
    await assertRejects(
      () =>
        bundleNodeCli(npmEntry(ENTRY, "2.3.0"), out, {
          install: (d) => {
            scratch = d;
            return Promise.reject(new Error("npm install failed"));
          },
          bundle: () => Promise.resolve(),
        }),
      Error,
      "npm install failed",
    );
    assertEquals(await Deno.stat(scratch).catch(() => null), null);
    assertEquals(await Deno.stat(out.path).catch(() => null), null);
  });
});

Deno.test("assertNodeBundleVersion accepts the version it prints, and names anything else", async () => {
  await inTemp(async (dir) => {
    const bundle = absolutePath(dir, "zuke.mjs");
    // The running deno stands in for Node: it runs an ES module file too.
    const node = Deno.execPath();
    await Deno.writeTextFile(bundle.path, 'console.log("2.3.0");\n');
    await assertNodeBundleVersion(bundle, "2.3.0", node);
    await assertRejects(
      () => assertNodeBundleVersion(bundle, "2.4.0", node),
      Error,
      'printed "2.3.0" (exit 0)',
    );
    await Deno.writeTextFile(bundle.path, "Deno.exit(3);\n");
    await assertRejects(
      () => assertNodeBundleVersion(bundle, "2.3.0", node),
      Error,
      "(exit 3)",
    );
  });
});

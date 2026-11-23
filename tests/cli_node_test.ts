// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for the Node binary's entry: the same packages at the same releases
 * as the Deno binary's, by their names on JSR's npm registry. Installing them
 * and bundling the result needs the network, so `cliNodeBundle` does that.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../packages/core/tests/_assert.ts";
import { binaryEntry } from "../build/cli_binary.ts";
import {
  JSR_NPMRC,
  jsrNpmName,
  npmEntry,
  npmManifest,
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
  assertEquals(JSR_NPMRC, "@jsr:registry=https://npm.jsr.io\n");
});

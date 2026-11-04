// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for the entry the `zuke` binary is compiled from: what it imports,
 * at which releases, and the two modes it starts in. That the rendered module
 * compiles and runs a hosted build with no Deno reachable is the e2e suite's
 * (`tests/e2e/embedded_engine_e2e.ts`).
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../packages/core/tests/_assert.ts";
import {
  binaryEntry,
  embeddedReleases,
  releaseEntry,
} from "../build/cli_binary.ts";
import { localVersion } from "../build/packages.ts";
import { WRAPPER_PACKAGES } from "../build/tool_spec.ts";

const ENTRY = {
  cli: "jsr:@zuke/cli@2.3.0",
  engine: "jsr:@zuke/engine@1.3.0",
  engineVersion: "1.3.0",
  core: "jsr:@zuke/core@^1.80.0",
  coreVersion: "1.81.0",
  wrappers: [
    { name: "deno", version: "1.5.0", specifier: "jsr:@zuke/deno@1.5.0" },
    { name: "docker", version: "1.4.0", specifier: "jsr:@zuke/docker@1.4.0" },
  ],
};

Deno.test("binaryEntry imports the CLI, the engine, its core and every wrapper by literal specifier", () => {
  const source = binaryEntry(ENTRY);
  assertEquals(
    source.startsWith(
      "// Copyright (c) 2026 the Zuke contributors\n" +
        "// SPDX-License-Identifier: MIT\n",
    ),
    true,
  );
  assertStringIncludes(
    source,
    '  FORWARDED_ENV,\n} from "jsr:@zuke/cli@2.3.0";',
  );
  assertStringIncludes(source, '} from "jsr:@zuke/engine@1.3.0";');
  assertStringIncludes(source, 'import { run } from "jsr:@zuke/core@^1.80.0";');
  assertStringIncludes(source, 'const ENGINE = "1.3.0";');
  // Literal imports, in the order given, which is what the compile embeds.
  assertStringIncludes(
    source,
    '  "deno": {\n    version: "1.5.0",\n' +
      '    load: () => import("jsr:@zuke/deno@1.5.0"),\n  },\n' +
      '  "docker": {\n    version: "1.4.0",\n' +
      '    load: () => import("jsr:@zuke/docker@1.4.0"),\n  },\n',
  );
  // Engine mode clears both switches before the build can start anything,
  // so a zuke a body runs is forwarded afresh, launcher and all.
  assertStringIncludes(
    source,
    "  Deno.env.delete(EMBEDDED_ENGINE_ENV);\n" +
      "  Deno.env.delete(FORWARDED_ENV);\n" +
      "  await run(await hostedBuild(embeddedTools(RELEASES)));",
  );
  assertStringIncludes(source, "program: Deno.execPath(),");
  assertEquals(binaryEntry(ENTRY), source);
});

Deno.test("binaryEntry escapes what it writes as string literals", () => {
  const source = binaryEntry({
    ...ENTRY,
    engineVersion: '1.0.0"; Deno.exit(1); "',
  });
  assertStringIncludes(
    source,
    'const ENGINE = "1.0.0\\"; Deno.exit(1); \\"";',
  );
});

Deno.test("releaseEntry embeds this checkout's engine and every released wrapper from JSR", async () => {
  const entry = await releaseEntry("9.9.9");
  const engine = await localVersion("engine");
  assertEquals(entry.cli, "jsr:@zuke/cli@9.9.9");
  assertEquals(entry.engine, `jsr:@zuke/engine@${engine}`);
  assertEquals(entry.engineVersion, engine);
  // The very range the engine imports, so run and the engine share a core.
  const config = JSON.parse(
    await Deno.readTextFile("packages/engine/deno.json"),
  );
  assertEquals(entry.core, config.imports["@zuke/core"]);
  const released: string[] = [];
  for (const name of WRAPPER_PACKAGES) {
    if (await localVersion(name) !== "0.0.0") released.push(name);
  }
  assertEquals(entry.wrappers.map((w) => w.name), released);
  const docker = entry.wrappers.find((w) => w.name === "docker");
  assertEquals(
    docker?.specifier,
    `jsr:@zuke/docker@${await localVersion("docker")}`,
  );
  assertEquals(entry.coreVersion, await localVersion("core"));
  assertEquals(embeddedReleases(entry, "9.9.9").slice(0, 3), [
    ["cli", "9.9.9"],
    ["engine", engine],
    ["core", entry.coreVersion],
  ]);
  assertEquals(
    embeddedReleases(entry, "9.9.9").length,
    entry.wrappers.length + 3,
  );
});

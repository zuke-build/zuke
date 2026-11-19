// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The npm build's pure parts: every package's generated manifest agrees with
 * its `deno.json`, the tsconfig maps every entry point, and the publish walk
 * skips, orders and reports as `publishAll` does for JSR.
 *
 * @module
 */

import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../packages/core/tests/_assert.ts";
import { PACKAGE_DEPENDENCIES, PACKAGES } from "../build/packages.ts";
import { npmManifest, parseDenoPackage } from "../build/npm_manifest.ts";
import { consumerManifest } from "../build/npm_smoke.ts";
import { npmTsconfig } from "../build/npm_build.ts";
import {
  isPublishedToNpm,
  type NpmPublishDeps,
  publishAllToNpm,
} from "../build/npm_publish.ts";

async function denoJson(pkg: string): Promise<Record<string, unknown>> {
  return JSON.parse(await Deno.readTextFile(`packages/${pkg}/deno.json`));
}

Deno.test("every package's npm manifest agrees with its deno.json", async () => {
  for (const pkg of PACKAGES) {
    const json = await denoJson(pkg);
    const manifest = npmManifest(json);
    assertEquals(manifest.name, `@zuke-build/${pkg}`);
    assertEquals(manifest.version, json.version);
    assertEquals(manifest.type, "module");
    const { exports } = parseDenoPackage(json);
    assertEquals(
      manifest.exports,
      Object.fromEntries(
        Object.entries(exports).map(([key, path]) => [key, {
          types: path.replace(/\.ts$/, ".d.ts"),
          default: path.replace(/\.ts$/, ".js"),
        }]),
      ),
    );
    const imports = Object.entries(json.imports ?? {});
    assertEquals(
      manifest.dependencies,
      Object.fromEntries(imports.map(([name, spec]) => [
        name,
        String(spec).replace("jsr:@zuke/", "npm:@zuke-build/"),
      ])),
    );
    // Each dependency is a workspace package, listed in PACKAGE_DEPENDENCIES
    // unless it is core.
    for (const [name] of imports) {
      const short = name.replace("@zuke/", "");
      assertEquals(
        short === "core" || PACKAGE_DEPENDENCIES[pkg]?.includes(short),
        true,
        `${pkg} depends on ${name}`,
      );
    }
  }
});

Deno.test("a manifest takes a string export and omits a missing description", () => {
  const manifest = npmManifest({
    name: "@zuke/x",
    version: "1.0.0",
    exports: "./mod.ts",
  });
  assertEquals(manifest.exports, {
    ".": { types: "./mod.d.ts", default: "./mod.js" },
  });
  assertEquals("description" in manifest, false);
});

Deno.test("a foreign or malformed deno.json is refused", () => {
  const base = { name: "@zuke/x", version: "1.0.0", exports: "./mod.ts" };
  for (
    const imports of [
      { "@std/path": "jsr:@std/path@^1" },
      { yaml: "npm:yaml@2" },
      { "@zuke/core": "jsr:@zuke/gh@^1" },
      { "@zuke/core": 3 },
    ]
  ) assertThrows(() => npmManifest({ ...base, imports }), Error, "not a");
  assertThrows(() => npmManifest({ ...base, imports: 1 }), Error, "imports");
  assertThrows(() => npmManifest({ ...base, exports: { ".": 1 } }), Error);
  assertThrows(() => npmManifest({ ...base, exports: undefined }), Error);
  assertThrows(() => npmManifest({ ...base, version: 1 }), Error, "version");
  assertThrows(() => npmManifest({ ...base, name: "x" }), Error, "@zuke");
  assertThrows(
    () => npmManifest({ ...base, exports: "./mod.js" }),
    Error,
    ".ts",
  );
  assertThrows(() => npmManifest(null), Error, "object");
});

Deno.test("the tsconfig maps and emits every entry point", async () => {
  const config = npmTsconfig(
    [await denoJson("core"), await denoJson("deno")],
    "/r/packages",
    "/r/dist/npm",
  );
  assertEquals(config.files, [
    "/r/packages/core/mod.ts",
    "/r/packages/core/src/shell.ts",
    "/r/packages/core/src/tooling.ts",
    "/r/packages/core/src/tooling_conformance.ts",
    "/r/packages/core/src/render.ts",
    "/r/packages/core/src/conformance.ts",
    "/r/packages/deno/mod.ts",
  ]);
  const options = config.compilerOptions;
  assertEquals(
    typeof options === "object" && options !== null && "paths" in options &&
      options.paths,
    {
      "@zuke/core": ["/r/packages/core/mod.ts"],
      "@zuke/core/shell": ["/r/packages/core/src/shell.ts"],
      "@zuke/core/tooling": ["/r/packages/core/src/tooling.ts"],
      "@zuke/core/tooling/conformance": [
        "/r/packages/core/src/tooling_conformance.ts",
      ],
      "@zuke/core/render": ["/r/packages/core/src/render.ts"],
      "@zuke/core/conformance": ["/r/packages/core/src/conformance.ts"],
      "@zuke/deno": ["/r/packages/deno/mod.ts"],
    },
  );
});

/** A fake registry: what is on npm, what a publish does, what was said. */
function fake(
  onNpm: string[],
  failing: string[] = [],
): NpmPublishDeps & { published: string[]; said: string[] } {
  const published: string[] = [];
  const said: string[] = [];
  return {
    published,
    said,
    versionOf: (pkg) => Promise.resolve(pkg === "docs" ? "0.0.0" : "1.0.0"),
    isPublished: (pkg) => Promise.resolve(onNpm.includes(pkg)),
    publish: (pkg) => {
      if (failing.includes(pkg)) return Promise.reject(new Error("boom"));
      published.push(pkg);
      return Promise.resolve();
    },
    info: (message) => said.push(message),
    failed: (message) => said.push(message),
  };
}

Deno.test("publishAllToNpm skips 0.0.0 and published, in order", async () => {
  const deps = fake(["deno"]);
  await publishAllToNpm(
    ["core", "engine", "deno", "docs", "ai"],
    { ai: ["gh"] },
    deps,
  );
  assertEquals(deps.published, ["core", "engine", "ai"]);
});

Deno.test("publishAllToNpm skips what depends on a failure, then throws", async () => {
  const deps = fake([], ["core", "gh"]);
  await assertRejects(
    () => publishAllToNpm(["core", "deno", "gh", "ai"], { ai: ["gh"] }, deps),
    Error,
    "4 package version(s) did not reach npm",
  );
  assertEquals(deps.published, []);
  assertEquals(
    deps.said.filter((m) => m.includes("did not land")).length,
    3,
  );
});

Deno.test("publishAllToNpm does not need a published version's dependencies", async () => {
  const deps = fake(["deno"], ["core"]);
  await assertRejects(() => publishAllToNpm(["core", "deno"], {}, deps));
  assertEquals(deps.said.some((m) => m.includes("already on npm")), true);
});

Deno.test("isPublishedToNpm reads the registry's versions, and 404 is no", async () => {
  const real = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (input) => {
    asked.push(String(input));
    return Promise.resolve(
      String(input).endsWith("new")
        ? new Response("{}", { status: 404 })
        : String(input).endsWith("bad")
        ? new Response("[]", { status: 200 })
        : new Response(JSON.stringify({ versions: { "1.0.0": {} } })),
    );
  };
  try {
    assertEquals(await isPublishedToNpm("core", "1.0.0"), true);
    assertEquals(await isPublishedToNpm("core", "1.0.1"), false);
    assertEquals(await isPublishedToNpm("new", "1.0.0"), false);
    assertEquals(await isPublishedToNpm("bad", "1.0.0"), false);
    assertEquals(
      asked[0],
      "https://registry.npmjs.org/@zuke-build%2fcore",
    );
  } finally {
    globalThis.fetch = real;
  }
});

Deno.test("the smoke consumer installs both aliases and overrides core", () => {
  const tarballs = {
    "@zuke/core": "file:/t/core.tgz",
    "@zuke/deno": "file:/t/deno.tgz",
  };
  assertEquals(consumerManifest(tarballs), {
    private: true,
    type: "module",
    dependencies: tarballs,
    overrides: { "@zuke/core": "file:/t/core.tgz" },
  });
  assertThrows(() => consumerManifest({}), Error, "@zuke/core");
});

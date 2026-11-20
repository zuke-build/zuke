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
import {
  NPM_EXCLUDED,
  npmManifest,
  npmPackages,
  parseDenoPackage,
} from "../build/npm_manifest.ts";
import { consumerManifest, SMOKE_BUILD } from "../build/npm_smoke.ts";
import { npmTsconfig } from "../build/npm_build.ts";
import {
  isPublishedToNpm,
  npmRegistry,
  trustAll,
} from "../build/npm_publish.ts";
import { publishAllTo, type PublishRegistry } from "../build/publish.ts";

async function denoJson(pkg: string): Promise<Record<string, unknown>> {
  return JSON.parse(await Deno.readTextFile(`packages/${pkg}/deno.json`));
}

Deno.test("only the packages that import jsr: at runtime stay off npm", () => {
  assertEquals([...NPM_EXCLUDED], ["cli", "engine"]);
  for (const pkg of NPM_EXCLUDED) assertEquals(PACKAGES.includes(pkg), true);
  assertEquals(npmPackages(PACKAGES).length, PACKAGES.length - 2);
  // Nothing published depends on a package that is not.
  for (const pkg of npmPackages(PACKAGES)) {
    for (const dep of PACKAGE_DEPENDENCIES[pkg] ?? []) {
      assertEquals(NPM_EXCLUDED.includes(dep), false, `${pkg} -> ${dep}`);
    }
  }
});

Deno.test("every published package's npm manifest agrees with its deno.json", async () => {
  for (const pkg of npmPackages(PACKAGES)) {
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

/** A fake npm: what is on it, what a publish does, what was said. */
function fake(
  onNpm: string[],
  failing: string[] = [],
) {
  const published: string[] = [];
  const said: string[] = [];
  const registry: PublishRegistry = {
    ...npmRegistry(),
    isPublished: (pkg) => Promise.resolve(onNpm.includes(pkg)),
    publish: (pkg) => {
      if (failing.includes(pkg)) return Promise.reject(new Error("boom"));
      published.push(pkg);
      return Promise.resolve();
    },
  };
  const deps = {
    versionOf: (pkg: string) =>
      Promise.resolve(pkg === "docs" ? "0.0.0" : "1.0.0"),
    info: (message: string) => said.push(message),
    failed: (message: string) => said.push(message),
  };
  return { registry, deps, published, said };
}

Deno.test("publishAllTo npm skips 0.0.0 and published, in order", async () => {
  const { registry, deps, published, said } = fake(["deno"]);
  await publishAllTo(
    ["core", "engine", "deno", "docs", "ai"],
    { ai: ["gh"] },
    deps,
    registry,
  );
  assertEquals(published, ["core", "engine", "ai"]);
  assertEquals(said, [
    "@zuke-build/deno@1.0.0 is already on npm.",
    "@zuke-build/docs has no released version yet.",
  ]);
});

Deno.test("publishAllTo npm skips what depends on a failure, then throws", async () => {
  const { registry, deps, published, said } = fake([], ["core", "gh"]);
  await assertRejects(
    () =>
      publishAllTo(
        ["core", "deno", "gh", "ai"],
        { ai: ["gh"] },
        deps,
        registry,
      ),
    Error,
    "4 package version(s) did not reach npm: @zuke-build/core@1.0.0",
  );
  assertEquals(published, []);
  assertEquals(
    said.filter((m) => m.includes("did not land")).length,
    3,
  );
});

Deno.test("publishAllTo npm does not hold a published version to its dependencies", async () => {
  const { registry, deps, said } = fake(["deno"], ["core"]);
  await assertRejects(() => publishAllTo(["core", "deno"], {}, deps, registry));
  assertEquals(
    said.includes("@zuke-build/deno@1.0.0 is already on npm."),
    true,
  );
});

Deno.test("npmRegistry refuses a version whose package changed since its tag, or has none, and uploads nothing", async () => {
  const said: string[] = [];
  const registry: PublishRegistry = {
    ...npmRegistry({
      // `core` has its tag and is unchanged, `gh` changed, `deno` has no tag.
      hasTag: (tag) => Promise.resolve(tag !== "deno-v1.0.0"),
      changed: (_tag, path) =>
        Promise.resolve(path === "packages/gh" ? ["packages/gh/a.ts"] : []),
    }),
    isPublished: () => Promise.resolve(false),
  };
  await assertRejects(
    () =>
      publishAllTo(["gh", "deno"], {}, {
        versionOf: () => Promise.resolve("1.0.0"),
        info: (m) => said.push(m),
        failed: (m) => said.push(m),
      }, registry),
    Error,
    "2 package version(s) did not reach npm",
  );
  assertEquals(said, [
    "@zuke-build/gh@1.0.0 did not publish: packages/gh changed since gh-v1.0.0, or there is no such tag; npm would get different source than JSR's @zuke/gh@1.0.0.",
    "@zuke-build/deno@1.0.0 did not publish: packages/deno changed since deno-v1.0.0, or there is no such tag; npm would get different source than JSR's @zuke/deno@1.0.0.",
  ]);
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

Deno.test("the smoke build it generates opens with the license header", () => {
  assertEquals(
    SMOKE_BUILD.split("\n").slice(0, 2),
    [
      "// Copyright (c) 2026 the Zuke contributors",
      "// SPDX-License-Identifier: MIT",
    ],
  );
});

Deno.test("trustAll reports each package npm could not trust and carries on", async () => {
  const errors: string[] = [];
  const tried: string[] = [];
  const failed = await trustAll(
    ["a", "b", "c", "d"],
    (pkg) => {
      tried.push(pkg);
      if (pkg === "c") throw new Error("spawn failed");
      if (pkg === "d") return Promise.reject(new Error("npm: not found"));
      return Promise.resolve(pkg === "b" ? 1 : 0);
    },
    (m) => errors.push(m),
  );
  assertEquals(tried, ["a", "b", "c", "d"]);
  assertEquals(failed, ["b", "c", "d"]);
  assertEquals(errors, [
    "@zuke-build/b: npm trust exited with code 1.",
    "@zuke-build/c: spawn failed.",
    "@zuke-build/d: npm: not found.",
  ]);
  assertEquals(
    await trustAll([], () => Promise.resolve(1), (m) => errors.push(m)),
    [],
  );
});

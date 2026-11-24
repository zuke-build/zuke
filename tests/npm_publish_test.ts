// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The npm build's pure parts: every package's generated manifest agrees with
 * its `deno.json`, the tsconfig maps every entry point, and the publish walk
 * skips, orders and reports as `publishAll` does for JSR.
 *
 * @module
 */

import { test } from "../packages/core/tests/_testing.ts";
import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../packages/core/tests/_assert.ts";
import { PACKAGE_DEPENDENCIES, PACKAGES } from "../build/packages.ts";
import {
  NPM_BIN_FILE,
  NPM_BIN_PACKAGE,
  NPM_BIN_SOURCE,
  NPM_EXCLUDED,
  npmManifest,
  npmPackages,
  parseDenoPackage,
} from "../build/npm_manifest.ts";
import { consumerManifest, SMOKE_BUILD } from "../build/npm_smoke.ts";
import { npmTsconfig } from "../build/npm_build.ts";
import {
  isPublishedToNpm,
  jsonValues,
  npmRegistry,
  trustAll,
  trustsRelease,
} from "../build/npm_publish.ts";
import {
  publishAllTo,
  type PublishRegistry,
  standingOf,
} from "../build/publish.ts";

async function denoJson(pkg: string): Promise<Record<string, unknown>> {
  return JSON.parse(await Deno.readTextFile(`packages/${pkg}/deno.json`));
}

test("only the engine, which imports jsr: at runtime, stays off npm", () => {
  assertEquals([...NPM_EXCLUDED], ["engine"]);
  for (const pkg of NPM_EXCLUDED) assertEquals(PACKAGES.includes(pkg), true);
  assertEquals(npmPackages(PACKAGES).length, PACKAGES.length - 1);
  assertEquals(npmPackages(PACKAGES).includes("cli"), true);
  // Nothing published depends on a package that is not.
  for (const pkg of npmPackages(PACKAGES)) {
    for (const dep of PACKAGE_DEPENDENCIES[pkg] ?? []) {
      assertEquals(NPM_EXCLUDED.includes(dep), false, `${pkg} -> ${dep}`);
    }
  }
});

test("every published package's npm manifest agrees with its deno.json", async () => {
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

test("only the cli's manifest carries the zuke bin, and its file is a deterministic node script", async () => {
  for (const pkg of npmPackages(PACKAGES)) {
    const manifest = npmManifest(await denoJson(pkg));
    assertEquals(
      manifest.bin,
      pkg === NPM_BIN_PACKAGE ? { zuke: NPM_BIN_FILE } : undefined,
      pkg,
    );
  }
  const lines = NPM_BIN_SOURCE.split("\n");
  assertEquals(lines[0], "#!/usr/bin/env node");
  assertEquals(lines.slice(1, 3), [
    "// Copyright (c) 2026 the Zuke contributors",
    "// SPDX-License-Identifier: MIT",
  ]);
  assertEquals(NPM_BIN_SOURCE.includes("\r"), false);
  assertEquals(NPM_BIN_SOURCE.includes("import.meta.main"), false);
});

test("a manifest takes a string export and omits a missing description", () => {
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

test("a foreign or malformed deno.json is refused", () => {
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

test("the tsconfig maps and emits every entry point", async () => {
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
    held: () => Promise.resolve(null),
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

test("publishAllTo npm skips 0.0.0 and published, in order", async () => {
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

test("publishAllTo npm skips what depends on a failure, then throws", async () => {
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

test("publishAllTo npm does not hold a published version to its dependencies", async () => {
  const { registry, deps, said } = fake(["deno"], ["core"]);
  await assertRejects(() => publishAllTo(["core", "deno"], {}, deps, registry));
  assertEquals(
    said.includes("@zuke-build/deno@1.0.0 is already on npm."),
    true,
  );
});

test("npmRegistry holds a package changed since its tag, and its dependents, refuses one with no tag, and uploads neither", async () => {
  const said: string[] = [];
  const uploaded: string[] = [];
  const base = npmRegistry({
    // `core` is unchanged, `gh` changed, `deno` has no tag.
    hasTag: (tag) => Promise.resolve(tag !== "deno-v1.0.0"),
    changed: (_tag, path) =>
      Promise.resolve(path === "packages/gh" ? ["packages/gh/a.ts"] : []),
    versionAt: () => Promise.resolve(null),
  });
  const registry: PublishRegistry = {
    ...base,
    isPublished: () => Promise.resolve(false),
    // The tag checks are the real ones; only the upload is faked, and an
    // untagged package is refused before anything is uploaded.
    publish: (pkg, version) => {
      if (pkg === "deno") return base.publish(pkg, version);
      uploaded.push(pkg);
      return Promise.resolve();
    },
  };
  await assertRejects(
    () =>
      publishAllTo(["core", "gh", "ai", "deno"], { ai: ["gh"] }, {
        versionOf: () => Promise.resolve("1.0.0"),
        info: (m) => said.push(m),
        failed: (m) => said.push(m),
      }, registry),
    Error,
    "1 package version(s) did not reach npm: @zuke-build/deno@1.0.0",
  );
  assertEquals(uploaded, ["core"]);
  assertEquals(said, [
    "@zuke-build/gh@1.0.0 waits: packages/gh changed since gh-v1.0.0, so its next release publishes it to npm.",
    "@zuke-build/ai@1.0.0 waits: its dependency @zuke-build/gh waits.",
    "@zuke-build/deno@1.0.0 did not publish: there is no tag deno-v1.0.0 in this clone, so its source cannot be shown to be JSR's @zuke-build/deno@1.0.0; fetch the tags and retry.",
  ]);
});

test("isPublishedToNpm reads the registry's versions, and 404 is no", async () => {
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

test("the smoke consumer installs every alias and overrides each to its tarball", () => {
  const tarballs = {
    "@zuke/core": "file:/t/core.tgz",
    "@zuke/deno": "file:/t/deno.tgz",
  };
  assertEquals(consumerManifest(tarballs), {
    private: true,
    type: "module",
    dependencies: tarballs,
    overrides: tarballs,
  });
  assertThrows(() => consumerManifest({}), Error, "@zuke/core");
});

test("the smoke build it generates opens with the license header", () => {
  assertEquals(
    SMOKE_BUILD.split("\n").slice(0, 2),
    [
      "// Copyright (c) 2026 the Zuke contributors",
      "// SPDX-License-Identifier: MIT",
    ],
  );
});

/** `npm trust list --json` output: one object per publisher, as npm prints it. */
const RELEASE = JSON.stringify(
  {
    id: "abc",
    type: "github",
    file: "release.yml",
    repository: "zuke-build/zuke",
    environment: "npm",
    permissions: ["createPackage"],
  },
  null,
  2,
);
const OTHER = RELEASE.replace("release.yml", "evil.yml");
const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
const fail = (stderr: string) => ({ code: 1, stdout: "", stderr });
const E409 = fail("npm error code E409\nnpm error 409 Conflict - POST ...");

test("trustAll accepts an existing publisher only when it is the release workflow", async () => {
  const errors: string[] = [];
  const listed: string[] = [];
  const failed = await trustAll(
    ["new", "same", "other", "unlisted", "broken", "e4090", "thrown", "gone"],
    {
      trust: (pkg) => {
        if (pkg === "thrown") throw new Error("spawn failed");
        if (pkg === "gone") return Promise.reject(new Error("npm: not found"));
        if (pkg === "new") return Promise.resolve(ok());
        if (pkg === "broken") {
          return Promise.resolve(fail("npm error code E500"));
        }
        // E4090 is not E409.
        if (pkg === "e4090") {
          return Promise.resolve(fail("npm error code E4090"));
        }
        return Promise.resolve(E409);
      },
      list: (pkg) => {
        listed.push(pkg);
        if (pkg === "unlisted") {
          return Promise.resolve({
            code: 1,
            stdout: '{"error":{"code":"E401","summary":"401 Unauthorized"}}',
            stderr: "npm error code E401",
          });
        }
        // Two publishers, the release workflow second.
        return Promise.resolve(
          ok(pkg === "same" ? `${OTHER}\n\n${RELEASE}\n` : OTHER),
        );
      },
    },
    (m) => errors.push(m),
  );
  assertEquals(failed, [
    "other",
    "unlisted",
    "broken",
    "e4090",
    "thrown",
    "gone",
  ]);
  // Only a conflict is listed.
  assertEquals(listed, ["same", "other", "unlisted"]);
  assertEquals(errors, [
    "@zuke-build/other: it has a trusted publisher other than zuke-build/zuke's release.yml in the npm environment allowed to publish; npm trust list @zuke-build/other shows it.",
    "@zuke-build/unlisted: it has a trusted publisher, and npm trust list exited with code 1, so it is not known to be release.yml; 401 Unauthorized; npm error code E401.",
    "@zuke-build/broken: npm trust exited with code 1; npm error code E500.",
    "@zuke-build/e4090: npm trust exited with code 1; npm error code E4090.",
    "@zuke-build/thrown: spawn failed.",
    "@zuke-build/gone: npm: not found.",
  ]);
});

test("jsonValues reads one object after another, and trustsRelease needs every field", () => {
  assertEquals(jsonValues(`noise ${RELEASE}\n{"a":"}"}\n{bad}`).length, 2);
  assertEquals(jsonValues('{"s":"a\\"}"}'), [{ s: 'a"}' }]);
  assertEquals(jsonValues("{ unclosed"), []);
  assertEquals(trustsRelease(RELEASE), true);
  for (
    const [from, to] of [
      ['"github"', '"gitlab"'],
      ['"zuke-build/zuke"', '"zuke-build/fork"'],
      ['"npm"', '"other"'],
      // Allowed only to stage a publish.
      ['"createPackage"', '"createStagedPackage"'],
    ]
  ) {
    assertEquals(trustsRelease(RELEASE.replace(from, to)), false, to);
  }
  assertEquals(trustsRelease(OTHER), false);
  // Permissions that are not a list are no permission.
  const flat = JSON.stringify({
    ...JSON.parse(RELEASE),
    permissions: "createPackage",
  });
  assertEquals(trustsRelease(flat), false);
  assertEquals(trustsRelease(""), false);
});

test("standingOf: published first, then a held dependency or a hold, else due", async () => {
  const probed: string[] = [];
  const registry: PublishRegistry = {
    name: "npm",
    packageName: (pkg) => `@zuke-build/${pkg}`,
    isPublished: (pkg) => Promise.resolve(pkg === "old"),
    held: (pkg) => {
      probed.push(pkg);
      return Promise.resolve(pkg === "gh" ? "changed" : null);
    },
    publish: () => Promise.resolve(),
  };
  const held = new Set<string>();
  const deps = { ai: ["gh"] };
  const of = (pkg: string) => standingOf(pkg, "1.0.0", deps, held, registry);
  // A published version is never probed for a hold.
  assertEquals(await of("old"), { kind: "published" });
  assertEquals(await of("gh"), { kind: "held", reason: "changed" });
  assertEquals(await of("ai"), {
    kind: "held",
    reason: "its dependency @zuke-build/gh waits.",
  });
  assertEquals(await of("core"), { kind: "due" });
  assertEquals(probed, ["gh", "core"]);
  assertEquals([...held], ["gh", "ai"]);
});

test("npmRegistry's publish refuses a changed package itself, without the hold before it", async () => {
  const registry = npmRegistry({
    hasTag: () => Promise.resolve(true),
    changed: () => Promise.resolve(["packages/gh/a.ts"]),
    versionAt: () => Promise.resolve(null),
  });
  await assertRejects(
    () => registry.publish("gh", "1.0.0"),
    Error,
    "packages/gh changed since gh-v1.0.0; npm would get different source",
  );
});

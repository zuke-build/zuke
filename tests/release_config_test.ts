// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../packages/core/tests/_assert.ts";

const PACKAGES = [
  "packages/core",
  "packages/deno",
  "packages/docs",
  "packages/npm",
  "packages/npx",
  "packages/bun",
  "packages/pnpm",
  "packages/yarn",
  "packages/cmd",
  "packages/console",
  "packages/cli",
  "packages/docker",
  "packages/docker-compose",
  "packages/kubectl",
  "packages/helm",
  "packages/kustomize",
  "packages/oxlint",
  "packages/eslint",
  "packages/cspell",
  "packages/jest",
  "packages/vitest",
  "packages/playwright",
  "packages/cypress",
  "packages/biome",
  "packages/knip",
  "packages/dpdm",
  "packages/vite",
  "packages/tsup",
  "packages/turbo",
  "packages/nx",
  "packages/jsr",
  "packages/tsx",
  "packages/tsc",
  "packages/tsc-alias",
  "packages/tsdown",
  "packages/nest",
  "packages/openapi-ts",
  "packages/orval",
  "packages/husky",
  "packages/node",
  "packages/dprint",
  "packages/gcloud",
  "packages/git",
  "packages/gh",
  "packages/codecov",
  "packages/claude",
  "packages/codex",
  "packages/gemini",
  "packages/terraform",
  "packages/tofu",
  "packages/release-please",
  "packages/security",
  "packages/ai",
  "packages/otel",
];

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await Deno.readTextFile(path));
}

const CONFIG = ".release-please-config.json";

Deno.test("release-please config matches the workspace packages", async () => {
  const config = await readJson(CONFIG);
  const packages = config.packages;
  if (packages === null || typeof packages !== "object") {
    throw new Error("config.packages must be an object");
  }
  assertEquals(Object.keys(packages).sort(), [...PACKAGES].sort());
});

Deno.test("the config uses the simple release type", async () => {
  // release-please has no "deno" releaser; the version lives in each package's
  // deno.json, bumped via the simple releaser plus a json extra-files updater.
  const config = await readJson(CONFIG);
  assertEquals(config["release-type"], "simple");
});

Deno.test("manifest versions match each package deno.json", async () => {
  const manifest = await readJson(".release-please-manifest.json");
  for (const path of PACKAGES) {
    const pkg = await readJson(`${path}/deno.json`);
    assertEquals(
      manifest[path],
      pkg.version,
      `manifest ${path} must match ${path}/deno.json version`,
    );
  }
});

Deno.test("extra-file version markers match the manifest version", async () => {
  // A package may list files beyond its deno.json — @zuke/cli embeds its
  // version in src/version.ts so `zuke --version` can print it. release-please
  // rewrites the line tagged `x-release-please-version`, so a version set by
  // hand (a graduation, a bootstrap) has to update it too or the CLI reports a
  // version it no longer has.
  interface ReleaseConfig {
    packages: Record<string, { "extra-files"?: unknown }>;
  }
  const config: ReleaseConfig = JSON.parse(await Deno.readTextFile(CONFIG));
  const manifest = await readJson(".release-please-manifest.json");
  for (const [path, entry] of Object.entries(config.packages)) {
    const extras = entry["extra-files"];
    if (!Array.isArray(extras)) continue;
    for (const extra of extras) {
      // Object entries are the json updaters, which target deno.json's
      // $.version; only the plain string paths carry an inline marker.
      if (typeof extra !== "string") continue;
      const text = await Deno.readTextFile(`${path}/${extra}`);
      const marked = text.split("\n").filter((line) =>
        line.includes("x-release-please-version")
      );
      assertEquals(
        marked.length > 0,
        true,
        `${path}/${extra} is a release-please extra-file but marks no line ` +
          `with x-release-please-version`,
      );
      for (const line of marked) {
        assertEquals(
          line.includes(`"${manifest[path]}"`),
          true,
          `${path}/${extra} must carry version ${manifest[path]}; got: ` +
            line.trim(),
        );
      }
    }
  }
});

Deno.test("every package declares the MIT license", async () => {
  // Per-package license metadata so a published JSR artifact carries its own
  // license rather than relying solely on root inference. Keep it in lock-step
  // with the root LICENSE (MIT).
  for (const path of PACKAGES) {
    const pkg = await readJson(`${path}/deno.json`);
    assertEquals(
      pkg.license,
      "MIT",
      `${path}/deno.json must declare "license": "MIT"`,
    );
  }
});

Deno.test("the deno workspace lists exactly the configured packages", async () => {
  const root = await readJson("deno.json");
  const workspace = root.workspace;
  if (!Array.isArray(workspace)) {
    throw new Error("deno.json workspace must be an array");
  }
  assertEquals(workspace.map(String).sort(), [...PACKAGES].sort());
});

Deno.test("the README package table lists every workspace package", async () => {
  // The README's package tables are the human-facing catalog; a package missing
  // there is invisible to anyone browsing the repo. Enforce it so the six
  // membership lists (workspace, release-please config/manifest, zuke.ts publish
  // loop, this test, and the README) never drift apart.
  const readme = await Deno.readTextFile("README.md");
  const missing = PACKAGES
    .map((path) => path.replace("packages/", ""))
    .filter((name) =>
      !readme.includes(`[\`@zuke/${name}\`](https://jsr.io/@zuke/${name})`)
    );
  assertEquals(
    missing,
    [],
    `README.md package tables are missing: ${missing.join(", ")}`,
  );
});

Deno.test("the build/packages.ts publish list covers every workspace package", async () => {
  // `publishJsr` only iterates this array (defined in build/packages.ts and
  // imported by zuke.ts), so a package missing here is silently never
  // published — guard against that drift (it is what stranded the AI CLI
  // wrappers on JSR).
  const source = await Deno.readTextFile("build/packages.ts");
  const block = source.match(/const PACKAGES = \[([^\]]*)\]/);
  if (block === null) {
    throw new Error("could not find the PACKAGES array in build/packages.ts");
  }
  const names = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assertEquals(
    names.map((name) => `packages/${name}`).sort(),
    [...PACKAGES].sort(),
  );
});

Deno.test("deno.lock captures release-please's full npm tree", async () => {
  // `zuke.ts`'s `release` target provisions release-please through a launcher
  // that runs `deno run --frozen npm:release-please@16.18.0` from the repository
  // root (see `installCli`), so the lock is what pins its transitive tree — and
  // `--frozen` fails the release outright if the specifier is missing from the
  // lock. Assert both the top-level pin and one of its transitive dependencies,
  // so a `deno.lock` regenerated without re-caching that specifier (dropping the
  // tree) is caught here rather than at release time.
  const lock = await Deno.readTextFile("deno.lock");
  if (!lock.includes('"npm:release-please@16.18.0"')) {
    throw new Error(
      'deno.lock is missing the "npm:release-please@16.18.0" specifier pin — ' +
        "run `deno cache npm:release-please@16.18.0` and commit the updated lock.",
    );
  }
  if (!lock.includes('"js-yaml@4.3.0"')) {
    throw new Error(
      "deno.lock is missing release-please's transitive npm tree " +
        '(expected "js-yaml@4.3.0") — run ' +
        "`deno cache npm:release-please@16.18.0` and commit the updated lock.",
    );
  }
});

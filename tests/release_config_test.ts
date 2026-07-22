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
  "packages/tsgo",
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

import { assertEquals } from "../packages/core/tests/_assert.ts";

const PACKAGES = [
  "packages/core",
  "packages/deno",
  "packages/npm",
  "packages/bun",
  "packages/pnpm",
  "packages/yarn",
  "packages/cmd",
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
  "packages/dprint",
  "packages/gcloud",
  "packages/git",
  "packages/gh",
  "packages/terraform",
  "packages/tofu",
  "packages/release-please",
  "packages/security",
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

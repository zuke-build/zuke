import { assertEquals } from "../packages/core/tests/_assert.ts";

const PACKAGES = [
  "packages/core",
  "packages/deno",
  "packages/npm",
  "packages/cmd",
  "packages/cli",
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

Deno.test("the config uses the deno release type", async () => {
  // The version source of truth is each package's deno.json, so the releaser
  // must be "deno" (not "node" — there is no package.json in this repo).
  const config = await readJson(CONFIG);
  assertEquals(config["release-type"], "deno");
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

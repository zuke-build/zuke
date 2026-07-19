/**
 * End-to-end: two real, separate OS processes racing `zuke register` against one
 * shared build registry converge on a single, uncorrupted descriptor — the
 * cross-process compare-and-swap the in-process suite cannot prove. Runs the
 * {@link file://./fixtures/register_build.ts} build as `deno` subprocesses over a
 * shared temp `ZUKE_REGISTRY_DIR`. Excluded from the fast unit gate; runs on the
 * `integration` OS matrix where Windows filesystem-lock semantics get coverage.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import {
  defaultStateHost,
  FileSystemBuildRegistry,
} from "../../packages/core/mod.ts";

const FIXTURE = new URL("./fixtures/register_build.ts", import.meta.url);

/** The captured result of one fixture subprocess. */
interface Run {
  code: number;
  out: string;
}

/** Run the register fixture as a real `deno` subprocess against registry `dir`. */
async function runFixture(args: string[], dir: string): Promise<Run> {
  const command = new Deno.Command(Deno.execPath(), {
    // Pass the fixture as a `file://` URL (deno's native module specifier)
    // rather than URL.pathname, which is `/C:/…` on Windows.
    args: ["run", "-A", FIXTURE.href, ...args],
    // A secret is present in the environment; the descriptor must not carry it.
    env: { ZUKE_REGISTRY_DIR: dir, API_TOKEN: "e2e-secret-xyz" },
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout } = await command.output();
  return { code, out: new TextDecoder().decode(stdout) };
}

Deno.test("two real processes register concurrently; no torn write", async () => {
  const dir = await Deno.makeTempDir({ prefix: "zuke-reg-e2e-" });
  try {
    // Two processes register the same build at once. Idempotent CAS: both
    // succeed (one creates, the other retries onto the created version).
    const [a, b] = await Promise.all([
      runFixture(["register"], dir),
      runFixture(["register"], dir),
    ]);
    assertEquals(a.code, 0);
    assertEquals(b.code, 0);
    assertStringIncludes(a.out, "Registered build");

    // A separate reader loads exactly one, well-formed descriptor — proving the
    // file was never left half-written under the cross-process mutex.
    const registry = new FileSystemBuildRegistry(dir, defaultStateHost);
    const builds = await registry.listBuilds({});
    assertEquals(builds.length, 1);
    const loaded = await registry.getBuild("Catalog");
    assertEquals(loaded?.descriptor.id, "Catalog");
    assertEquals(
      loaded?.descriptor.surface.targets.map((t) => t.name),
      ["lint", "build"],
    );
    // The secret parameter is excluded from the descriptor entirely — neither
    // its flag nor its value appears, so it can never become a spawnable input.
    assertEquals(loaded?.descriptor.surface.parameters, []);
    const json = JSON.stringify(loaded?.descriptor);
    assertEquals(json.includes("api-token"), false);
    assertEquals(json.includes("e2e-secret-xyz"), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

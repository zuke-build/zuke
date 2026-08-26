// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

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
import { withTemp } from "../../packages/core/tests/_temp.ts";
import { runFixture } from "./_harness.ts";

const FIXTURE = new URL("./fixtures/register_build.ts", import.meta.url);

Deno.test("two real processes register concurrently; no torn write", async () => {
  await withTemp(async (dir) => {
    // A secret is present in the environment; the descriptor must not carry it.
    const env = { ZUKE_REGISTRY_DIR: dir, API_TOKEN: "e2e-secret-xyz" };
    // Two processes register the same build at once. Idempotent CAS: both
    // succeed (one creates, the other retries onto the created version).
    const [a, b] = await Promise.all([
      runFixture(FIXTURE, ["register"], env),
      runFixture(FIXTURE, ["register"], env),
    ]);
    // Report what the process said, not just that it failed: this race is the
    // one case in the suite that has flaked on a single OS, and an exit code
    // alone leaves the next occurrence as unexplained as the last.
    assertEquals(a.code, 0, `first registration failed:\n${a.err}${a.out}`);
    assertEquals(b.code, 0, `second registration failed:\n${b.err}${b.out}`);
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
  }, { prefix: "zuke-reg-e2e-" });
});

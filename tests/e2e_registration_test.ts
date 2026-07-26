/**
 * Guards the subprocess e2e suite's registration in `zuke.ts`: the
 * `integration` target must discover `tests/e2e/*_e2e.ts` by glob rather than a
 * hardcoded file list, so a newly added `*_e2e.ts` suite is picked up
 * automatically instead of silently running nowhere.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../packages/core/tests/_assert.ts";
import { glob } from "../packages/core/mod.ts";

const ZUKE_SOURCE = await Deno.readTextFile("zuke.ts");

/** The source text of the `integration` target's field initializer. */
function integrationTargetBody(source: string): string {
  const start = source.indexOf("integration = target()");
  if (start === -1) {
    throw new Error("could not find the `integration` target in zuke.ts");
  }
  const end = source.indexOf("integrationCi = cicd(", start);
  if (end === -1) {
    throw new Error(
      "could not find the end of the `integration` target in zuke.ts",
    );
  }
  return source.slice(start, end);
}

Deno.test("the integration target discovers e2e suites by glob, not a hardcoded list", () => {
  const body = integrationTargetBody(ZUKE_SOURCE);
  assertStringIncludes(body, 'glob("tests/e2e/*_e2e.ts")');
});

Deno.test("glob(tests/e2e/*_e2e.ts) picks up a newly added suite with no code change", async () => {
  const before = await glob("tests/e2e/*_e2e.ts");
  const dummyPath = "tests/e2e/__dummy_e2e.ts";
  await Deno.writeTextFile(
    dummyPath,
    "// temporary fixture for e2e_registration_test.ts\n",
  );
  try {
    const after = await glob("tests/e2e/*_e2e.ts");
    assertEquals(after, [...before, dummyPath].sort());
  } finally {
    await Deno.remove(dummyPath);
  }
});

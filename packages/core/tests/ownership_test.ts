// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for run ownership — which build a run belongs to.
 *
 * The decisions under test are the two that have consequences: resolving this
 * process's origin from the environment, and abstaining rather than refusing
 * when either side has none. An origin that refused on absence would strand runs
 * written before the field existed, which is the worse failure — an effect they
 * owed would never be driven.
 *
 * @module
 */

import { assertEquals, assertStringIncludes, assertThrows } from "./_assert.ts";
import {
  assertOwnsRun,
  ForeignRunError,
  ownsRun,
  resolveBuildId,
} from "../src/ownership.ts";
import type { RunRecord } from "../src/state/types.ts";

const NOW = "2026-08-11T09:00:00.000Z";

/** A minimal record, with `buildId` set only when given. */
function record(buildId?: string): RunRecord {
  return {
    id: "run-1",
    build: "Ci",
    rootTarget: "ci",
    status: "running",
    actor: "runner",
    createdAt: NOW,
    updatedAt: NOW,
    graph: [{ name: "ci", dependsOn: [] }],
    params: {},
    targets: { ci: { status: "succeeded", meta: {} } },
    signals: {},
    events: [],
    ...(buildId === undefined ? {} : { buildId }),
  };
}

/** A `readEnv` over a fixed map. */
function env(
  values: Record<string, string>,
): (name: string) => string | undefined {
  const map = new Map(Object.entries(values));
  return (name) => map.get(name);
}

Deno.test("ZUKE_BUILD_ID wins over the repository", () => {
  // The explicit answer, and the one a container or cron job needs — it has no
  // repository in its environment to fall back to.
  assertEquals(
    resolveBuildId(env({
      ZUKE_BUILD_ID: "acme/api-ci",
      GITHUB_REPOSITORY: "acme/api",
    })),
    "acme/api-ci",
  );
});

Deno.test("the repository is the free default in CI", () => {
  assertEquals(
    resolveBuildId(env({ GITHUB_REPOSITORY: "acme/api" })),
    "acme/api",
  );
});

Deno.test("an empty origin counts as unset", () => {
  // An exported-but-empty variable must not become an origin that matches
  // nothing — that would strand every run it touched.
  assertEquals(
    resolveBuildId(env({ ZUKE_BUILD_ID: "", GITHUB_REPOSITORY: "acme/api" })),
    "acme/api",
  );
  assertEquals(
    resolveBuildId(env({ ZUKE_BUILD_ID: "", GITHUB_REPOSITORY: "" })),
    undefined,
  );
});

Deno.test("no origin at all resolves to undefined", () => {
  assertEquals(resolveBuildId(env({})), undefined);
});

Deno.test("matching origins own the run", () => {
  assertEquals(ownsRun(record("acme/api"), "acme/api"), true);
});

Deno.test("differing origins do not", () => {
  assertEquals(ownsRun(record("acme/api"), "acme/web"), false);
});

Deno.test("an absent origin on either side abstains", () => {
  // The whole reason this is a filter and not a gate: a record written before
  // the field existed, or a process outside CI that sets nothing, must still be
  // recoverable by the shape-based checks that came before.
  assertEquals(ownsRun(record(), "acme/api"), true);
  assertEquals(ownsRun(record("acme/api"), undefined), true);
  assertEquals(ownsRun(record(), undefined), true);
});

Deno.test("the assertion names both origins and the run", () => {
  assertThrows(
    () => assertOwnsRun(record("acme/api"), "acme/web"),
    ForeignRunError,
  );
  // Caught again to narrow: a sweep matches on the class and reads the fields,
  // so both have to be there.
  let caught: unknown;
  try {
    assertOwnsRun(record("acme/api"), "acme/web");
  } catch (error) {
    caught = error;
  }
  assertEquals(caught instanceof ForeignRunError, true);
  if (!(caught instanceof ForeignRunError)) return;
  assertEquals(caught.runId, "run-1");
  assertEquals(caught.owner, "acme/api");
  assertEquals(caught.self, "acme/web");
  assertEquals(caught.name, "ForeignRunError");
  // The operator has to be able to act on it, so the message says how.
  assertStringIncludes(caught.message, "ZUKE_BUILD_ID");
  assertStringIncludes(caught.message, "acme/api");
  assertStringIncludes(caught.message, "acme/web");
});

Deno.test("the assertion abstains exactly where the predicate does", () => {
  assertOwnsRun(record(), "acme/api");
  assertOwnsRun(record("acme/api"), undefined);
  assertOwnsRun(record("acme/api"), "acme/api");
});

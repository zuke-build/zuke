// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `npmVerify`'s reading of the registry: a version's `dist`, and the real
 * source's handling of a missing package and of errors.
 *
 * @module
 */

import { HttpError } from "../packages/core/mod.ts";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../packages/core/tests/_assert.ts";
import { distOf, registrySource } from "../build/npm_registry.ts";
import { SLSA } from "./_npm_verify.ts";

Deno.test("distOf reads a version's integrity and attestations, null when absent, and throws when broken", () => {
  const dist = {
    tarball: "u",
    integrity: "i",
    attestations: { url: "a", provenance: { predicateType: SLSA } },
  };
  const doc = (d: unknown) => ({ versions: { "1.0.0": { dist: d } } });
  assertEquals(distOf(doc(dist), "1.0.0")?.attestations, "a");
  assertEquals(distOf(doc(dist), "1.0.0")?.integrity, "i");
  assertEquals(
    distOf(doc({ tarball: "u", integrity: "i" }), "1.0.0")?.attestations,
    null,
  );
  assertEquals(distOf(doc(dist), "1.0.0")?.manifest, { dist });
  for (const absent of [null, [], {}, { versions: [] }, doc(dist)]) {
    assertEquals(distOf(absent, "2.0.0"), null);
  }
  for (
    const broken of [1, {}, { tarball: "u" }, { integrity: "i" }, {
      tarball: "u",
      integrity: "",
    }]
  ) {
    const bad = distOf.bind(null, doc(broken), "1.0.0");
    try {
      bad();
      throw new Error("distOf accepted a broken dist");
    } catch (error) {
      assertStringIncludes(String(error), "without a usable dist.tarball");
    }
  }
  const wrongType = doc({ ...dist, attestations: { url: "a" } });
  assertEquals(distOf(wrongType, "1.0.0")?.attestations, null);
});

Deno.test("registrySource: 404 is not published, other errors fail, attestations are read", async () => {
  const answer = (status: number, body = "{}"): typeof fetch => () =>
    Promise.resolve(new Response(body, { status }));
  assertEquals(await registrySource(answer(404)).document("x"), null);
  assertEquals(
    await registrySource(answer(200, '{"a":1}')).document("x"),
    { a: 1 },
  );
  await assertRejects(
    () => registrySource(answer(500)).document("x"),
    HttpError,
  );
  assertEquals(
    await registrySource(answer(200, "[2]")).attestations("u"),
    [2],
  );
});

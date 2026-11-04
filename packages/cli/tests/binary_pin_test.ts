// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import {
  BINARY_POSIX_TARGETS,
  BINARY_RELEASES_URL,
  BINARY_WINDOWS_TARGET,
  binaryArchiveName,
  type PinFetch,
  resolveBinaryPin,
} from "../src/binary_pin.ts";

const TARGETS = [...BINARY_POSIX_TARGETS, BINARY_WINDOWS_TARGET];

/** A release's `SHA256SUMS`, one digest per target, plus an unrelated line. */
function manifest(version: string): string {
  return TARGETS.map((target, i) =>
    `${String(i).repeat(64)}  ${binaryArchiveName(version, target)}\n`
  ).join("") + `${"9".repeat(64)}  zuke-${version}.sigstore.json\n`;
}

/** A fetch answering `routes` by URL, and 404 for anything else. */
function routes(answers: Record<string, string>): PinFetch {
  return (url) =>
    Promise.resolve(
      url in answers
        ? new Response(answers[url])
        : new Response("not found", { status: 404 }),
    );
}

const SUMS = `${BINARY_RELEASES_URL}/cli-v2.4.0/SHA256SUMS`;
const ENGINE =
  "https://raw.githubusercontent.com/zuke-build/zuke/cli-v2.4.0/packages/engine/deno.json";

Deno.test("resolveBinaryPin reads every target's digest and the engine at the tag", async () => {
  const pin = await resolveBinaryPin(
    "2.4.0",
    routes({
      [SUMS]: manifest("2.4.0"),
      [ENGINE]: JSON.stringify({ name: "@zuke/engine", version: "1.4.0" }),
    }),
  );
  assertEquals(pin.version, "2.4.0");
  assertEquals(pin.engine, "1.4.0");
  assertEquals(
    TARGETS.map((target) => pin.checksums[target]),
    TARGETS.map((_, i) => String(i).repeat(64)),
  );
});

Deno.test("resolveBinaryPin refuses a release it cannot fully pin", async () => {
  await assertRejects(
    () => resolveBinaryPin("latest", routes({})),
    Error,
    '"latest" is not a zuke release such as 2.4.0',
  );
  await assertRejects(
    () => resolveBinaryPin("2.4.0", routes({})),
    Error,
    `zuke 2.4.0's published binaries could not be read from ${SUMS} (HTTP 404)`,
  );
  const partial = manifest("2.4.0").split("\n").slice(1).join("\n");
  await assertRejects(
    () => resolveBinaryPin("2.4.0", routes({ [SUMS]: partial })),
    Error,
    "lists no digest for zuke-2.4.0-aarch64-apple-darwin.tar.gz",
  );
  await assertRejects(
    () => resolveBinaryPin("2.4.0", routes({ [SUMS]: manifest("2.4.0") })),
    Error,
    "the @zuke/engine release inside zuke 2.4.0 could not be read",
  );
  for (const config of [{ version: "^1" }, ["1.4.0"], {}]) {
    await assertRejects(
      () =>
        resolveBinaryPin(
          "2.4.0",
          routes({
            [SUMS]: manifest("2.4.0"),
            [ENGINE]: JSON.stringify(config),
          }),
        ),
      Error,
      "packages/engine/deno.json names no engine version",
    );
  }
});

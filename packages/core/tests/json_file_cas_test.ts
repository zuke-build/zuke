// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "./_assert.ts";
import { publishFile } from "../src/state/json_file_cas.ts";
import { FakeStateHost } from "./_fakes.ts";
import type { StateHost } from "../src/state/store.ts";

/**
 * A host whose rename fails the first `failures` times, standing in for the
 * Windows sharing violation a concurrent reader causes: the destination has an
 * open handle, so the replace is refused until that read finishes.
 */
function flakyRenameHost(
  failures: number,
  error: () => Error,
): { host: StateHost; attempts: () => number } {
  const inner = new FakeStateHost();
  let attempts = 0;
  const host: StateHost = {
    readText: (path) => inner.readText(path),
    writeText: (path, content) => inner.writeText(path, content),
    createExclusive: (path) => inner.createExclusive(path),
    remove: (path) => inner.remove(path),
    listDir: (path) => inner.listDir(path),
    mkdirp: () => inner.mkdirp(),
    now: () => inner.now(),
    rename: (from, to) => {
      attempts++;
      if (attempts <= failures) return Promise.reject(error());
      return inner.rename(from, to);
    },
  };
  return { host, attempts: () => attempts };
}

/** What Windows raises when the destination is open elsewhere. */
function sharingViolation(): Error {
  return new Deno.errors.PermissionDenied("os error 32");
}

Deno.test("publishFile lands once the reader holding the destination lets go", async () => {
  const { host, attempts } = flakyRenameHost(2, sharingViolation);
  await host.writeText("/runs/run-1.json.tmp-x", "{}");

  await publishFile(host, "/runs/run-1.json.tmp-x", "/runs/run-1.json");

  assertEquals(attempts(), 3); // two refusals, then the rename
  assertEquals(await host.readText("/runs/run-1.json"), "{}");
});

Deno.test("publishFile gives the caller the real error once the budget is spent", async () => {
  const { host, attempts } = flakyRenameHost(
    Number.MAX_SAFE_INTEGER,
    sharingViolation,
  );
  await host.writeText("/runs/run-1.json.tmp-x", "{}");

  const error = await assertRejects(
    () => publishFile(host, "/runs/run-1.json.tmp-x", "/runs/run-1.json"),
    Deno.errors.PermissionDenied,
  );
  // The platform's own message, not one this layer invented on top of it.
  assertEquals(error.message.includes("os error 32"), true);
  assertEquals(attempts(), 5);
});

Deno.test("publishFile does not retry a missing temp file", async () => {
  const { host, attempts } = flakyRenameHost(
    Number.MAX_SAFE_INTEGER,
    () => new Deno.errors.NotFound("rename /runs/run-1.json.tmp-x"),
  );

  // Nothing to publish is a bug in the caller, not a race with a reader:
  // waiting cannot make the temp file appear, so it fails on the first try.
  await assertRejects(
    () => publishFile(host, "/runs/run-1.json.tmp-x", "/runs/run-1.json"),
    Deno.errors.NotFound,
  );
  assertEquals(attempts(), 1);
});

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../packages/core/tests/_assert.ts";
import {
  LOCK_FILE,
  lockDriftMessage,
  lockIsDirty,
  noRepository,
} from "../build/lock_check.ts";

Deno.test("lockIsDirty: a clean listing is not dirty", () => {
  assertEquals(lockIsDirty(""), false);
  assertEquals(lockIsDirty("\n"), false);
});

Deno.test("lockIsDirty: detects the lock in each porcelain status shape", () => {
  // Modified, staged, staged+modified, and untracked all count.
  assertEquals(lockIsDirty(" M deno.lock"), true);
  assertEquals(lockIsDirty("M  deno.lock"), true);
  assertEquals(lockIsDirty("MM deno.lock"), true);
  assertEquals(lockIsDirty("?? deno.lock"), true);
});

Deno.test("lockIsDirty: finds the lock among other changed files", () => {
  const listing = [" M zuke.ts", " M deno.lock", "?? scratch.txt"].join("\n");
  assertEquals(lockIsDirty(listing), true);
});

Deno.test("lockIsDirty: other files alone are not the lock", () => {
  const listing = [" M zuke.ts", " M packages/gh/deno.json"].join("\n");
  assertEquals(lockIsDirty(listing), false);
});

Deno.test("lockIsDirty: a rename is judged by its destination", () => {
  // The lock arriving under the watched name is drift; the lock being renamed
  // away leaves no `deno.lock` entry, so it is not.
  assertEquals(lockIsDirty("R  old.lock -> deno.lock"), true);
  assertEquals(lockIsDirty("R  deno.lock -> old.lock"), false);
});

Deno.test("lockIsDirty: a quoted path (a space in it) is unquoted first", () => {
  assertEquals(lockIsDirty('?? "some dir/deno.lock"'), true);
});

Deno.test("lockIsDirty: a nested lock of the same name counts", () => {
  assertEquals(lockIsDirty(" M vendor/thing/deno.lock"), true);
});

Deno.test("lockIsDirty: a similarly-named file is not the lock", () => {
  assertEquals(lockIsDirty(" M my-deno.lock"), false);
  assertEquals(lockIsDirty(" M deno.lock.bak"), false);
});

Deno.test("lockIsDirty: honours a custom lock file name", () => {
  assertEquals(lockIsDirty(" M other.lock", "other.lock"), true);
  assertEquals(lockIsDirty(" M deno.lock", "other.lock"), false);
});

Deno.test("lockIsDirty: a truncated line cannot index out of bounds", () => {
  assertEquals(lockIsDirty("M"), false);
  assertEquals(lockIsDirty(" M"), false);
  assertEquals(lockIsDirty(" M "), false);
});

Deno.test("noRepository: only a missing repository excuses skipping", () => {
  // The honest skip: there is nothing to compare against.
  assertEquals(
    noRepository(
      "fatal: not a git repository (or any of the parent directories): .git",
    ),
    true,
  );
  // Everything else must be loud. Treating a broken git as "nothing changed"
  // would make this guard incapable of failing while still reporting success —
  // which is worse than having no guard at all.
  assertEquals(
    noRepository("fatal: detected dubious ownership in repository at '/src'"),
    false,
  );
  assertEquals(noRepository("fatal: unable to read index"), false);
  assertEquals(noRepository("error: permission denied"), false);
  assertEquals(noRepository(""), false);
});

Deno.test("lockDriftMessage: names the file and both recovery routes", () => {
  const message = lockDriftMessage();
  assertEquals(message.includes(LOCK_FILE), true);
  assertEquals(message.includes("deno task lock"), true);
  assertEquals(message.includes("git checkout --"), true);
});

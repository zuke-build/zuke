// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "./_assert.ts";
import {
  defaultReadEnv,
  delay,
  messageOf,
  readFileOrNull,
  readTextOrNull,
  runWithTimeout,
  sha256Hex,
  statOrNull,
  writeFileEnsuringDir,
  writeTextEnsuringDir,
} from "../src/internal.ts";
import { withTemp } from "./_temp.ts";

Deno.test("messageOf reads an Error's message, else stringifies", () => {
  assertEquals(messageOf(new Error("boom")), "boom");
  assertEquals(messageOf("plain"), "plain");
  assertEquals(messageOf(42), "42");
});

Deno.test("delay resolves after the given time", async () => {
  const start = performance.now();
  await delay(10);
  assertEquals(performance.now() - start >= 8, true);
});

Deno.test("sha256Hex returns the known lowercase-hex digest", async () => {
  // The canonical SHA-256 of the empty string.
  assertEquals(
    await sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  // Distinct inputs differ; the same input is stable.
  assertEquals(await sha256Hex("a") === await sha256Hex("b"), false);
  assertEquals(await sha256Hex("x"), await sha256Hex("x"));
});

Deno.test("sha256Hex digests bytes the same as the text they encode", async () => {
  const text = "zuke";
  assertEquals(
    await sha256Hex(new TextEncoder().encode(text)),
    await sha256Hex(text),
  );
});

Deno.test("the NotFound readers return null, and the writers create parents", async () => {
  await withTemp(async (root) => {
    assertEquals(await readTextOrNull(`${root}/missing.txt`), null);
    assertEquals(await readFileOrNull(`${root}/missing.bin`), null);
    assertEquals(await statOrNull(`${root}/missing`), null);

    await writeTextEnsuringDir(`${root}/nested/deep/a.txt`, "text");
    assertEquals(await readTextOrNull(`${root}/nested/deep/a.txt`), "text");

    await writeFileEnsuringDir(
      `${root}/nested/deep/b.bin`,
      new Uint8Array([1, 2]),
    );
    assertEquals(
      await readFileOrNull(`${root}/nested/deep/b.bin`),
      new Uint8Array([1, 2]),
    );

    const info = await statOrNull(`${root}/nested`);
    assertEquals(info?.isDirectory, true);
  });
});

Deno.test("a parentless path is written where it is, with no mkdir", async () => {
  // `slash > 0`, not `!== -1`: a bare name has no parent to create, and a
  // root-level path's parent is the root, which already exists. Either would
  // otherwise `Deno.mkdir("")` and throw.
  const cwd = Deno.cwd();
  const root = await Deno.makeTempDir();
  Deno.chdir(root);
  try {
    await writeTextEnsuringDir("bare.txt", "here");
    assertEquals(await readTextOrNull(`${root}/bare.txt`), "here");
  } finally {
    Deno.chdir(cwd);
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("defaultReadEnv reads a set variable through the process env", () => {
  Deno.env.set("ZUKE_INTERNAL_TEST", "value");
  try {
    assertEquals(defaultReadEnv("ZUKE_INTERNAL_TEST"), "value");
  } finally {
    Deno.env.delete("ZUKE_INTERNAL_TEST");
  }
  assertEquals(defaultReadEnv("ZUKE_INTERNAL_TEST_UNSET"), undefined);
});

Deno.test("defaultReadEnv returns undefined when env access is denied (throws)", () => {
  // The whole point of the try/catch: a denied --allow-env must yield undefined,
  // not a thrown PermissionDenied. Stub Deno.env.get to throw, as the test suite
  // itself runs with -A and can't otherwise reach the catch branch.
  const original = Deno.env.get;
  Deno.env.get = () => {
    throw new Deno.errors.PermissionDenied("env access denied");
  };
  try {
    assertEquals(defaultReadEnv("ANYTHING"), undefined);
  } finally {
    Deno.env.get = original;
  }
});

Deno.test("runWithTimeout without a bound runs fn to completion", async () => {
  let ran = false;
  await runWithTimeout(() => {
    ran = true;
  }, undefined);
  assertEquals(ran, true);
});

Deno.test("runWithTimeout resolves when fn finishes within the bound", async () => {
  let ran = false;
  await runWithTimeout(async () => {
    await delay(1);
    ran = true;
  }, 1000);
  assertEquals(ran, true);
});

Deno.test("runWithTimeout rejects with a timeout error when fn overruns", async () => {
  await assertRejects(
    () => runWithTimeout(() => delay(1000), 5),
    Error,
    "timed out after 5ms",
  );
});

Deno.test("runWithTimeout awaits a non-void fn's thenable and discards its value", async () => {
  // A body may return a value (e.g. a *Tasks call's CommandOutput promise);
  // the result is awaited — so a timeout still bounds it — then dropped.
  let settled = false;
  const out = await runWithTimeout(async () => {
    await delay(1);
    settled = true;
    return 42;
  }, 1000);
  assertEquals(settled, true);
  assertEquals(out, undefined);
});

Deno.test("runWithTimeout discards a returned value on the no-bound (undefined timeout) path", async () => {
  // The unbounded branch returns the mapped promise directly, so its own
  // `.then(() => undefined)` — not the timeout branch's `resolve()` — is what
  // drops the value here.
  const out = await runWithTimeout(
    () => Promise.resolve({ code: 0 }),
    undefined,
  );
  assertEquals(out, undefined);
});

Deno.test("runWithTimeout propagates a rejection from fn", async () => {
  await assertRejects(
    () => runWithTimeout(() => Promise.reject(new Error("inner")), 1000),
    Error,
    "inner",
  );
});

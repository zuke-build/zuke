import { assertEquals, assertRejects } from "./_assert.ts";
import {
  defaultReadEnv,
  delay,
  messageOf,
  runWithTimeout,
  sha256Hex,
} from "../src/internal.ts";

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

Deno.test("runWithTimeout propagates a rejection from fn", async () => {
  await assertRejects(
    () => runWithTimeout(() => Promise.reject(new Error("inner")), 1000),
    Error,
    "inner",
  );
});

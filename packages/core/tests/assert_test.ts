import { assertEquals, assertRejects, assertThrows } from "./_assert.ts";
import {
  assert,
  assertDirectoryExists,
  assertExists,
  assertFileExists,
  AssertionError,
  fail,
} from "../src/assert.ts";

Deno.test("fail always throws an AssertionError with the message", () => {
  assertThrows(() => fail("nope"), AssertionError, "nope");
});

Deno.test("assert passes on truthy, throws on falsy", () => {
  assert(1 === 1); // no throw
  assert("x", "should pass");
  assertThrows(() => assert(false, "bad"), AssertionError, "bad");
  // Default message when none supplied.
  assertThrows(() => assert(0), AssertionError, "Assertion failed");
});

Deno.test("assertExists returns the value and narrows it", () => {
  assertEquals(assertExists("hello"), "hello");
  assertEquals(assertExists(0), 0); // 0 is present, not nullish
  assertEquals(assertExists(false), false);
  assertThrows(
    () => assertExists(null, "missing"),
    AssertionError,
    "missing",
  );
  assertThrows(() => assertExists(undefined), AssertionError, "present");
});

Deno.test("assertFileExists: passes for a file, fails for missing or a dir", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = `${dir}/a.txt`;
    await Deno.writeTextFile(file, "hi");
    await assertFileExists(file); // no throw
    await assertRejects(
      () => assertFileExists(`${dir}/missing.txt`),
      AssertionError,
      "Expected file to exist",
    );
    await assertRejects(
      () => assertFileExists(dir),
      AssertionError,
      "Expected a file",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("filesystem asserts rethrow non-NotFound stat errors", async () => {
  // A NUL byte makes Deno.stat reject with a TypeError, not NotFound, which
  // must propagate rather than be reported as a missing path.
  await assertRejects(() => assertFileExists("bad\0path"), TypeError);
  await assertRejects(() => assertDirectoryExists("bad\0path"), TypeError);
});

Deno.test("assertDirectoryExists: passes for a dir, fails for missing or a file", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await assertDirectoryExists(dir); // no throw
    const file = `${dir}/a.txt`;
    await Deno.writeTextFile(file, "hi");
    await assertRejects(
      () => assertDirectoryExists(`${dir}/missing`),
      AssertionError,
      "Expected directory to exist",
    );
    await assertRejects(
      () => assertDirectoryExists(file),
      AssertionError,
      "Expected a directory",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

/**
 * Self-tests for the local assertion helper. `deepEqual` once compared only
 * `Object.keys`, so any two `Set`s / `Map`s / `Date`s (which expose no
 * enumerable keys) were treated as equal — a silent blind spot that let
 * Set-comparing tests pass vacuously. These lock in structural comparison of
 * those built-ins and a loud failure for any type the helper can't compare.
 */

import { assertEquals, assertThrows } from "./_assert.ts";

Deno.test("assertEquals compares Sets by membership, not vacuously", () => {
  assertEquals(new Set(["a", "b"]), new Set(["b", "a"])); // order-independent
  assertThrows(
    () => assertEquals(new Set(["a"]), new Set(["b", "c"])),
    Error,
    "not equal",
  );
  assertThrows(
    () => assertEquals(new Set(["a"]), new Set(["b"])),
    Error,
    "not equal",
  );
  // Object members: a one-to-one matching, not a subset. Two distinct `{n:1}`
  // refs must not both match the single `{n:1}` in the other set.
  assertEquals(new Set([{ n: 1 }, { n: 2 }]), new Set([{ n: 2 }, { n: 1 }]));
  assertThrows(
    () =>
      assertEquals(
        new Set([{ n: 1 }, { n: 1 }]),
        new Set([{ n: 1 }, { n: 2 }]),
      ),
    Error,
    "not equal",
  );
});

Deno.test("assertEquals compares Maps by key and deep value", () => {
  assertEquals(new Map([["k", { n: 1 }]]), new Map([["k", { n: 1 }]]));
  assertThrows(
    () => assertEquals(new Map([["k", 1]]), new Map([["k", 2]])),
    Error,
    "not equal",
  );
  assertThrows(
    () => assertEquals(new Map([["k", 1]]), new Map([["j", 1]])),
    Error,
    "not equal",
  );
});

Deno.test("assertEquals compares Dates by instant", () => {
  assertEquals(
    new Date("2026-01-01T00:00:00Z"),
    new Date("2026-01-01T00:00:00Z"),
  );
  assertThrows(
    () => assertEquals(new Date(0), new Date(1000)),
    Error,
    "not equal",
  );
});

Deno.test("assertEquals compares Uint8Arrays element-wise", () => {
  assertEquals(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]));
  assertThrows(
    () => assertEquals(new Uint8Array([1, 2]), new Uint8Array([1, 3])),
    Error,
    "not equal",
  );
  assertThrows(
    () => assertEquals(new Uint8Array([1]), new Uint8Array([1, 2])),
    Error,
    "not equal",
  );
});

Deno.test("assertEquals throws on an opaque type it cannot structurally compare", () => {
  assertThrows(
    () => assertEquals(/a/, /a/),
    Error,
    "cannot structurally compare",
  );
});

Deno.test("assertEquals compares plain objects and arrays structurally", () => {
  assertEquals({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } });
  assertEquals({}, {});
  assertEquals([1, [2, 3]], [1, [2, 3]]);
  assertThrows(
    () => assertEquals({ a: 1 }, { a: 1, b: 2 }),
    Error,
    "not equal",
  );
  assertThrows(() => assertEquals({ a: 1 }, { a: 2 }), Error, "not equal");
  assertThrows(() => assertEquals({ a: 1 }, { b: 1 }), Error, "not equal");
});

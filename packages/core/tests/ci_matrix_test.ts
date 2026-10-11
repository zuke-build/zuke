// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "./_assert.ts";
import { expandMatrix, hasMatrix, isSparse } from "../src/ci_matrix.ts";

Deno.test("expandMatrix: axes alone are their cartesian product", () => {
  assertEquals(
    expandMatrix("t", { matrix: { os: ["linux", "mac"], node: [22, 24] } }),
    [
      { os: "linux", node: 22 },
      { os: "linux", node: 24 },
      { os: "mac", node: 22 },
      { os: "mac", node: 24 },
    ],
  );
});

Deno.test("expandMatrix: include-only rows are the matrix", () => {
  // The Forge case: four Node lines on Ubuntu and one on macOS — five jobs, not
  // the eight a Node × OS product would run.
  const rows = [
    { node: "22.22.2", os: "ubuntu-latest" },
    { node: "22", os: "ubuntu-latest" },
    { node: "24", os: "ubuntu-latest" },
    { node: "26", os: "ubuntu-latest" },
    { node: "26", os: "macos-latest" },
  ];
  assertEquals(expandMatrix("t", { matrixInclude: rows }), rows);
});

Deno.test("expandMatrix: exclude rows are partial matches over the axes", () => {
  assertEquals(
    expandMatrix("t", {
      matrix: { os: ["linux", "mac", "win"], node: [22, 24] },
      matrixExclude: [{ os: "win" }, { os: "mac", node: 22 }],
    }),
    [
      { os: "linux", node: 22 },
      { os: "linux", node: 24 },
      { os: "mac", node: 24 },
    ],
  );
});

Deno.test("expandMatrix: follows GitHub's documented include example", () => {
  // Verbatim from GitHub's "Expanding or adding matrix configurations" docs:
  // a row extends every combination it does not contradict on an original
  // axis, an added value may be overwritten by a later row, and a row that
  // fits nothing — even one fitting a row an earlier include created — becomes
  // its own combination.
  assertEquals(
    expandMatrix("t", {
      matrix: { fruit: ["apple", "pear"], animal: ["cat", "dog"] },
      matrixInclude: [
        { color: "green" },
        { color: "pink", animal: "cat" },
        { fruit: "apple", shape: "circle" },
        { fruit: "banana" },
        { fruit: "banana", animal: "cat" },
      ],
    }),
    [
      { fruit: "apple", animal: "cat", color: "pink", shape: "circle" },
      { fruit: "apple", animal: "dog", color: "green", shape: "circle" },
      { fruit: "pear", animal: "cat", color: "pink" },
      { fruit: "pear", animal: "dog", color: "green" },
      { fruit: "banana" },
      { fruit: "banana", animal: "cat" },
    ],
  );
});

Deno.test("expandMatrix: exclude applies before include", () => {
  // An excluded combination is gone before include runs, so a row matching it
  // is added back as a combination of its own rather than resurrecting it.
  assertEquals(
    expandMatrix("t", {
      matrix: { os: ["linux", "win"] },
      matrixExclude: [{ os: "win" }],
      matrixInclude: [{ os: "win", experimental: "yes" }],
    }),
    [{ os: "linux" }, { os: "win", experimental: "yes" }],
  );
});

Deno.test("expandMatrix: an exclude key that is not an axis is refused", () => {
  assertThrows(
    () =>
      expandMatrix("test", {
        matrix: { os: ["linux"] },
        matrixExclude: [{ node: 22 }],
      }),
    Error,
    `job "test" excludes on "node", which is not one of its matrix axes`,
  );
});

Deno.test("expandMatrix: a matrix with nothing left to run is refused", () => {
  assertThrows(
    () =>
      expandMatrix("test", {
        matrix: { os: ["linux"] },
        matrixExclude: [{ os: "linux" }],
      }),
    Error,
    `job "test" declares a matrix with no combinations left`,
  );
  // An axis with no values empties the product too.
  assertThrows(
    () => expandMatrix("test", { matrix: { os: [] } }),
    Error,
    "no combinations left",
  );
});

Deno.test("hasMatrix and isSparse read all three parts", () => {
  assertEquals(hasMatrix({}), false);
  assertEquals(hasMatrix({ matrix: { os: ["linux"] } }), true);
  assertEquals(hasMatrix({ matrixInclude: [{ os: "linux" }] }), true);
  assertEquals(hasMatrix({ matrixExclude: [{ os: "linux" }] }), true);
  assertEquals(isSparse({ matrix: { os: ["linux"] } }), false);
  assertEquals(isSparse({ matrixInclude: [] }), true);
  assertEquals(isSparse({ matrixExclude: [] }), true);
});

Deno.test("expandMatrix: an axis named like GitHub's row lists is refused", () => {
  assertThrows(
    () => expandMatrix("test", { matrix: { exclude: ["a"] } }),
    Error,
    `job "test" has a matrix axis named "exclude"`,
  );
});

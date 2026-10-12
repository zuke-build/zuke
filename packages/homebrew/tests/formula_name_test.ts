// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for formula-name validation and the class-name derivation ported
 * from Homebrew's `Formulary.class_s`. The expected class names are the ones
 * homebrew-core's own formula files define.
 *
 * @module
 */

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import { formulaClassName } from "../src/formula_name.ts";

Deno.test("formula name: class names match Homebrew's derivation", () => {
  const table: Array<[string, string]> = [
    ["zuke", "Zuke"],
    ["foo-bar", "FooBar"],
    ["foo_bar", "FooBar"],
    ["foo.bar", "FooBar"],
    ["foo@2", "FooAT2"],
    ["python@3.12", "PythonAT312"],
    ["openssl@3", "OpensslAT3"],
    ["gtk+", "Gtkx"],
    ["gtk+3", "Gtkx3"],
    ["x264", "X264"],
    ["lib-2to3", "Lib2to3"],
    ["node@22-lts", "NodeAT22Lts"],
    ["a1-b2_c3.d4", "A1B2C3D4"],
  ];
  for (const [name, expected] of table) {
    assertEquals(formulaClassName(name), expected, name);
  }
});

Deno.test("formula name: a path, a capital, a leading digit or a separator is refused", () => {
  for (
    const name of [
      "",
      "../zuke",
      "a/b",
      "Zuke",
      "2fa",
      "-zuke",
      "zuke rb",
      "zuke\n",
      "zu‮ke",
    ]
  ) {
    assertThrows(
      () => formulaClassName(name),
      Error,
      "invalid formula name",
    );
  }
});

Deno.test("formula name: a derivation that is not a Ruby constant is refused", () => {
  for (const name of ["foo--bar", "foo@bar", "foo-", "foo.", "foo_@2"]) {
    assertThrows(
      () => formulaClassName(name),
      Error,
      "which is not a Ruby",
    );
  }
});

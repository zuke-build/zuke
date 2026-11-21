// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import { DEFAULT_RUNTIME, runtimeNamed } from "../src/runtime_field.ts";

Deno.test("runtimeNamed reads zuke.json's runtime, deno by default", () => {
  assertEquals(runtimeNamed('{"runtime":"node"}'), "node");
  assertEquals(runtimeNamed('{"runtime":"deno","build":"build.ts"}'), "deno");
  // No field, not an object, not JSON: the default, as for the build file.
  for (const text of ['{"build":"build.ts"}', "[]", "", "{"]) {
    assertEquals(runtimeNamed(text), DEFAULT_RUNTIME);
  }
  assertEquals(DEFAULT_RUNTIME, "deno");
});

Deno.test("runtimeNamed refuses a runtime Zuke does not run on, naming the field", () => {
  for (const value of ['"bun"', '"Node"', "1", "null", '["node"]']) {
    assertThrows(
      () => runtimeNamed(`{"runtime":${value}}`),
      Error,
      `zuke.json's 'runtime' is ${value}; it names the runtime`,
    );
  }
});

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { greet } from "./mod.ts";

Deno.test("greets by name", () => {
  assert.equal(greet("Zuke"), "Hello, Zuke!");
});

Deno.test("greets the world when the name is blank", () => {
  assert.equal(greet(), "Hello, world!");
  assert.equal(greet("   "), "Hello, world!");
});

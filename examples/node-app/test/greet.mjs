// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";
import { greet } from "../greet.mjs";

test("greets by name", () => {
  assert.equal(greet("Zuke"), "Hello, Zuke!");
});

test("greets the world when the name is blank", () => {
  assert.equal(greet(), "Hello, world!");
  assert.equal(greet("   "), "Hello, world!");
});

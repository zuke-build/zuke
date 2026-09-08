// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { clamp } from "./mod.ts";

Deno.test("clamp keeps a value inside the range", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
});

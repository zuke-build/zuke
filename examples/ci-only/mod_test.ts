// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { add } from "./mod.ts";

Deno.test("adds", () => {
  assert.equal(add(2, 2), 4);
});

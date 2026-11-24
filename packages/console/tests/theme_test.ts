// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "../../core/tests/_testing.ts";
import {
  defaultTheme,
  LEVEL_MARKS,
  type Theme,
  themeTags,
} from "../src/theme.ts";
import { assertEquals } from "../../core/tests/_assert.ts";

test("themeTags exposes every palette token as a markup tag", () => {
  const custom: Theme = { ...defaultTheme, success: ["blue", "bold"] };
  const tags = themeTags(custom);
  assertEquals(tags.success, ["blue", "bold"]);
  assertEquals(tags.error, defaultTheme.error);
});

test("LEVEL_MARKS pairs an icon with a palette token per level", () => {
  assertEquals(LEVEL_MARKS.success.icon, "✔");
  assertEquals(LEVEL_MARKS.success.token, "success");
  assertEquals(LEVEL_MARKS.error.token, "error");
});

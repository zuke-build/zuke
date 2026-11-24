// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The Node lane's test run: every `*_test.ts` of the packages and of
 * `tests/`, registered through `tests/_testing.ts`, except the
 * files `tests/node_pending.json` lists. Those still call Deno's APIs
 * directly, and each leaves the list once it is ported; the Deno lane runs
 * every file meanwhile.
 */

import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const pending: string[] = JSON.parse(
  readFileSync(new URL("./tests/node_pending.json", import.meta.url), "utf8"),
);

export default defineConfig({
  test: {
    include: ["packages/*/tests/**/*_test.ts", "tests/**/*_test.ts"],
    exclude: ["**/node_modules/**", ...pending],
  },
});

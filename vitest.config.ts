// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The gate's test run on Node: every `*_test.ts` of the packages and of
 * `tests/`, registered through `tests/_testing.ts`, and its coverage gate.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [{
      // The examples import `jsr:@zuke/<name>@<range>`, which Deno resolves to
      // the workspace member; Node takes the same member from node_modules.
      find: /^jsr:@zuke\/([a-z0-9-]+)@[^/]+(\/.*)?$/,
      replacement: "@zuke/$1$2",
    }],
  },
  test: {
    include: ["packages/*/tests/**/*_test.ts", "tests/**/*_test.ts"],
    exclude: ["**/node_modules/**"],
    // The gate's coverage (#993): all the suite loads but the tests, at 95% of
    // lines and branches overall, and a 50% line floor per file of the
    // packages, so a neglected one cannot hide in the average. The floor
    // leaves out build/, whose Deno-only tests skip here: the Deno lane runs
    // the `coverage` target, which holds every file to it.
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcovonly"],
      reportsDirectory: "coverage",
      exclude: ["**/tests/**", "**/node_modules/**"],
      thresholds: {
        lines: 95,
        branches: 95,
        "packages/**": { lines: 50, perFile: true },
      },
    },
  },
});

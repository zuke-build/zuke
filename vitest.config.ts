// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The Node lane's test run: every `*_test.ts` of the packages and of
 * `tests/`, registered through `tests/_testing.ts`.
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
  },
});

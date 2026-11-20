// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The pieces of the `npmSmoke` target (`build.ts`): compile `core`, `deno` and `cli`
 * (with its `console` and `gh`) into a temporary directory, pack them, install the tarballs into a scratch
 * consumer under their `@zuke/*` aliases, and run a tiny build under real
 * Node. The target does the running; this holds what can be tested without a
 * registry.
 */

/** The packages the smoke test compiles: core, a wrapper that uses it, and the CLI with the two packages it needs. */
export const SMOKE_PACKAGES: readonly string[] = [
  "core",
  "console",
  "gh",
  "deno",
  "cli",
];

/** The consumer's build: it imports both aliases and runs a target. */
export const SMOKE_BUILD = `// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { Build, run, target } from "@zuke/core";
import { DenoTasks } from "@zuke/deno";
class Mini extends Build {
  hello = target().executes(() => {
    console.log("hello from " + typeof DenoTasks.test);
  });
}
await run(Mini);
`;

/**
 * The consumer's `package.json`. `tarballs` maps `@zuke/<name>` to the file
 * URL of its tarball. Each is a dependency under its alias and also an
 * override, so a dependency one package declares on another
 * (`npm:@zuke-build/core`) is satisfied by the local tarball and nothing is
 * fetched from the registry.
 */
export function consumerManifest(
  tarballs: Readonly<Record<string, string>>,
): Record<string, unknown> {
  if (tarballs["@zuke/core"] === undefined) {
    throw new Error("the consumer needs @zuke/core.");
  }
  return {
    private: true,
    type: "module",
    dependencies: tarballs,
    overrides: tarballs,
  };
}

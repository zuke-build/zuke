// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The pieces of the `npmSmoke` target (`build.ts`): compile `core` and `deno`
 * into a temporary directory, pack them, install the tarballs into a scratch
 * consumer under their `@zuke/*` aliases, and run a tiny build under real
 * Node. The target does the running; this holds what can be tested without a
 * registry.
 */

/** The packages the smoke test compiles: core, and one wrapper that uses it. */
export const SMOKE_PACKAGES = ["core", "deno"] as const;

/** The consumer's build: it imports both aliases and runs a target. */
export const SMOKE_BUILD = `import { Build, run, target } from "@zuke/core";
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
 * URL of its tarball. Each is a dependency under its alias, and `core` is also
 * an override, so the dependency `deno` declares on `npm:@zuke-build/core` is
 * satisfied by the local tarball and nothing is fetched from the registry.
 */
export function consumerManifest(
  tarballs: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const core = tarballs["@zuke/core"];
  if (core === undefined) throw new Error("the consumer needs @zuke/core.");
  return {
    private: true,
    type: "module",
    dependencies: tarballs,
    overrides: { "@zuke/core": core },
  };
}

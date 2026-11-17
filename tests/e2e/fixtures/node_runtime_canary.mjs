// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Run under real Node by `node_process_e2e.ts`: core's runtime seam, loaded
 * as TypeScript source. The test starts this file by its own path and
 * through a symlink to it, with and without Node resolving the link; every
 * way the entry module must be this file.
 */

import assert from "node:assert/strict";
import process from "node:process";

// The test says where core is: started through a link Node does not
// resolve, this file's own URL is the link's, somewhere else entirely.
const core = new URL(process.argv[2]);
const { denoPath, mainModule, ON_DENO, runtimeFacts } = await import(
  new URL("runtime.ts", core).href
);
const { isEntryModule } = await import(new URL("entry.ts", core).href);

assert.equal(ON_DENO, false);
assert.deepEqual(runtimeFacts(), {
  name: "node",
  version: process.versions.node,
  typescript: undefined,
  standalone: false,
});
assert.equal(denoPath(), null);
// However it was started, the entry is named as Node names this file.
assert.equal(mainModule(), import.meta.url);
// What `run` asks: this file called it, and this file is the entry.
assert.equal(isEntryModule(new Error().stack, "file:///elsewhere.ts"), true);
assert.equal(
  isEntryModule(new Error().stack, "file:///elsewhere.ts", "file:///b.ts"),
  false,
);

console.log("node runtime canary ok");

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Run under real Node by `node_process_e2e.ts`: every entry point of
 * `@zuke/core`, loaded as TypeScript source. Node only strips types, so a
 * construct that needs compiling, such as a constructor parameter that
 * declares a field, fails the import here. Then the readiness probe, whose
 * module could not load under Node before, against a port that is open and
 * one that is not.
 */

import assert from "node:assert/strict";
import { createServer } from "node:net";

const core = new URL("../../../packages/core/", import.meta.url);
const ENTRIES = [
  "mod.ts",
  "src/shell.ts",
  "src/tooling.ts",
  "src/tooling_conformance.ts",
  "src/render.ts",
  "src/conformance.ts",
];
for (const entry of ENTRIES) await import(new URL(entry, core).href);

const { tcpReachable } = await import(new URL("mod.ts", core).href);
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const open = server.address().port;
assert.equal(await tcpReachable(`127.0.0.1:${open}`), true);
await new Promise((resolve) => server.close(resolve));
assert.equal(await tcpReachable(`127.0.0.1:${open}`), false);

console.log("node core canary ok");

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Phase 0 spike of the engine/worker split: run a build that another process
 * describes over a loopback socket, on the unmodified `@zuke/core` engine.
 *
 *   deno run -A spike/engine/mod.ts --list
 *   deno run -A spike/engine/mod.ts <target>
 *
 * `zuke.json` names the worker: `{ "sdk": { "command": ["python3", "build.py"] } }`.
 *
 * @module
 */

import { CONFIG_FILE, repoRoot, run } from "@zuke/core";
import { sdkCommand } from "./src/config.ts";
import { WorkerHost } from "./src/host.ts";
import { materialize } from "./src/materialize.ts";

const root = repoRoot();
const config = root(CONFIG_FILE).path;
const host = await WorkerHost.start({
  command: sdkCommand(await Deno.readTextFile(config), config),
  cwd: root.path,
});
await run(materialize(await host.describe(), host));

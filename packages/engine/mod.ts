// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/engine` — the engine for a build another process hosts. An SDK in
 * any language is a **worker**: it describes the build's graph as a manifest
 * over a loopback socket and runs a target body when asked, while scheduling,
 * every subprocess, run records, resume, locks, caching, services, CI
 * generation and the MCP server stay in `@zuke/core`.
 *
 * A project with no `zuke.ts` names its worker and the engine release that
 * runs it in `zuke.json`:
 *
 * ```json
 * { "name": "App", "sdk": { "command": ["uv", "run", "build.py"] }, "engine": "1.0.0" }
 * ```
 *
 * The `./zuke` launcher and the global `zuke` command then run
 * `deno run -A jsr:@zuke/engine@1.0.0 <args>` from the project root, so the
 * whole CLI — targets, `--list --json`, `graph`, `generate-ci`, `mcp`,
 * `resume` — is the engine's, with the worker serving the bodies.
 *
 * Imported as a library, the module exports the host-mode pieces a
 * TypeScript program can drive itself: {@link WorkerHost} starts a worker
 * and speaks the protocol, {@link materialize} turns its manifest into a
 * `Build` subclass `run` accepts.
 *
 * @module
 */

import { CONFIG_FILE, repoRoot, run } from "@zuke/core";
import { sdkCommand } from "./src/config.ts";
import { WorkerHost } from "./src/host.ts";
import { materialize } from "./src/materialize.ts";

export { sdkCommand } from "./src/config.ts";
export { WorkerHost, type WorkerOptions } from "./src/host.ts";
export { materialize, type TargetRunner } from "./src/materialize.ts";
export type { ManifestCi, ManifestCiInvocation } from "./src/ci.ts";
export {
  type ConfigureParams,
  type Duration,
  type HookName,
  type LateSettings,
  type LockSpec,
  type Manifest,
  type ManifestConfig,
  type ManifestGroup,
  type ManifestHooks,
  type ManifestParameter,
  type ManifestParameterBase,
  type ManifestRetry,
  type ManifestTarget,
  parseManifest,
  PROTOCOL_VERSION,
  type ValidateDuringSpec,
  type WaitSpec,
  type WaitTriggerSpec,
} from "./src/protocol.ts";

// Run only as the program `deno run jsr:@zuke/engine` starts: imported as a
// library, nothing spawns.
if (import.meta.main) {
  const root = repoRoot();
  const config = root(CONFIG_FILE).path;
  const host = await WorkerHost.start({
    command: sdkCommand(await Deno.readTextFile(config), config),
    cwd: root.path,
    // The MCP server runs build after build in one process, so the next
    // worker is spawned as each run ends; core names the command the same way,
    // by any bare `mcp` argument.
    prewarm: Deno.args.includes("mcp"),
  });
  await run(materialize(await host.describe(), host));
}

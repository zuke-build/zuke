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
 * The `./zuke` launcher runs `deno run -A jsr:@zuke/engine@1.0.0 <args>`
 * from the project root, and the global `zuke` binary runs the engine
 * compiled into it, so the whole CLI — targets, `--list --json`, `graph`,
 * `generate-ci`, `mcp`, `resume` — is the engine's, with the worker serving
 * the bodies.
 *
 * Imported as a library, the module exports the host-mode pieces a
 * TypeScript program can drive itself: {@link WorkerHost} starts a worker
 * and speaks the protocol, {@link materialize} turns its manifest into a
 * `Build` subclass `run` accepts, and {@link hostedBuild} does both for the
 * project's `zuke.json`. The global `zuke` binary is such a program: it is
 * compiled with this engine and every wrapper release, which
 * {@link embeddedTools} serves `tool.call`s from, so a Python build runs
 * with no Deno installed.
 *
 * @module
 */

import { run } from "@zuke/core";
import { hostedBuild } from "./src/hosted.ts";

export { sdkCommand } from "./src/config.ts";
export {
  type EmbeddedRelease,
  embeddedTools,
  servesRelease,
} from "./src/embedded.ts";
export { hostedBuild } from "./src/hosted.ts";
export { WorkerHost, type WorkerOptions } from "./src/host.ts";
export { materialize, type TargetRunner } from "./src/materialize.ts";
export { importTool, type SpawnBase, type ToolResolver } from "./src/tools.ts";
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
  parseToolCall,
  PROTOCOL_VERSION,
  type ToolCall,
  type ValidateDuringSpec,
  type WaitSpec,
  type WaitTriggerSpec,
} from "./src/protocol.ts";

// Run only as the program `deno run jsr:@zuke/engine` starts: imported as a
// library, nothing spawns.
if (import.meta.main) {
  await run(await hostedBuild());
}

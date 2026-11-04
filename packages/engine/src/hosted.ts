// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The build a project with no `zuke.ts` runs: the worker its `zuke.json`
 * names, started and described, as a `Build` subclass core's `run` accepts.
 * Both programs that run the engine start here: `deno run jsr:@zuke/engine`,
 * whose wrappers are imported from JSR, and the global `zuke` binary, whose
 * wrappers are the releases compiled into it.
 *
 * @module
 */

import { type Build, CONFIG_FILE, repoRoot } from "@zuke/core";
import { sdkCommand } from "./config.ts";
import { WorkerHost } from "./host.ts";
import { materialize } from "./materialize.ts";
import type { ToolResolver } from "./tools.ts";

/**
 * Start the worker the `zuke.json` above the working directory names, and
 * materialise the build it describes. `tools` resolves a `tool.call`'s
 * wrapper release, a `jsr:` import when omitted.
 */
export async function hostedBuild(
  tools?: ToolResolver,
): Promise<new () => Build> {
  const root = repoRoot();
  const config = root(CONFIG_FILE).path;
  const host = await WorkerHost.start({
    command: sdkCommand(await Deno.readTextFile(config), config),
    cwd: root.path,
    // The MCP server runs build after build in one process, so the next
    // worker is spawned as each run ends; core names the command the same way,
    // by any bare `mcp` argument.
    prewarm: Deno.args.includes("mcp"),
    tools,
  });
  return materialize(await host.describe(), host);
}

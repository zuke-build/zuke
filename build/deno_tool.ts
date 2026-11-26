// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The Deno the build's own Deno steps run: the release the launchers pin,
 * provisioned into the build's tool directory, so `apiDocs`, `docLint`,
 * `apiReference` and `publishJsr` need no Deno on PATH, and keep working once
 * the gate runs on Node (#993).
 *
 * @module
 */

import { type AbsolutePath, ToolTasks } from "@zuke/core";
import { denoTool } from "./scanners.ts";
import { TOOLS_ROOT } from "./publish.ts";

let installed: Promise<AbsolutePath> | undefined;

/**
 * The path of the pinned Deno, downloaded, checksum-verified and cached on
 * first use. The install is shared by every caller in the run, since targets
 * run in parallel and two installs would race to write the same file.
 */
export async function provisionedDeno(): Promise<string> {
  installed ??= ToolTasks.install((s) => denoTool(s).destDir(TOOLS_ROOT));
  return (await installed).path;
}

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The Deno the build's own Deno steps run (`deno doc`, `deno lint`, `deno
 * check` of the examples and snippets, `deno publish`), so they need no Deno on
 * PATH and keep working with the gate on Node (#993). On Deno that is the
 * running Deno, which the launchers start at the pinned release; on Node it is
 * that release, provisioned into the build's tool directory.
 *
 * @module
 */

import {
  type AbsolutePath,
  type RuntimeFacts,
  RuntimeTasks,
  ToolTasks,
} from "@zuke/core";
import { denoTool } from "./scanners.ts";
import { TOOLS_ROOT } from "./publish.ts";

/**
 * Share one install across every caller: targets run in parallel, and two
 * installs would race to write the same file. A failed install rejects every
 * caller of the run rather than being retried.
 */
export function sharedInstall(
  install: () => Promise<AbsolutePath>,
): () => Promise<string> {
  let installed: Promise<AbsolutePath> | undefined;
  return async () => {
    installed ??= install();
    return (await installed).path;
  };
}

/**
 * The running Deno when the build runs on one, and otherwise the pinned one.
 * A compiled `zuke` binary has Deno inside it but is not a `deno` command, so
 * it takes the pin as Node does.
 */
export function runningOrPinned(
  runtime: RuntimeFacts,
  execPath: string,
  pinned: () => Promise<string>,
): Promise<string> {
  return runtime.name === "deno" && !runtime.standalone
    ? Promise.resolve(execPath)
    : pinned();
}

/** The pinned Deno, downloaded, checksum-verified and cached once per run. */
const pinnedDeno = sharedInstall(() =>
  ToolTasks.install((s) => denoTool(s).destDir(TOOLS_ROOT))
);

/** The path of the Deno the build's Deno steps run; see the module doc. */
export const provisionedDeno = (): Promise<string> =>
  runningOrPinned(RuntimeTasks.facts(), RuntimeTasks.execPath(), pinnedDeno);

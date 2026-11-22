// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Finding the npm that changes a Node project's dependencies.
 *
 * `zuke add`, `remove`, `cache` and `relock` run npm in a project whose
 * `zuke.json` says `"runtime": "node"`. The order mirrors the project's own
 * launchers: whatever `PATH` resolves first, then the pinned Node they
 * download into `ZUKE_NODE_HOME` (`~/.zuke/node` by default), so a project
 * whose only Node is the one `./zuke` fetched still works. As in
 * `deno_path.ts`, a candidate is tried by spawning it, which leaves `PATHEXT`
 * (`npm.cmd` on Windows) to the OS.
 *
 * @module
 */

import { absolutePath, FileTasks, ProcessTasks } from "@zuke/core";
import {
  defaultDenoHost,
  type DenoHost,
  firstSet,
  pathWithDeno,
} from "./deno_path.ts";
import { NODE_PIN } from "./node_pin.ts";

/**
 * The npm executables to try, in order: the bare name for `PATH`, then the
 * one beside the pinned Node the launchers cache. That one is left out when
 * the environment names no absolute directory to find it in.
 */
export function npmCandidates(host: DenoHost = defaultDenoHost): string[] {
  const candidates = ["npm"];
  const explicit = firstSet(host, "ZUKE_NODE_HOME");
  const home = firstSet(host, "HOME", "USERPROFILE");
  try {
    const root = explicit !== undefined
      ? absolutePath(explicit)
      : home !== undefined
      ? absolutePath(home)(".zuke", "node")
      : undefined;
    if (root !== undefined) {
      const release = root(`v${NODE_PIN.version}`);
      candidates.push(
        host.windows() ? release("npm.cmd").path : release("bin", "npm").path,
      );
    }
  } catch {
    // A relative ZUKE_NODE_HOME or HOME names no place to look.
  }
  return candidates;
}

/**
 * Run `npm <args>` in `cwd` with the terminal's output, trying each candidate
 * in order and skipping the ones that are not installed, and return its exit
 * code. The cached npm runs with its Node first on `PATH`, which its script
 * needs to start.
 *
 * @throws {Error} naming every candidate tried when none is installed.
 */
export async function runNpm(
  args: string[],
  cwd: string,
  candidates: readonly string[] = npmCandidates(),
): Promise<number> {
  for (const command of candidates) {
    try {
      const out = await ProcessTasks.run(command, (s) => {
        s.args(...args).cwd(cwd).stdin("null").stdout("inherit")
          .stderr("inherit");
        for (const [name, value] of Object.entries(pathWithDeno(command))) {
          s.env(name, value);
        }
        return s;
      });
      return out.code;
    } catch (error) {
      if (!FileTasks.isNotFound(error)) throw error;
    }
  }
  throw new Error(
    `zuke: this is a Node project, and no npm was found — tried ` +
      `${candidates.join(", ")}. Run the project's ./zuke once, which ` +
      `installs a pinned Node, or put Node ${
        NODE_PIN.version.split(".")[0]
      } or newer on PATH.`,
  );
}

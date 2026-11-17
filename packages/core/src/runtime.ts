// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What core asks of the runtime it is running on, rather than of a build:
 * which runtime it is, which module the program was started with, and
 * whether the process is a compiled binary.
 *
 * On Deno the answers are Deno's, as they have always been. On any other
 * runtime they are Node's.
 *
 * Internal (not a published entrypoint).
 *
 * @module
 */

import process from "node:process";
import { pathToFileURL } from "node:url";
import { realPathSync } from "./fs.ts";

/** Whether this runtime is Deno. Everything else is treated as Node. */
export const ON_DENO = typeof Deno !== "undefined";

/** What is known about the runtime the process is running on. */
export interface RuntimeFacts {
  /** The runtime's name, as a person would type it. */
  name: "deno" | "node";
  /** Its version, e.g. `2.8.3`. */
  version: string;
  /** The TypeScript version it bundles, where it says. */
  typescript: string | undefined;
  /**
   * Whether the process is a compiled binary with the runtime inside it,
   * and not the runtime started on a script.
   */
  standalone: boolean;
}

/** The running process's {@link RuntimeFacts}. */
export function runtimeFacts(): RuntimeFacts {
  if (ON_DENO) {
    return {
      name: "deno",
      version: Deno.version.deno,
      typescript: Deno.version.typescript,
      standalone: Deno.build.standalone,
    };
  }
  return {
    name: "node",
    version: process.versions.node,
    typescript: undefined,
    // shortcut: a Node single executable is not detected, add it with the
    // Node-built binary.
    standalone: false,
  };
}

/**
 * Every URL the module the program was started with can go by, the usual one
 * first; none when it was started with no module.
 *
 * On Deno there is one. On Node there are two when the script named on the
 * command line is a symlink, as it is under `npx` and in a global install:
 * Node names the module by the file the link leads to, unless it was started
 * with `--preserve-symlinks-main`, when it names it by the link.
 */
export function entryModules(): string[] {
  if (ON_DENO) return [Deno.mainModule];
  const script = process.argv.at(1);
  if (script === undefined) return [];
  const resolved = pathToFileURL(realPathSync(script)).href;
  const given = pathToFileURL(script).href;
  return resolved === given ? [resolved] : [resolved, given];
}

/**
 * The URL of the module the program was started with, or `""` when it was
 * started with none: the first of {@link entryModules}.
 */
export function mainModule(): string {
  return entryModules().at(0) ?? "";
}

/**
 * The path of the Deno executable when this process is Deno started on a
 * script, and `null` otherwise: in a compiled binary, where the running
 * executable is the binary, and on another runtime.
 */
export function denoPath(): string | null {
  return ON_DENO && !Deno.build.standalone ? Deno.execPath() : null;
}

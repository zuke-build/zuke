// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `RuntimeTasks`: what a package asks about the process it runs in — which
 * runtime, which operating system, where the executable is, which module
 * started it and with what arguments — answered the same on every runtime.
 *
 * @module
 */

import process from "node:process";
import { userId } from "./fs.ts";
import { type HostOs, hostOs } from "./host.ts";
import {
  mainModule,
  programArgs,
  type RuntimeFacts,
  runtimeFacts,
} from "./runtime.ts";

export type { RuntimeFacts } from "./runtime.ts";

/** The shape of {@link RuntimeTasks}. */
export interface RuntimeTasksApi {
  /** Which runtime this is, its version, and whether it is a compiled binary. */
  facts(): RuntimeFacts;

  /** The operating system, by the names Deno uses: `windows`, `darwin`, … */
  os(): HostOs;

  /** The path of the executable running this process. */
  execPath(): string;

  /** The URL of the module the process was started on. */
  mainModule(): string;

  /** The arguments the process was started with, after the module. */
  args(): string[];

  /** The id of the user this process runs as, or `null` on Windows. */
  userId(): number | null;
}

/** Facts about the running process, on whichever runtime it is. */
export const RuntimeTasks: RuntimeTasksApi = {
  facts(): RuntimeFacts {
    return runtimeFacts();
  },

  os(): HostOs {
    return hostOs();
  },

  execPath(): string {
    return process.execPath;
  },

  mainModule(): string {
    return mainModule();
  },

  args(): string[] {
    return programArgs();
  },

  userId(): number | null {
    return userId();
  },
};

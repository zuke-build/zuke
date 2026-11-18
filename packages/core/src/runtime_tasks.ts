// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `RuntimeTasks`: what a package asks about the process it runs in — which
 * runtime, which operating system and architecture, where the executable is,
 * which module started it and with what arguments, where it works and whether
 * a stream is a terminal — answered the same on every runtime, and how it
 * exits.
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

/** A standard stream of the process, for {@link RuntimeTasksApi.isTerminal}. */
export type StandardStream = "stdin" | "stdout" | "stderr";

/** Node's `process.arch` names that differ from Deno's `Deno.build.arch`. */
const ARCH_NAMES: Readonly<Record<string, string>> = {
  x64: "x86_64",
  arm64: "aarch64",
};

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

  /**
   * The CPU architecture, by the names Deno uses: `x86_64`, `aarch64`, …
   * Another runtime's name for the same architecture is mapped to Deno's.
   */
  arch(): string;

  /** The process's current working directory. */
  cwd(): string;

  /** Whether `stream` is connected to a terminal. */
  isTerminal(stream: StandardStream): boolean;

  /** End the process with exit `code`. */
  exit(code: number): never;
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

  arch(): string {
    return ARCH_NAMES[process.arch] ?? process.arch;
  },

  cwd(): string {
    return process.cwd();
  },

  isTerminal(stream: StandardStream): boolean {
    return process[stream].isTTY === true;
  },

  exit(code: number): never {
    return process.exit(code);
  },
};

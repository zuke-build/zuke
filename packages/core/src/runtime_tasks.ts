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
import { archName, type HostOs, hostOs } from "./host.ts";
import type { PathLike } from "./path.ts";
import {
  mainModule,
  programArgs,
  type RuntimeFacts,
  runtimeFacts,
} from "./runtime.ts";

export type { RuntimeFacts } from "./runtime.ts";

/** A standard stream of the process, for {@link RuntimeTasksApi.isTerminal}. */
export type StandardStream = "stdin" | "stdout" | "stderr";

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
   * The CPU architecture: `x86_64` or `aarch64`, by the names Deno uses, on
   * every runtime. Any other CPU is named as the runtime's `process.arch`
   * reports it.
   */
  arch(): string;

  /** The process's current working directory. */
  cwd(): string;

  /** Make `path` the process's working directory. */
  chdir(path: PathLike): void;

  /** Whether `stream` is connected to a terminal. */
  isTerminal(stream: StandardStream): boolean;

  /**
   * End the process with exit `code`.
   *
   * @throws {RangeError} when `code` is not an integer.
   */
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
    return archName();
  },

  cwd(): string {
    return process.cwd();
  },

  chdir(path: PathLike): void {
    process.chdir(String(path));
  },

  isTerminal(stream: StandardStream): boolean {
    return process[stream].isTTY === true;
  },

  exit(code: number): never {
    return process.exit(code);
  },
};

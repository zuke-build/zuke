// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The file-system seam `ProvisioningProfileTasks` works through, so its tests
 * run against a fake rather than the real profile directories.
 *
 * @module
 */

import { FileTasks } from "@zuke/core";

/** The operations installing a provisioning profile needs. */
export interface ProvisioningHost {
  /** Read a file's bytes. */
  readFile(path: string): Promise<Uint8Array>;
  /** Create a directory and its parents, if missing. */
  makeDirectory(path: string): Promise<void>;
  /** Write a file, replacing one that exists. */
  writeFile(path: string, data: Uint8Array): Promise<void>;
  /** Remove a file. */
  remove(path: string): Promise<void>;
  /** Whether a file exists. */
  exists(path: string): Promise<boolean>;
  /** The user's home directory. */
  home(): string;
}

/** The real file system. */
export const defaultProvisioningHost: ProvisioningHost = {
  readFile: (path) => Deno.readFile(path),
  makeDirectory: (path) => Deno.mkdir(path, { recursive: true }),
  writeFile: (path, data) => Deno.writeFile(path, data),
  remove: (path) => Deno.remove(path),
  exists: (path) => FileTasks.exists(path),
  home: () => FileTasks.homeDirectory(),
};

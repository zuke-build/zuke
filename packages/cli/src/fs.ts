// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The one filesystem probe the package's hosts share, so the scaffolder's
 * host and the dispatcher's probe agree on what "absent" means.
 *
 * @module
 */

import { FileTasks, type PathInfo } from "@zuke/core";

/**
 * `FileTasks.lstat` a path, or `null` when nothing is there. Reads the link itself
 * rather than its target, so a symlink is reported as a symlink instead of as
 * whatever it points at. A `NotFound` maps to `null`; any other error (e.g. a
 * permission failure) is rethrown rather than masked as absence.
 */
export async function lstatOrNull(
  path: string,
): Promise<PathInfo | null> {
  try {
    return await FileTasks.lstat(path);
  } catch (error) {
    if (FileTasks.isNotFound(error)) return null;
    throw error;
  }
}

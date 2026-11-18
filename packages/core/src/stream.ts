// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `StreamTasks`: move a stream of bytes somewhere without holding it whole,
 * such as a download straight to disk.
 *
 * @module
 */

import { writeStream } from "./fs.ts";
import { WriteSettings } from "./file_settings.ts";
import type { PathLike } from "./path.ts";
import type { Configure } from "./tooling.ts";

/** The shape of {@link StreamTasks}. */
export interface StreamTasksApi {
  /**
   * Write everything `data` carries to the file at `path`, as `configure`
   * says: replacing it unless `createNew`, in which case nothing is read from
   * a stream whose path is taken. A stream that fails leaves the file with
   * what had arrived, and the failure is thrown.
   *
   * ```ts
   * await StreamTasks.toFile("app.zip", response.body, (s) => s.createNew());
   * ```
   */
  toFile(
    path: PathLike,
    data: ReadableStream<Uint8Array>,
    configure?: Configure<WriteSettings>,
  ): Promise<void>;
}

/** Byte streams, on whichever runtime the build runs on. */
export const StreamTasks: StreamTasksApi = {
  toFile(
    path: PathLike,
    data: ReadableStream<Uint8Array>,
    configure: Configure<WriteSettings> = (s) => s,
  ): Promise<void> {
    const s = configure(new WriteSettings());
    return writeStream(String(path), data, s.mode_, s.createNew_);
  },
};

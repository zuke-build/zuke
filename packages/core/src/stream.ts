// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `StreamTasks`: move a stream of bytes somewhere without holding it whole,
 * such as a download straight to disk.
 *
 * @module
 */

import { writeStream } from "./fs.ts";
import type { PathLike } from "./path.ts";

/** Options for {@link StreamTasksApi.toFile}. */
export interface StreamToFileOptions {
  /**
   * Fail with an `AlreadyExists` when anything is at the path, instead of
   * replacing it. Nothing is read from the stream in that case.
   */
  createNew?: boolean;
}

/** The shape of {@link StreamTasks}. */
export interface StreamTasksApi {
  /**
   * Write everything `data` carries to the file at `path`, replacing it unless
   * `createNew`. A stream that fails leaves the file with what had arrived, and
   * the failure is thrown.
   */
  toFile(
    path: PathLike,
    data: ReadableStream<Uint8Array>,
    options?: StreamToFileOptions,
  ): Promise<void>;
}

/** Byte streams, on whichever runtime the build runs on. */
export const StreamTasks: StreamTasksApi = {
  toFile(
    path: PathLike,
    data: ReadableStream<Uint8Array>,
    options: StreamToFileOptions = {},
  ): Promise<void> {
    return writeStream(String(path), data, options.createNew);
  },
};

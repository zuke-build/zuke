// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The fluent settings of `FileTasks` and `StreamTasks` writes, and of
 * `FileTasks.makeTempDirectory`.
 *
 * @module
 */

/**
 * How a file is written, for `FileTasks.writeText`, `FileTasks.writeBytes`
 * and `StreamTasks.toFile`:
 *
 * ```ts
 * await FileTasks.writeText("key.pem", pem, (s) => s.mode(0o600).createNew());
 * ```
 *
 * With nothing set, the file is created or replaced with the system's default
 * permissions.
 */
export class WriteSettings {
  /** The permission bits to give the file; see {@link mode}. */
  mode_: number | undefined = undefined;

  /** Whether to refuse a path already taken; see {@link createNew}. */
  createNew_ = false;

  /**
   * The file's permission bits, such as `0o600`, applied to a file that
   * already exists too. Windows has none and ignores it.
   */
  mode(bits: number): this {
    this.mode_ = bits;
    return this;
  }

  /**
   * Fail with an `AlreadyExists` when anything is at the path, instead of
   * replacing it. The check and the create are one step, so of several
   * writers racing for a path exactly one succeeds.
   */
  createNew(): this {
    this.createNew_ = true;
    return this;
  }
}

/**
 * How `FileTasks.makeTempDirectory` names the directory:
 *
 * ```ts
 * const dir = await FileTasks.makeTempDirectory((s) => s.prefix("zuke-pack-"));
 * ```
 */
export class TempDirectorySettings {
  /** How the directory's name starts; see {@link prefix}. */
  prefix_: string | undefined = undefined;

  /** Where the directory goes; see {@link dir}. */
  dir_: string | undefined = undefined;

  /** How the directory's name starts (default `zuke-`). */
  prefix(start: string): this {
    this.prefix_ = start;
    return this;
  }

  /**
   * The directory to make it in (default the system's temporary directory),
   * for scratch space a tool must find under a project, such as a formatter
   * that reads the project's configuration.
   */
  dir(parent: string): this {
    this.dir_ = parent;
    return this;
  }
}

/** How `FileTasks.makeTempFile` names its file. */
export class TempFileSettings {
  /** How the file's name starts; see {@link prefix}. */
  prefix_: string | undefined = undefined;

  /** How the file's name ends; see {@link suffix}. */
  suffix_: string | undefined = undefined;

  /** How the file's name starts (default `zuke-`). */
  prefix(start: string): this {
    this.prefix_ = start;
    return this;
  }

  /** How the file's name ends, such as an extension (default none). */
  suffix(end: string): this {
    this.suffix_ = end;
    return this;
  }
}

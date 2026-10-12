// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `DittoTasks` — typed task functions for macOS `ditto`, the copier that keeps
 * resource forks, extended attributes and symlinks intact. It is the tool to
 * zip an app bundle for `notarytool submit`: `zip` drops the metadata a signed
 * bundle depends on, `ditto -c -k --keepParent` does not.
 *
 * ```ts
 * import { DittoTasks } from "@zuke/apple";
 * await DittoTasks.archive((s) =>
 *   s.keepParent().source("dist/MyApp.app").destination("dist/MyApp.zip")
 * );
 * ```
 *
 * @module
 */

import {
  type Configure,
  type PathLike,
  runSettings,
  type ToolResolution,
  ToolSettings,
} from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";
import { operand } from "./operand.ts";

/** Settings for a `ditto` run. */
export class DittoSettings extends ToolSettings {
  #create = false;
  #extract = false;
  #pkzip = false;
  #sequesterRsrc = false;
  #keepParent = false;
  #source?: string;
  #destination?: string;

  /** The default executable name (`ditto`). */
  protected override defaultTool(): string {
    return "ditto";
  }

  /** Resolve from `PATH` — `ditto` ships with macOS in `/usr/bin`. */
  protected override defaultResolution(): ToolResolution {
    return "path";
  }

  /** Create an archive rather than copy (`-c`). */
  create(): this {
    this.#create = true;
    return this;
  }

  /** Extract an archive rather than copy (`-x`). */
  extract(): this {
    this.#extract = true;
    return this;
  }

  /** Use the PKZip format for the archive (`-k`) instead of CPIO. */
  pkzip(): this {
    this.#pkzip = true;
    return this;
  }

  /**
   * Keep resource forks and HFS metadata in a `__MACOSX` directory inside the
   * archive (`--sequesterRsrc`), the way the Finder's own compress does.
   */
  sequesterRsrc(): this {
    this.#sequesterRsrc = true;
    return this;
  }

  /**
   * Put the source directory itself in the archive, not only its contents
   * (`--keepParent`) — what makes a zipped `MyApp.app` unzip as `MyApp.app`.
   */
  keepParent(): this {
    this.#keepParent = true;
    return this;
  }

  /** What to copy or archive (positional). Required. */
  source(path: PathLike): this {
    this.#source = operand(path);
    return this;
  }

  /** Where to write it (positional). Required. */
  destination(path: PathLike): this {
    this.#destination = operand(path);
    return this;
  }

  /** Assemble the `ditto` argv: flags, then source and destination. */
  protected override buildArgs(): string[] {
    if (this.#create && this.#extract) {
      throw new Error(
        "ditto: -c (create) and -x (extract) cannot be combined — an archive " +
          "is either written or read.",
      );
    }
    if (this.#source === undefined || this.#destination === undefined) {
      throw new Error(
        "ditto: both a source and a destination are required — add " +
          ".source(path).destination(path).",
      );
    }
    const argv: string[] = [];
    if (this.#create) argv.push("-c");
    if (this.#extract) argv.push("-x");
    if (this.#pkzip) argv.push("-k");
    if (this.#sequesterRsrc) argv.push("--sequesterRsrc");
    if (this.#keepParent) argv.push("--keepParent");
    argv.push(this.#source, this.#destination);
    return argv;
  }
}

/** The shape of {@link DittoTasks}. */
export interface DittoTasksApi {
  /** Copy a file or directory tree with `ditto`, metadata intact. */
  copy(configure: Configure<DittoSettings>): Promise<CommandOutput>;
  /** Write a zip archive: `ditto -c -k`, then the lambda's settings. */
  archive(configure: Configure<DittoSettings>): Promise<CommandOutput>;
  /** Unpack a zip archive: `ditto -x -k`, then the lambda's settings. */
  extract(configure: Configure<DittoSettings>): Promise<CommandOutput>;
}

/** Typed task functions for macOS `ditto`. */
export const DittoTasks: DittoTasksApi = {
  copy(configure: Configure<DittoSettings>): Promise<CommandOutput> {
    return runSettings(new DittoSettings(), configure);
  },
  archive(configure: Configure<DittoSettings>): Promise<CommandOutput> {
    return runSettings(new DittoSettings().create().pkzip(), configure);
  },
  extract(configure: Configure<DittoSettings>): Promise<CommandOutput> {
    return runSettings(new DittoSettings().extract().pkzip(), configure);
  },
};

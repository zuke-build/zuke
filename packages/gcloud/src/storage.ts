// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `gcloud storage` group — moving a build's artifacts in and out of Cloud
 * Storage.
 *
 * ```ts
 * import { GcloudTasks } from "jsr:@zuke/gcloud";
 * await GcloudTasks.storageCp((s) =>
 *   s.sources("dist").destination("gs://releases/app").recursive()
 * );
 * ```
 *
 * This is the supported successor to `gsutil`, which is why the wrapper targets
 * it rather than the older tool.
 *
 * @module
 */

import { GcloudSettings } from "./settings.ts";

/** Settings for `gcloud storage cp`. */
export class GcloudStorageCpSettings extends GcloudSettings {
  #sources: string[] = [];
  #destination?: string;
  #recursive = false;
  #noClobber = false;
  #contentType?: string;
  #cacheControl?: string;

  /** The sources to copy (positional); repeatable. */
  sources(...paths: string[]): this {
    this.#sources.push(...paths);
    return this;
  }

  /** Where to copy them (positional). */
  destination(path: string): this {
    this.#destination = path;
    return this;
  }

  /** Copy directories and their contents (`--recursive`). */
  recursive(): this {
    this.#recursive = true;
    return this;
  }

  /** Skip objects that already exist (`--no-clobber`). */
  noClobber(): this {
    this.#noClobber = true;
    return this;
  }

  /** Set the uploaded objects' content type (`--content-type`). */
  contentType(value: string): this {
    this.#contentType = value;
    return this;
  }

  /** Set the uploaded objects' cache control (`--cache-control`). */
  cacheControl(value: string): this {
    this.#cacheControl = value;
    return this;
  }

  /** Emit `storage cp` with its operands and flags. */
  protected override leadingTokens(): string[] {
    if (this.#sources.length === 0 || this.#destination === undefined) {
      throw new Error(
        "GcloudTasks.storageCp: a copy needs both ends — add " +
          ".sources(path) and .destination('gs://bucket/prefix').",
      );
    }
    const argv = ["storage", "cp", ...this.#sources, this.#destination];
    if (this.#recursive) argv.push("--recursive");
    if (this.#noClobber) argv.push("--no-clobber");
    if (this.#contentType !== undefined) {
      argv.push("--content-type", this.#contentType);
    }
    if (this.#cacheControl !== undefined) {
      argv.push("--cache-control", this.#cacheControl);
    }
    return argv;
  }
}

/** Settings for `gcloud storage rsync`. */
export class GcloudStorageRsyncSettings extends GcloudSettings {
  #source?: string;
  #destination?: string;
  #recursive = false;
  #deleteUnmatched = false;
  #exclude?: string;

  /** The source tree (positional). */
  source(path: string): this {
    this.#source = path;
    return this;
  }

  /** The destination tree (positional). */
  destination(path: string): this {
    this.#destination = path;
    return this;
  }

  /** Recurse into directories (`--recursive`). */
  recursive(): this {
    this.#recursive = true;
    return this;
  }

  /**
   * Delete objects at the destination that the source does not have
   * (`--delete-unmatched-destination-objects`), which makes the destination a
   * mirror rather than a superset.
   */
  deleteUnmatchedDestinationObjects(): this {
    this.#deleteUnmatched = true;
    return this;
  }

  /** Skip paths matching this pattern (`--exclude`). */
  exclude(pattern: string): this {
    this.#exclude = pattern;
    return this;
  }

  /** Emit `storage rsync` with its operands and flags. */
  protected override leadingTokens(): string[] {
    if (this.#source === undefined || this.#destination === undefined) {
      throw new Error(
        "GcloudTasks.storageRsync: a sync needs both ends — add .source(path) " +
          "and .destination('gs://bucket/prefix').",
      );
    }
    const argv = ["storage", "rsync", this.#source, this.#destination];
    if (this.#recursive) argv.push("--recursive");
    if (this.#deleteUnmatched) {
      argv.push("--delete-unmatched-destination-objects");
    }
    if (this.#exclude !== undefined) argv.push("--exclude", this.#exclude);
    return argv;
  }
}

/** Settings for `gcloud storage ls`. */
export class GcloudStorageLsSettings extends GcloudSettings {
  #paths: string[] = [];
  #recursive = false;
  #long = false;

  /** The paths to list (positional); repeatable. */
  paths(...values: string[]): this {
    this.#paths.push(...values);
    return this;
  }

  /** Recurse into prefixes (`--recursive`). */
  recursive(): this {
    this.#recursive = true;
    return this;
  }

  /** Include size and creation time (`--long`). */
  long(): this {
    this.#long = true;
    return this;
  }

  /** Emit `storage ls` with its operands. */
  protected override leadingTokens(): string[] {
    const argv = ["storage", "ls", ...this.#paths];
    if (this.#recursive) argv.push("--recursive");
    if (this.#long) argv.push("--long");
    return argv;
  }
}

/** Settings for `gcloud storage rm`. */
export class GcloudStorageRmSettings extends GcloudSettings {
  #paths: string[] = [];
  #recursive = false;

  /** The objects or prefixes to remove (positional); repeatable. */
  paths(...values: string[]): this {
    this.#paths.push(...values);
    return this;
  }

  /** Remove prefixes and everything under them (`--recursive`). */
  recursive(): this {
    this.#recursive = true;
    return this;
  }

  /** Emit `storage rm` with its operands. */
  protected override leadingTokens(): string[] {
    if (this.#paths.length === 0) {
      throw new Error(
        "GcloudTasks.storageRm: no paths given — add " +
          ".paths('gs://bucket/object'). A delete with no operand is not a " +
          "no-op worth guessing at.",
      );
    }
    const argv = ["storage", "rm", ...this.#paths];
    if (this.#recursive) argv.push("--recursive");
    return argv;
  }
}

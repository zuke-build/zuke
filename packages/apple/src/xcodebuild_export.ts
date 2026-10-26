// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for `xcodebuild -exportArchive`: turn an `.xcarchive` into an
 * `.ipa` (or upload it), as an `ExportOptions.plist` describes.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { operand } from "./operand.ts";
import { XcodebuildSettings } from "./xcodebuild_settings.ts";

/** Settings for `xcodebuild -exportArchive`. */
export class XcodebuildExportArchiveSettings extends XcodebuildSettings {
  #archivePath?: string;
  #exportPath?: string;
  #exportOptionsPlist?: string;

  /** The `.xcarchive` to export (`-archivePath`); required. */
  archivePath(path: PathLike): this {
    this.#archivePath = operand(path);
    return this;
  }

  /** The directory to write the export to (`-exportPath`); required. */
  exportPath(path: PathLike): this {
    this.#exportPath = operand(path);
    return this;
  }

  /**
   * The export options (`-exportOptionsPlist`); required. Write one with
   * `XcodebuildTasks.writeExportOptions`.
   */
  exportOptionsPlist(path: PathLike): this {
    this.#exportOptionsPlist = operand(path);
    return this;
  }

  /** `-exportArchive` with its three paths. */
  protected override invocationArgs(): string[] {
    const archive = this.#archivePath;
    const exportPath = this.#exportPath;
    const plist = this.#exportOptionsPlist;
    if (
      archive === undefined || exportPath === undefined || plist === undefined
    ) {
      const missing = [
        archive === undefined ? ".archivePath()" : "",
        exportPath === undefined ? ".exportPath()" : "",
        plist === undefined ? ".exportOptionsPlist()" : "",
      ].filter((name) => name !== "");
      throw new Error(
        `xcodebuild -exportArchive: ${missing.join(", ")} required.`,
      );
    }
    return [
      "-exportArchive",
      "-archivePath",
      archive,
      "-exportPath",
      exportPath,
      "-exportOptionsPlist",
      plist,
    ];
  }
}

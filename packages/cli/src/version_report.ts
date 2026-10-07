// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What `zuke --version` reports about the project it was run in, and the rich
 * panel it prints on a terminal.
 *
 * The project's Zuke version is read from its `deno.lock` — the version the
 * build actually resolves — rather than by running the build's own
 * `--version`. Asking the build only works on a build whose core answers that
 * flag, which is core 1.60.0 and later; on anything older it printed
 * `Unknown flag "--version"`. The lock answers for every version, without
 * spawning a process. Asking the build is kept only as the fallback for a
 * project with no lock, or a lock that names no core.
 *
 * @module
 */

import { absolutePath, lockedJsrSpecifiers } from "@zuke/core";
import { box } from "@zuke/core/render";
import type { CliPaint } from "./paint.ts";
import { isRecord } from "./records.ts";
import { LOCK_FILE } from "./dispatch.ts";

/**
 * `text` with its JSONC comments and trailing commas removed, so `JSON.parse`
 * reads it. Deno reads `deno.json` and `deno.jsonc` alike as JSONC, and a
 * comment is the usual reason for a `deno.jsonc`. Text inside a string is left
 * alone, escapes included; anything this does not make valid stays invalid.
 */
function stripJsonc(text: string): string {
  let out = "";
  // A comma is held back until the next token shows whether it trails.
  let comma = false;
  let i = 0;
  const emit = (token: string) => {
    if (comma && token !== "}" && token !== "]") out += ",";
    comma = false;
    out += token;
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let end = i + 1;
      while (end < text.length && text[end] !== '"') {
        end += text[end] === "\\" ? 2 : 1;
      }
      emit(text.slice(i, end + 1));
      i = end + 1;
    } else if (text.startsWith("//", i)) {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end;
    } else if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
    } else if (ch === ",") {
      if (comma) out += ",";
      comma = true;
      i++;
    } else if (/\s/.test(ch)) {
      out += ch;
      i++;
    } else {
      emit(ch);
      i++;
    }
  }
  return comma ? `${out},` : out;
}

/**
 * The lockfile the project at `root` resolves through, from the text of its
 * config (the first of `DENO_CONFIG_FILES` that exists, or `undefined` when
 * there is none), or `null` when no lock can be read for it.
 *
 * It follows Deno's `lock` setting:
 * - `false` disables the lock, and Deno then ignores any `deno.lock` left
 *   behind, so reading that file would report a version the build does not
 *   run. That is `null`.
 * - A string, or an object's `path`, names the lockfile, relative to `root`
 *   unless it is absolute.
 * - No setting, `true`, or an object without a `path` keeps `deno.lock`.
 *
 * Comments and trailing commas are read as Deno reads them. A config that is
 * still not valid is a setting this cannot read, so it is also `null` rather
 * than a guess; the caller then asks the build, as it does for a project with
 * no lock.
 */
export function projectLockPath(
  root: string,
  configText: string | undefined,
): string | null {
  if (configText === undefined) return `${root}/${LOCK_FILE}`;
  let config: unknown;
  try {
    config = JSON.parse(stripJsonc(configText));
  } catch {
    return null;
  }
  const lock = isRecord(config) ? config.lock : undefined;
  if (lock === false) return null;
  const path = typeof lock === "string"
    ? lock
    : isRecord(lock) && typeof lock.path === "string"
    ? lock.path
    : LOCK_FILE;
  try {
    return absolutePath(path).path;
  } catch {
    return absolutePath(root, path).path;
  }
}

/** The core package whose resolved version a project's lock is read for. */
const CORE_PACKAGE = "@zuke/core";

/**
 * A release version: a numeric core with an optional prerelease and build.
 * `zuke upgrade` checks the version it is asked for against it, and a lock's
 * resolved core version must match it before it is printed.
 */
export const VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * The `@zuke/core` versions a lock resolves, from its text: one entry per
 * distinct version (a lock normally holds one, but several ranges can each
 * resolve their own), in the order the lock lists them. Empty when the lock
 * names no core, or is not a lock this can read.
 *
 * A resolved value that is not a release version is dropped rather than
 * printed. The lock is the project's own file, and a value carrying a newline
 * or a terminal escape sequence would otherwise reach the terminal as written,
 * from a command that promises only to report a number.
 */
export function lockedCoreVersions(lockText: string): string[] {
  const versions = lockedJsrSpecifiers(lockText)
    .filter((entry) => entry.name === CORE_PACKAGE)
    .map((entry) => entry.resolved)
    .filter((version) => VERSION_PATTERN.test(version));
  return [...new Set(versions)];
}

/**
 * `path` with the home directory written `~`, for display: a project path is
 * usually under home, and the prefix is the least informative part of it.
 * Only a whole leading directory is replaced, so `/home/me2` stays as it is
 * under `/home/me`.
 *
 * `path` is an {@link absolutePath} one (forward slashes, also on Windows), so
 * `home` is normalised the same way before comparing, and compared without
 * regard to case on Windows, whose paths are case-insensitive. A `home` that
 * is not absolute names no prefix to strip.
 */
export function homeRelative(
  path: string,
  home: string | undefined,
  windows: boolean,
): string {
  if (home === undefined) return path;
  let base: string;
  try {
    base = absolutePath(home).path;
  } catch {
    return path;
  }
  if (base === "/" || /^[A-Za-z]:\/?$/.test(base)) return path;
  const fold = (text: string) => windows ? text.toLowerCase() : text;
  if (fold(path) === fold(base)) return "~";
  return fold(path).startsWith(`${fold(base)}/`)
    ? `~${path.slice(base.length)}`
    : path;
}

/** One row of the version panel: its label and its value. */
export type VersionRow = readonly [label: string, value: string];

/**
 * The version panel: a titled box with one aligned row per fact, the first
 * value — the CLI's own version — emphasised. Colour follows `paint`, so
 * `NO_COLOR` keeps the box and drops the escape codes.
 */
export function formatVersionPanel(
  rows: readonly VersionRow[],
  paint: CliPaint,
): string {
  const width = Math.max(...rows.map(([label]) => label.length));
  const lines = rows.map(([label, value], index) => {
    const name = paint.muted(label.padEnd(width));
    const shown = index === 0 ? paint.value(value) : value;
    return `${paint.name("◆")} ${name}  ${shown}`;
  });
  return box(
    { github: false, color: paint.color, width: 0 },
    lines,
    { title: "zuke", titleStyle: ["cyan", "bold"] },
  ).join("\n");
}

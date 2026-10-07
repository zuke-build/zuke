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

import { lockedJsrSpecifiers } from "@zuke/core";
import { box } from "@zuke/core/render";
import type { CliPaint } from "./paint.ts";

/** The core package whose resolved version a project's lock is read for. */
const CORE_PACKAGE = "@zuke/core";

/**
 * The `@zuke/core` versions a lock resolves, from its text: one entry per
 * distinct version (a lock normally holds one, but several ranges can each
 * resolve their own), in the order the lock lists them. Empty when the lock
 * names no core, or is not a lock this can read.
 */
export function lockedCoreVersions(lockText: string): string[] {
  const versions = lockedJsrSpecifiers(lockText)
    .filter((entry) => entry.name === CORE_PACKAGE)
    .map((entry) => entry.resolved);
  return [...new Set(versions)];
}

/**
 * `path` with the home directory written `~`, for display: a project path is
 * usually under home, and the prefix is the least informative part of it.
 * Only a whole leading directory is replaced, so `/home/me2` stays as it is
 * under `/home/me`.
 */
export function homeRelative(path: string, home: string | undefined): string {
  if (home === undefined || home === "" || home === "/") return path;
  const base = home.endsWith("/") ? home.slice(0, -1) : home;
  if (path === base) return "~";
  return path.startsWith(`${base}/`) ? `~${path.slice(base.length)}` : path;
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

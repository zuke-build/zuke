// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The rich form of the build's `--version`: a small panel naming the core
 * version and what it runs on.
 *
 * Only ever printed when output is rich, which by construction means a person
 * at an interactive terminal. A script reads `--version` through a pipe and is
 * therefore never rich, so it keeps getting the bare number.
 *
 * @module
 */

import { box } from "./render.ts";
import type { CliPaint } from "./cli_paint.ts";
import { VERSION } from "./version.ts";

/** What the version panel reports, gathered by {@link versionFacts}. */
export interface VersionFacts {
  /** The `@zuke/core` version executing this build. */
  core: string;
  /** The Deno runtime version. */
  deno: string;
  /** The TypeScript version Deno bundles. */
  typescript: string;
  /** The platform as `<os>-<arch>`. */
  platform: string;
}

/** The running process's facts, read here so the formatter stays pure. */
export function versionFacts(): VersionFacts {
  return {
    core: VERSION,
    deno: Deno.version.deno,
    typescript: Deno.version.typescript,
    platform: `${Deno.build.os}-${Deno.build.arch}`,
  };
}

/** One row of a version panel: its label and its value. */
export type VersionRow = readonly [label: string, value: string];

/** The panel's rows, in the order they are printed. */
function rows(facts: VersionFacts): VersionRow[] {
  return [
    ["core", facts.core],
    ["deno", facts.deno],
    ["typescript", facts.typescript],
    ["platform", facts.platform],
  ];
}

/**
 * A version panel: a box titled `zuke` with one aligned row per entry, the
 * first value emphasised. Colour follows `paint`, so `NO_COLOR` keeps the box
 * and drops the escape codes. The global `zuke` command prints its own
 * `--version` with it, so both panels look the same.
 *
 * @param rows The rows to print, in order; the first value is emphasised.
 * @param paint The palette, from `cliPaint`.
 */
export function versionPanel(
  rows: readonly VersionRow[],
  paint: CliPaint,
): string {
  const width = Math.max(...rows.map(([label]) => label.length));
  const lines = rows.map(([label, value], index) => {
    const name = paint.muted(label.padEnd(width));
    const shown = index === 0 ? paint.target(value) : value;
    return `${paint.command("◆")} ${name}  ${shown}`;
  });
  return box(
    { github: false, color: paint.color, width: 0 },
    lines,
    { title: "zuke", titleStyle: ["cyan", "bold"] },
  ).join("\n");
}

/** The build's own version panel: {@link versionPanel} over `facts`. */
export function formatVersionPanel(
  facts: VersionFacts,
  paint: CliPaint,
): string {
  return versionPanel(rows(facts), paint);
}

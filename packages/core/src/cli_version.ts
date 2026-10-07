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

/** The panel's rows, in the order they are printed. */
function rows(facts: VersionFacts): Array<[string, string]> {
  return [
    ["core", facts.core],
    ["deno", facts.deno],
    ["typescript", facts.typescript],
    ["platform", facts.platform],
  ];
}

/**
 * The version panel: a titled box with one aligned row per fact, the core
 * version emphasised. Colour follows `paint`, so `NO_COLOR` keeps the box and
 * drops the escape codes.
 */
export function formatVersionPanel(
  facts: VersionFacts,
  paint: CliPaint,
): string {
  const entries = rows(facts);
  const width = Math.max(...entries.map(([label]) => label.length));
  const lines = entries.map(([label, value], index) => {
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

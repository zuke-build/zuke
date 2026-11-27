// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Trailing slashes are trimmed in linear time everywhere (#1234). The plain
 * one-or-more-slashes-at-the-end regex backtracks quadratically on a long run
 * of slashes; the sources use the lookbehind form below, or core's internal
 * `trimTrailingSlashes`, instead.
 *
 * @module
 */

import { FileTasks } from "@zuke/core";
import { test } from "./_testing.ts";
import { assertEquals } from "./_assert.ts";

/** The linear form the sources use: a run of slashes not preceded by one. */
const LINEAR = /(?<!\/)\/+$/;

/** The quadratic form, spelled so this file does not match itself. */
const QUADRATIC = ["/\\/", "+$/"].join("");

/** Every `.ts` file under `dir`, recursively. */
async function tsFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await FileTasks.readDirectory(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) found.push(...await tsFiles(path));
    else if (entry.isFile && entry.name.endsWith(".ts")) found.push(path);
  }
  return found;
}

test("no source trims trailing slashes with the quadratic regex", async () => {
  const roots = ["build"];
  for (const entry of await FileTasks.readDirectory("packages")) {
    const src = `packages/${entry.name}/src`;
    if (entry.isDirectory && await FileTasks.exists(src)) roots.push(src);
  }
  const offenders: string[] = [];
  for (const root of roots) {
    for (const file of await tsFiles(root)) {
      if ((await FileTasks.readText(file)).includes(QUADRATIC)) {
        offenders.push(file);
      }
    }
  }
  assertEquals(
    offenders,
    [],
    `use ${LINEAR.source} instead in:\n  ${offenders.join("\n  ")}`,
  );
});

test("the linear form trims as the quadratic one did, in linear time", () => {
  for (
    const [input, want] of [
      ["https://h/a///", "https://h/a"],
      ["https://h/a", "https://h/a"],
      ["a//b/", "a//b"],
      ["///", ""],
      ["", ""],
    ]
  ) assertEquals(input.replace(LINEAR, ""), want);
  const long = `${"/".repeat(200_000)}x`;
  const started = Date.now();
  assertEquals(long.replace(LINEAR, ""), long);
  // The quadratic form takes tens of seconds on this input.
  assertEquals(Date.now() - started < 1_000, true);
});

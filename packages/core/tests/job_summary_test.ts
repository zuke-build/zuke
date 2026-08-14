// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "./_assert.ts";
import { appendJobSummary } from "../src/job_summary.ts";
import { withTemp } from "./_temp.ts";

/** Run `fn` with `GITHUB_STEP_SUMMARY` set to `value` (or unset). */
async function withSummaryPath(
  value: string | undefined,
  fn: () => Promise<void> | void,
): Promise<void> {
  const saved = Deno.env.get("GITHUB_STEP_SUMMARY");
  if (value === undefined) Deno.env.delete("GITHUB_STEP_SUMMARY");
  else Deno.env.set("GITHUB_STEP_SUMMARY", value);
  try {
    await fn();
  } finally {
    if (saved === undefined) Deno.env.delete("GITHUB_STEP_SUMMARY");
    else Deno.env.set("GITHUB_STEP_SUMMARY", saved);
  }
}

Deno.test("appendJobSummary appends, so sections from one run accumulate", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/summary.md`;
  try {
    await withSummaryPath(path, () => {
      // Several parts of one run write their own sections to this file; a
      // truncating write would silently drop the earlier ones.
      assertEquals(appendJobSummary("## first\n"), true);
      assertEquals(appendJobSummary("## second\n"), true);
    });
    assertEquals(await Deno.readTextFile(path), "## first\n## second\n");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("appendJobSummary ends the section with a newline", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/summary.md`;
  try {
    await withSummaryPath(path, () => {
      // Without this, two sections would run together on one line.
      appendJobSummary("no trailing newline");
      appendJobSummary("next");
    });
    assertEquals(await Deno.readTextFile(path), "no trailing newline\nnext\n");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("appendJobSummary is a no-op outside Actions", async () => {
  await withSummaryPath(undefined, () => {
    assertEquals(appendJobSummary("## ignored"), false);
  });
  // An empty value is how a shell exports an unset variable; treat it as unset.
  await withSummaryPath("", () => {
    assertEquals(appendJobSummary("## ignored"), false);
  });
});

Deno.test("an unwritable summary reports false instead of failing the build", async () => {
  await withTemp(async (dir) => {
    // A directory where a file is expected: writing throws, and a report that
    // cannot be displayed must never fail the build that produced it.
    await withSummaryPath(dir, () => {
      assertEquals(appendJobSummary("## nowhere"), false);
    });
  });
});

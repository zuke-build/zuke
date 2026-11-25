// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { EnvTasks, FileTasks } from "../mod.ts";
import { test } from "../../../tests/_testing.ts";
import { assertEquals } from "../../../tests/_assert.ts";
import { appendJobSummary } from "../src/job_summary.ts";
import { withTemp } from "../../../tests/_temp.ts";
import { withAmbientRedactor } from "../src/ambient_redactor.ts";
import { REDACTED, Redactor } from "../src/redact.ts";

/** Run `fn` with `GITHUB_STEP_SUMMARY` set to `value` (or unset). */
async function withSummaryPath(
  value: string | undefined,
  fn: () => Promise<void> | void,
): Promise<void> {
  const saved = EnvTasks.get("GITHUB_STEP_SUMMARY");
  if (value === undefined) EnvTasks.delete("GITHUB_STEP_SUMMARY");
  else EnvTasks.set("GITHUB_STEP_SUMMARY", value);
  try {
    await fn();
  } finally {
    if (saved === undefined) EnvTasks.delete("GITHUB_STEP_SUMMARY");
    else EnvTasks.set("GITHUB_STEP_SUMMARY", saved);
  }
}

test("appendJobSummary appends, so sections from one run accumulate", async () => {
  const dir = await FileTasks.makeTempDirectory();
  const path = `${dir}/summary.md`;
  try {
    await withSummaryPath(path, () => {
      // Several parts of one run write their own sections to this file; a
      // truncating write would silently drop the earlier ones.
      assertEquals(appendJobSummary("## first\n"), true);
      assertEquals(appendJobSummary("## second\n"), true);
    });
    assertEquals(await FileTasks.readText(path), "## first\n## second\n");
  } finally {
    await FileTasks.remove(dir, { recursive: true });
  }
});

test("appendJobSummary ends the section with a newline", async () => {
  const dir = await FileTasks.makeTempDirectory();
  const path = `${dir}/summary.md`;
  try {
    await withSummaryPath(path, () => {
      // Without this, two sections would run together on one line.
      appendJobSummary("no trailing newline");
      appendJobSummary("next");
    });
    assertEquals(await FileTasks.readText(path), "no trailing newline\nnext\n");
  } finally {
    await FileTasks.remove(dir, { recursive: true });
  }
});

test("appendJobSummary is a no-op outside Actions", async () => {
  await withSummaryPath(undefined, () => {
    assertEquals(appendJobSummary("## ignored"), false);
  });
  // An empty value is how a shell exports an unset variable; treat it as unset.
  await withSummaryPath("", () => {
    assertEquals(appendJobSummary("## ignored"), false);
  });
});

test("an unwritable summary reports false instead of failing the build", async () => {
  await withTemp(async (dir) => {
    // A directory where a file is expected: writing throws, and a report that
    // cannot be displayed must never fail the build that produced it.
    await withSummaryPath(dir, () => {
      assertEquals(appendJobSummary("## nowhere"), false);
    });
  });
});

test("appendJobSummary masks the run's secrets", async () => {
  // The job summary is visible to everyone who can view the run, and the
  // `::add-mask::` directives do not cover it — they mask the runner's log
  // stream, not a file the build writes. Redacting at this one exported writer
  // is what stops a caller publishing a secret by forgetting to: a validation
  // or a remediation has no redactor on its context to forget with.
  const dir = await FileTasks.makeTempDirectory();
  const path = `${dir}/summary.md`;
  try {
    await withSummaryPath(path, async () => {
      const redactor = new Redactor();
      redactor.add("s3cr3t-value-xyz");
      await withAmbientRedactor(redactor, () => {
        appendJobSummary("deploy --token s3cr3t-value-xyz failed");
        return Promise.resolve();
      });
      const written = await FileTasks.readText(path);
      assertEquals(written.includes("s3cr3t-value-xyz"), false);
      assertEquals(written.includes(REDACTED), true);
    });
  } finally {
    await FileTasks.remove(dir, { recursive: true });
  }
});

test("appendJobSummary writes verbatim when no run is in scope", async () => {
  // Outside a run there is no redactor and nothing to mask, so the text is
  // written exactly as given rather than routed through a no-op that could
  // change it.
  const dir = await FileTasks.makeTempDirectory();
  const path = `${dir}/summary.md`;
  try {
    await withSummaryPath(path, async () => {
      appendJobSummary("## plain 100% report");
      assertEquals(await FileTasks.readText(path), "## plain 100% report\n");
    });
  } finally {
    await FileTasks.remove(dir, { recursive: true });
  }
});

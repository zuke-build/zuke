// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The examples gate. Every `examples/<name>/zuke.ts` is a complete build a
 * reader is meant to copy, so each one is type-checked against the workspace
 * and asked to list its targets on every run — an example cannot rot when the
 * API moves.
 *
 * The examples import `jsr:@zuke/*`. From inside this repository those
 * specifiers resolve to the workspace members, so the check holds an example
 * to the real source rather than to a published version that could lag.
 */

import { glob } from "@zuke/core";
import { DenoTasks } from "@zuke/deno";
import { denoCheck, type SnippetChecker } from "./snippets.ts";

/** Where the example builds live. */
export const EXAMPLES_GLOB = "examples/*/zuke.ts";

/** One example project: its directory and the build file inside it. */
export interface Example {
  /** The example's directory (repo-relative), the cwd its build runs in. */
  dir: string;
  /** The build file, `<dir>/zuke.ts`. */
  file: string;
}

/** The step of the gate that failed for one example, with the tool's output. */
export interface ExampleFailure {
  /** The example's directory. */
  dir: string;
  /** Which step failed: the type-check, or listing the build's targets. */
  step: "check" | "list";
  /** The tool's output. */
  detail: string;
}

/** The two steps the gate runs per example, injectable for unit tests. */
export interface ExampleRunner {
  /** Type-check the build file. */
  check: SnippetChecker;
  /** Run the build's `--list` from inside its directory. */
  list: (dir: string) => Promise<{ ok: boolean; detail: string }>;
}

/** The default runner: `deno check` and `deno run … --list`, both frozen. */
const denoRunner: ExampleRunner = {
  check: denoCheck,
  list: async (dir) => {
    // An example that drives a Node app carries that app's package.json. Deno
    // would discover it from the example's directory and, under --frozen,
    // refuse to run because the root lockfile does not list it as a workspace
    // member — but it is the app's manifest, not the build's, so opt out of
    // package.json discovery for the listing.
    const out = await DenoTasks.run((s) =>
      s.allowAll().frozen().script("zuke.ts").scriptArgs("--list").cwd(dir)
        .env({ DENO_NO_PACKAGE_JSON: "1" }).quiet().noThrow()
    );
    return { ok: out.code === 0, detail: `${out.stderr}${out.stdout}`.trim() };
  },
};

/**
 * Find the example builds matching `pattern`, sorted for a stable run order.
 *
 * @throws when nothing matches — a gate over zero examples would pass while
 * checking nothing, so a moved directory or a typo in the glob is an error.
 */
export async function discoverExamples(
  pattern = EXAMPLES_GLOB,
): Promise<Example[]> {
  const files = (await glob(pattern)).sort();
  if (files.length === 0) {
    throw new Error(`No example builds match "${pattern}".`);
  }
  return files.map((file) => ({
    file,
    dir: file.replace(/[\\/]zuke\.ts$/, ""),
  }));
}

/**
 * Run the gate over `examples`: type-check each build file, then list its
 * targets from inside its directory. A build that fails to type-check is not
 * listed — the check output is the root cause, and the list would only repeat
 * it — so each example contributes at most one failure.
 */
export async function checkExamples(
  examples: Example[],
  runner: ExampleRunner = denoRunner,
): Promise<ExampleFailure[]> {
  const failures: ExampleFailure[] = [];
  for (const example of examples) {
    const checked = await runner.check(example.file);
    if (!checked.ok) {
      failures.push({
        dir: example.dir,
        step: "check",
        detail: checked.detail,
      });
      continue;
    }
    const listed = await runner.list(example.dir);
    if (!listed.ok) {
      failures.push({ dir: example.dir, step: "list", detail: listed.detail });
    }
  }
  return failures;
}

/** Render the failures as one actionable message, each example named first. */
export function formatExampleFailures(failures: ExampleFailure[]): string {
  const blocks = failures.map((f) => {
    const detail = f.detail.split("\n").map((line) => `    ${line}`).join("\n");
    const what = f.step === "check" ? "does not type-check" : "fails --list";
    return `  ${f.dir} ${what}:\n${detail}`;
  });
  return `${failures.length} example(s) failed the gate:\n${
    blocks.join("\n\n")
  }\n\n` +
    "Fix the example so it matches the current API — it is what readers copy.";
}

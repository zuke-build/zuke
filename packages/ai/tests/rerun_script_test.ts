// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The command job's re-run step, run for real against a fake `gh`: a POSIX
 * shell shim that answers the two reads from JSON files and records every
 * call, so the test sees which run the script would re-run, if any. The shim
 * filters with the machine's `jq`, as the real `gh` does for `--jq`, so a
 * machine without `jq` (and Windows, which has no `bash` shim) skips these.
 */

import { test } from "../../../tests/_testing.ts";
import { assertEquals } from "../../../tests/_assert.ts";
import { FileTasks, RuntimeTasks } from "@zuke/core";
import { $ } from "@zuke/core/shell";
import { RERUN_SCRIPT } from "../src/workflow.ts";

const FAKE_GH = `#!/bin/sh
d="$FAKE_GH_DIR"
url=""; jqf=""; method=GET
shift
while [ $# -gt 0 ]; do
  case "$1" in
    --jq) jqf="$2"; shift 2;;
    -X) method="$2"; shift 2;;
    -f) shift 2;;
    --silent) shift;;
    *) url="$1"; shift;;
  esac
done
echo "$method $url" >> "$d/calls.log"
case "$method $url" in
  "POST "*/rerun) [ -e "$d/refuse" ] && exit 1; exit 0;;
  "POST "*) exit 0;;
  *"/pulls/"*) jq -r "$jqf" "$d/pull.json";;
  *"/runs?"*) jq -r "$jqf" "$d/runs.json";;
esac
`;

/** A workflow run as the Actions API lists it. */
function run(
  id: number,
  repo: string,
  pulls: number[],
  sha = "abc",
): Record<string, unknown> {
  return {
    id,
    head_sha: sha,
    head_repository: { full_name: repo },
    pull_requests: pulls.map((number) => ({ number })),
  };
}

/** What a scenario left behind. */
interface Outcome {
  /** The shim's recorded calls, one per line. */
  calls: string[];
  /** What the step wrote to `GITHUB_OUTPUT`. */
  output: string;
}

/**
 * Run the step as pull request 7 of `o/r`, whose head is `headRepo` (null for a
 * deleted fork), with `runs` listed and the re-run refused when `refuse`.
 * Resolves to null when this machine cannot run the shim.
 */
async function scenario(
  headRepo: string | null,
  runs: Record<string, unknown>[],
  refuse = false,
): Promise<Outcome | null> {
  if (RuntimeTasks.os() === "windows") return null;
  if ((await $`jq --version`.quiet().noThrow().code()) !== 0) return null;
  const dir = await FileTasks.makeTempDirectory((s) => s.prefix("zuke-rerun-"));
  try {
    await FileTasks.writeText(`${dir}/gh`, FAKE_GH);
    await FileTasks.chmod(`${dir}/gh`, 0o755);
    await FileTasks.writeText(`${dir}/step.sh`, RERUN_SCRIPT);
    await FileTasks.writeText(`${dir}/calls.log`, "");
    await FileTasks.writeText(`${dir}/out`, "");
    await FileTasks.writeText(
      `${dir}/pull.json`,
      JSON.stringify({
        head: {
          repo: headRepo === null ? null : { full_name: headRepo },
          sha: "abc",
        },
      }),
    );
    await FileTasks.writeText(
      `${dir}/runs.json`,
      JSON.stringify({ workflow_runs: runs }),
    );
    if (refuse) await FileTasks.writeText(`${dir}/refuse`, "");
    await $`bash -e ${dir}/step.sh`.quiet().env({
      PATH: `${dir}:/usr/bin:/bin`,
      FAKE_GH_DIR: dir,
      GITHUB_REPOSITORY: "o/r",
      GITHUB_WORKFLOW_REF: "o/r/.github/workflows/ai-review.yml@refs/heads/m",
      GITHUB_OUTPUT: `${dir}/out`,
      ZUKE_REVIEW_PR: "7",
      ZUKE_REVIEW_COMMENT: "99",
    }).noThrow();
    return {
      calls: (await FileTasks.readText(`${dir}/calls.log`)).split("\n")
        .filter((line) => line !== ""),
      output: await FileTasks.readText(`${dir}/out`),
    };
  } finally {
    await FileTasks.remove(dir, { recursive: true });
  }
}

/** The calls that changed something. */
function posts(outcome: Outcome): string[] {
  return outcome.calls.filter((call) => call.startsWith("POST"));
}

test("same-repository pull request: re-runs its newest own run, then reacts", async () => {
  const out = await scenario("o/r", [run(30, "o/r", [7]), run(20, "o/r", [7])]);
  if (out === null) return;
  assertEquals(posts(out), [
    "POST repos/o/r/actions/runs/30/rerun",
    "POST repos/o/r/issues/comments/99/reactions",
  ]);
  assertEquals(out.output, "rerun=true\n");
  // The run is looked up by this workflow's file and the head commit.
  assertEquals(
    out.calls[1],
    "GET repos/o/r/actions/workflows/ai-review.yml/runs?event=pull_request" +
      "&status=completed&head_sha=abc&per_page=100",
  );
});

test("a fork's pull request is not re-run", async () => {
  const out = await scenario("fork/r", [run(30, "o/r", [7])]);
  if (out === null) return;
  assertEquals(out.calls.length, 1);
  assertEquals(out.output, "");
});

test("a deleted fork is not re-run", async () => {
  const out = await scenario(null, [run(30, "o/r", [7])]);
  if (out === null) return;
  assertEquals(out.calls.length, 1);
  assertEquals(out.output, "");
});

test("a fork's run sharing the head commit is never picked", async () => {
  const out = await scenario("o/r", [
    run(40, "fork/r", [7]),
    run(20, "o/r", [7]),
  ]);
  if (out === null) return;
  assertEquals(posts(out)[0], "POST repos/o/r/actions/runs/20/rerun");
  const only = await scenario("o/r", [run(40, "fork/r", [7])]);
  if (only === null) return;
  assertEquals(posts(only), []);
  assertEquals(only.output, "");
});

test("another pull request's run on the same commit is never picked", async () => {
  const out = await scenario("o/r", [
    run(40, "o/r", [8]),
    run(20, "o/r", [7, 9]),
  ]);
  if (out === null) return;
  assertEquals(posts(out)[0], "POST repos/o/r/actions/runs/20/rerun");
  const only = await scenario("o/r", [run(40, "o/r", [8])]);
  if (only === null) return;
  assertEquals(posts(only), []);
  assertEquals(only.output, "");
});

test("no run to re-run: no output, nothing posted", async () => {
  const out = await scenario("o/r", [run(30, "o/r", [7], "other")]);
  if (out === null) return;
  assertEquals(posts(out), []);
  assertEquals(out.output, "");
});

test("a refused re-run sets no output and reacts to nothing", async () => {
  const out = await scenario("o/r", [run(30, "o/r", [7])], true);
  if (out === null) return;
  assertEquals(posts(out), ["POST repos/o/r/actions/runs/30/rerun"]);
  assertEquals(out.output, "");
});

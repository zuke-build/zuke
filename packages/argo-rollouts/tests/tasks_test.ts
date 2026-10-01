// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Every task wires the right settings class to the right subcommand. Each one
 * runs under the deep-dry-run echo sink, so the command line is captured
 * rather than spawned and no plugin binary is needed.
 *
 * @module
 */

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import { missingTool } from "@zuke/core/tooling/conformance";
import { withAmbientEcho } from "../../core/src/ambient_echo.ts";
import { ArgoRolloutsTasks } from "../mod.ts";

/** The command line `run` would have executed, without spawning it. */
async function echoed(run: () => Promise<unknown>): Promise<string> {
  const lines: string[] = [];
  await withAmbientEcho((line) => lines.push(line), run);
  assertEquals(lines.length, 1);
  return lines[0];
}

const BIN = "kubectl-argo-rollouts";

Deno.test("every task runs its own subcommand", async () => {
  const cases: Array<[() => Promise<unknown>, string]> = [
    [
      () =>
        ArgoRolloutsTasks.setImage((s) => s.name("api").image("api", "x:1")),
      `${BIN} set image api api=x:1`,
    ],
    [
      () => ArgoRolloutsTasks.promote((s) => s.name("api")),
      `${BIN} promote api`,
    ],
    [() => ArgoRolloutsTasks.abort((s) => s.name("api")), `${BIN} abort api`],
    [() => ArgoRolloutsTasks.pause((s) => s.name("api")), `${BIN} pause api`],
    [() => ArgoRolloutsTasks.status((s) => s.name("api")), `${BIN} status api`],
    [() => ArgoRolloutsTasks.undo((s) => s.name("api")), `${BIN} undo api`],
    [
      () => ArgoRolloutsTasks.restart((s) => s.name("api")),
      `${BIN} restart api`,
    ],
    [
      () => ArgoRolloutsTasks.retryRollout((s) => s.name("api")),
      `${BIN} retry rollout api`,
    ],
    [
      () => ArgoRolloutsTasks.retryExperiment((s) => s.name("exp")),
      `${BIN} retry experiment exp`,
    ],
    [
      () => ArgoRolloutsTasks.terminateAnalysisRun((s) => s.name("run-1")),
      `${BIN} terminate analysisrun run-1`,
    ],
    [
      () => ArgoRolloutsTasks.terminateExperiment((s) => s.name("exp")),
      `${BIN} terminate experiment exp`,
    ],
    [
      () => ArgoRolloutsTasks.getRollout((s) => s.name("api")),
      `${BIN} get rollout api`,
    ],
    [
      () => ArgoRolloutsTasks.getExperiment((s) => s.name("exp")),
      `${BIN} get experiment exp`,
    ],
    [() => ArgoRolloutsTasks.listRollouts(), `${BIN} list rollouts`],
    [() => ArgoRolloutsTasks.listExperiments(), `${BIN} list experiments`],
    [
      () => ArgoRolloutsTasks.create((s) => s.filename("r.yaml")),
      `${BIN} create --filename r.yaml`,
    ],
    [
      () => ArgoRolloutsTasks.createAnalysisRun((s) => s.from("rate")),
      `${BIN} create analysisrun --from rate`,
    ],
    [
      () => ArgoRolloutsTasks.lint((s) => s.filename("r.yaml")),
      `${BIN} lint --filename r.yaml`,
    ],
    [() => ArgoRolloutsTasks.version(), `${BIN} version`],
  ];
  for (const [run, expected] of cases) {
    assertEquals(await echoed(run), expected);
  }
});

Deno.test("a missing plugin binary is reported as ToolNotFoundError", async () => {
  await assertRejects(
    () => ArgoRolloutsTasks.version(missingTool),
    ToolNotFoundError,
  );
});

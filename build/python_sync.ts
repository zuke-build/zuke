// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Starting the Python SDK's engine sync when a CLI release is published.
 *
 * zuke-build/zuke-python follows the newest `cli-v*` release, the commit the
 * standalone binary is compiled from: its tool spec, wrapper versions,
 * conformance cases and engine pin. Its `sync` workflow vendors them and opens
 * or updates one pull request. It runs on `workflow_dispatch` only, so this
 * repository's release pipeline starts it once the release it follows exists,
 * rather than the SDK polling for one.
 *
 * @module
 */

import { GhTasks, type GhWorkflowRunSettings } from "@zuke/gh";

/** The Python SDK's repository. */
export const PYTHON_REPO = "zuke-build/zuke-python";

/** Its engine sync workflow, which `build.py`'s `sync_workflow` generates. */
export const PYTHON_SYNC_WORKFLOW = "sync.yml";

/** The `gh workflow run` {@link startPythonSync} runs, injectable for tests. */
export type WorkflowRun = (
  configure: (s: GhWorkflowRunSettings) => GhWorkflowRunSettings,
) => Promise<unknown>;

/**
 * Dispatch the Python SDK's engine sync on its default branch, as `token`:
 * an app token for {@link PYTHON_REPO} that may write its actions.
 */
export async function startPythonSync(
  token: string,
  run: WorkflowRun = (configure) => GhTasks.workflowRun(configure),
): Promise<void> {
  await run((s) =>
    s.workflow(PYTHON_SYNC_WORKFLOW).ref("main").repo(PYTHON_REPO)
      .env({ GH_TOKEN: token })
  );
}

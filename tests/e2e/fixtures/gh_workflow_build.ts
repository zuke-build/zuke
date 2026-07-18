/**
 * A runnable Zuke build for the githubWorkflow e2e suite. Run as a subprocess
 * (`deno run -A gh_workflow_build.ts <target|resume ...>`), it waits on a
 * `githubWorkflow(...)` gate whose GitHub API is a file-backed fake: `dispatch`
 * appends the marker to `GH_DISPATCH_FILE`, and the run's status/conclusion come
 * from `GH_RUN_STATUS` / `GH_RUN_CONCLUSION`. Two real processes — dispatch then
 * `resume --check` — exercise the cross-process correlation state without a real
 * GitHub. `run()` reads `ZUKE_STATE_DIR` for its durable state.
 *
 * @module
 */

import { Build, run, target } from "../../../packages/core/mod.ts";
import type {
  GhWorkflowApi,
  WorkflowJob,
  WorkflowRun,
} from "../../../packages/gh/src/workflow.ts";
import {
  githubWorkflowWith,
  readWorkflowResult,
} from "../../../packages/gh/src/workflow.ts";

const dispatchFile = Deno.env.get("GH_DISPATCH_FILE");
const status = Deno.env.get("GH_RUN_STATUS") ?? "in_progress";
const conclusion = Deno.env.get("GH_RUN_CONCLUSION") ?? "";

/** A file-backed fake: `dispatch` records the marker; status comes from the env. */
const api: GhWorkflowApi = {
  dispatch(_repo, _workflow, _ref, inputs): Promise<void> {
    if (dispatchFile !== undefined) {
      Deno.writeTextFileSync(dispatchFile, `${inputs.zuke_marker}\n`, {
        append: true,
      });
    }
    return Promise.resolve();
  },
  findRun(): Promise<WorkflowRun | null> {
    return Promise.resolve({
      id: 777,
      status,
      conclusion: conclusion === "" ? null : conclusion,
      url: "https://gh/r777",
    });
  },
  getRun(): Promise<WorkflowRun> {
    return Promise.resolve({
      id: 777,
      status,
      conclusion: conclusion === "" ? null : conclusion,
      url: "https://gh/r777",
    });
  },
  listJobs(): Promise<WorkflowJob[]> {
    return Promise.resolve([
      {
        name: "e2e",
        conclusion: conclusion === "" ? "" : conclusion,
        url: "j",
      },
    ]);
  },
};

/** A gate that awaits an external workflow, then a ship step that reads its result. */
class Cd extends Build {
  /** Dispatches the workflow and suspends until it completes. */
  e2e = target().waitsFor((s) =>
    s.on(
      githubWorkflowWith((g) => g.repo("acme/app").workflow("e2e.yml"), {
        api,
      }),
    )
  );
  /** Runs after the gate opens, printing the gate's published result. */
  ship = target().dependsOn(this.e2e).executes((ctx) => {
    const result = readWorkflowResult(ctx.stateOf("e2e"));
    console.log(
      `SHIPPED:passed=${result?.passed}:conclusion=${result?.conclusion}`,
    );
  });
}

await run(Cd);

/**
 * `@zuke/gh` — typed GitHub tooling for Zuke builds: the `gh` (GitHub CLI) task
 * wrapper plus {@link githubWorkflow}, a wait trigger that dispatches and awaits
 * an external GitHub Actions workflow.
 *
 * ```ts
 * import { GhTasks, githubWorkflow } from "jsr:@zuke/gh";
 *
 * await GhTasks.run((s) => s.command("pr", "list").flag("state", "open"));
 *
 * // In a build: suspend until an e2e workflow in another repo finishes.
 * e2e = target().waitsFor((s) =>
 *   s.on(githubWorkflow((g) => g.repo("acme/app").workflow("e2e.yml")))
 * );
 * ```
 *
 * @module
 */

export * from "./src/gh.ts";
export {
  type CorrelateMode,
  githubWorkflow,
  GithubWorkflowSettings,
  readWorkflowResult,
  WorkflowCorrelationError,
  type WorkflowJob,
  type WorkflowResult,
} from "./src/workflow.ts";

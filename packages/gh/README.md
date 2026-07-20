# @zuke/gh

Typed [`gh`](https://cli.github.com/) (GitHub CLI) task wrapper for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. `gh` is broad, so this is a flexible command builder: name
the command with `.command(...)`, set `--repo`, and pass anything else with
`.flag(...)`. Arguments stay a discrete argv array, so command construction is
injection-free.

```ts
import { GhTasks } from "jsr:@zuke/gh";

await GhTasks.run((s) =>
  s.command("release", "create", "v1.2.3")
    .repo("acme/app")
    .flag("title", "v1.2.3")
    .flag("generate-notes")
);

await GhTasks.run((s) => s.command("pr", "list").flag("state", "open"));
```

## Wait for an external GitHub workflow

`githubWorkflow` is a Zuke
[wait trigger](https://github.com/zuke-build/zuke/blob/master/docs/orchestration.md):
it dispatches a GitHub Actions workflow (often in another repo), **suspends the
run until it finishes**, and resurfaces its per-job conclusions — replacing
hand-rolled "dispatch, then poll `gh run list`" glue.

```ts
import { Build, run, target } from "jsr:@zuke/core";
import { githubWorkflow, readWorkflowResult } from "jsr:@zuke/gh";

class Release extends Build {
  e2e = target().waitsFor((s) =>
    s.on(
      githubWorkflow((g) => g.repo("acme/app").workflow("e2e.yml").ref("main")),
    )
      .timeout("2h").onTimeout(() => this.rollback)
  );
  ship = target().dependsOn(this.e2e).executes((ctx) => {
    const result = readWorkflowResult(ctx.stateOf("e2e"));
    if (!result?.passed) throw new Error("e2e suite failed");
  });
  rollback = target().executes(() => rollBack());
}

await run(Release);
```

- **Dispatch-once, then poll.** It dispatches on first reach, records a
  correlation marker in the gate's durable state, and suspends. Each
  `zuke resume --check` polls; a resume in a **different process** never
  re-dispatches.
- **Correlation.** `workflow_dispatch` returns no run id, so by default the
  trigger passes a marker input (default `zuke_marker`) and matches it against
  the run's display title — the dispatched workflow must echo it:
  `run-name: ${{ inputs.zuke_marker }}`. For a workflow you can't modify, use
  `.correlate("created-window")` to claim the run created just after dispatch on
  the dispatch ref (best-effort; loud on ambiguity).
- **Fast-fail.** If no run is identified within `.discoveryTimeout(...)`
  (default one minute), the gate fails with guidance rather than eating the
  whole `.timeout()` — measured from the persisted dispatch time, so it survives
  suspend/resume.
- **Result.** The per-job conclusions are published to the gate target's state;
  a dependent reads them with `readWorkflowResult(ctx.stateOf("<gate>"))`.
- **Auth** uses `GH_TOKEN` / `GITHUB_TOKEN`; the GitHub API is an injectable
  transport, so builds are testable without hitting GitHub.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/gh` — typed GitHub tooling for Zuke builds: the `gh` (GitHub CLI) task
wrapper plus {@link githubWorkflow}, a wait trigger that dispatches and awaits
an external GitHub Actions workflow.

```ts
import { GhTasks, githubWorkflow } from "jsr:@zuke/gh";

await GhTasks.run((s) => s.command("pr", "list").flag("state", "open"));

// In a build: suspend until an e2e workflow in another repo finishes.
e2e = target().waitsFor((s) =>
  s.on(githubWorkflow((g) => g.repo("acme/app").workflow("e2e.yml")))
);
```
@module

function githubWorkflow(configure: (settings: GithubWorkflowSettings) => GithubWorkflowSettings): WaitTrigger
  A {@link "@zuke/core".WaitTrigger} that dispatches a GitHub Actions workflow,
  suspends the run until it finishes, and records its per-job conclusions to the
  awaiting target's state (read them with {@link readWorkflowResult}). See the
  module docs for the `run-name` correlation requirement and auth.

  ```ts
  githubWorkflow((g) => g.repo("acme/app").workflow("e2e.yml").ref("main"))
  ```

function readWorkflowResult(state: TargetStateHandle): WorkflowResult | undefined
  Read the {@link WorkflowResult} a completed {@link githubWorkflow} wait wrote
  to a target's state, or `undefined` if the wait has not completed (or this is
  not a github-workflow gate). Call it from a dependent target's body with
  the gate's handle: `readWorkflowResult(ctx.stateOf("<gate-target>"))`.

const GhTasks: GhTasksApi
  Typed task functions for the `gh` GitHub CLI.

class GhSettings extends ToolSettings
  Settings for a `gh` invocation.

  override protected defaultTool(): string
    The default executable name: `gh`.
  command(...parts: Array<string | number>): this
    The command path and verb, e.g. `command("pr", "create")`.
  repo(slug: string): this
    Target repository as `OWNER/REPO` (`-R`/`--repo`).
  flag(name: string, value?: string | number): this
    Add an arbitrary flag. With a value it renders `--name value`; without one
    it renders the bare `--name`. Repeatable.
  override protected buildArgs(): string[]
    Assemble the `gh` argv: command path, then `--repo`, then flags.

class GithubWorkflowSettings
  Configuration for {@link githubWorkflow}, set through a settings lambda. Every
  setter returns `this` so calls chain; `repo` and `workflow` are required.

  repo_?: string
    The `OWNER/REPO` slug the workflow lives in.
  workflow_?: string
    The workflow file name (e.g. `e2e.yml`) or its numeric id.
  ref_: string
    The git ref to dispatch against (default `main`).
  inputs_: Record<string, string>
    Extra `workflow_dispatch` inputs.
  markerInput_: string
    The input name the marker is passed as (default `zuke_marker`).
  correlateMode_: CorrelateMode
    How the dispatched run is correlated (default `"marker"`); set by {@link correlate}.
  discoveryTimeoutMs_?: number
    How long to wait for the run to appear before failing fast (ms); set by {@link discoveryTimeout}.
  pollIntervalMs_?: number
    Poll interval hint (ms) for `zuke resume --check`.
  repo(slug: string): this
    Set the `OWNER/REPO` the workflow lives in.
  workflow(idOrFile: string): this
    Set the workflow file name (e.g. `e2e.yml`) or numeric id.
  ref(ref: string): this
    Set the git ref to dispatch against (default `main`).
  input(name: string, value: string): this
    Add one `workflow_dispatch` input.
  inputs(map: Record<string, string>): this
    Merge a map of `workflow_dispatch` inputs.
  markerInput(name: string): this
    Change the input name the correlation marker is dispatched as.
  correlate(mode: CorrelateMode): this
    How the dispatched run is correlated: `"marker"` (default) matches the
    marker echoed into the run's `run-name:`; `"created-window"` claims the
    `workflow_dispatch` run on the dispatch ref created just after dispatch —
    a best-effort fallback for a workflow that cannot echo the marker.
  discoveryTimeout(duration: string): this
    How long after dispatch to keep looking for the run before failing fast with
    guidance (a duration string; default one minute). Bounds the "workflow never
    echoed the marker" failure so it surfaces in ~a minute instead of eating the
    whole `.timeout()`.
  pollEvery(duration: string): this
    Set how often `zuke resume --check` should re-poll (a duration string).

class WorkflowCorrelationError extends Error
  A {@link githubWorkflow} correlation failure the wait must not swallow as a
  transient blip: the dispatched run could not be identified (it never echoed the
  marker within the discovery window, or created-window correlation found more
  than one candidate). Thrown from the trigger so the waiting target fails with
  guidance instead of eating the whole `.timeout()`.

  override name: string
    The error name, `"WorkflowCorrelationError"`.

interface GhTasksApi
  The shape of {@link GhTasks}.

  run(configure?: Configure<GhSettings>): Promise<CommandOutput>
    Run a `gh` command.

interface WorkflowJob
  One job's outcome within a completed workflow run.

  name: string
    The job's name.
  conclusion: string
    Its conclusion (`success`, `failure`, `cancelled`, `skipped`, …).
  url: string
    A link to the job on GitHub.

interface WorkflowResult
  The payload a completed {@link githubWorkflow} wait writes to the awaiting
  target's state; read it in a dependent body with {@link readWorkflowResult}.

  passed: boolean
    True when the run's overall conclusion was `success`.
  conclusion: string
    The run's overall conclusion.
  runId: number
    The dispatched run's numeric id.
  url: string
    A link to the run on GitHub.
  jobs: WorkflowJob[]
    Each job's conclusion, so a build can branch on which suite failed.

type CorrelateMode = "marker" | "created-window"
  How {@link githubWorkflow} correlates the run it dispatched:

  - `"marker"` — match the `zuke:<runId>:<target>` marker echoed into the run's
    `run-name:` (exact, but the target workflow must opt in).
  - `"created-window"` — claim the `workflow_dispatch` run on the dispatch ref
    created just after dispatch; best-effort, for workflows that can't echo
    the marker (fails loudly if two candidates are in the window).
````

</details>

<!-- ZUKE:API:END -->

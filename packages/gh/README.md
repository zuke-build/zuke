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

async function mintAppToken(configure?: Configure<GhAppTokenSettings>): Promise<GhAppTokenResult>
  Mint an installation token from the settings a lambda configures.

function readWorkflowResult(state: TargetStateHandle): WorkflowResult | undefined
  Read the {@link WorkflowResult} a completed {@link githubWorkflow} wait wrote
  to a target's state, or `undefined` if the wait has not completed (or this is
  not a github-workflow gate). Call it from a dependent target's body with
  the gate's handle: `readWorkflowResult(ctx.stateOf("<gate-target>"))`.

async function uploadSarifReport(configure?: Configure<GhSarifSettings>): Promise<GhSarifUploadResult>
  Upload the SARIF report the settings describe.

const GhTasks: GhTasksApi
  Typed task functions for GitHub: the `gh` CLI and the REST-only operations.

class GhAppTokenSettings
  Settings for {@link GhAppTokenApi.appToken}.

  appId_?: string
    The app's numeric id. Set by {@link appId}.
  privateKey_?: string
    The app's PEM private key. Set by {@link privateKey}.
  owner_?: string
    The account the app is installed on. Set by {@link owner}.
  repositories_: string[]
    Repositories to scope the token to. Set by {@link repositories}.
  permissions_: Record<string, GhPermissionLevel>
    Requested permissions. Set by {@link permission}.
  baseUrl_: string
    REST base URL. Set by {@link baseUrl}.
  fetch_: typeof fetch
    The `fetch` implementation. Set by {@link fetch}.
  now_: () => number
    Seconds since the epoch, for the JWT's claims. Set by {@link now}.
  appId(id: string | number): this
    The GitHub App's id (the `App ID` on its settings page).
  privateKey(pem: string): this
    The app's private key, as the PEM's contents — GitHub issues PKCS#1
    (`BEGIN RSA PRIVATE KEY`); PKCS#8 is accepted too.
  owner(login: string): this
    The user or organisation the app is installed on.
  repositories(...names: string[]): this
    Scope the token to these repositories (names only, without the owner).
    Omit to cover every repository the installation can reach — prefer naming
    them, so a leaked token is narrow.
  permission(name: string, level: GhPermissionLevel): this
    Request one permission, e.g. `.permission("contents", "write")`. Repeatable.
    Narrowing to what the target needs beats inheriting the app's full set;
    requesting more than the installation grants is an error from GitHub.
  baseUrl(url: string): this
    Use a different REST base (GitHub Enterprise Server).
  fetch(fn: typeof fetch): this
    Override the `fetch` implementation (a test seam).
  now(seconds: () => number): this
    Override the clock, in seconds since the epoch (a test seam).
  async jwt_(): Promise<string>
    Sign the app JWT this settings object describes.
  installationPath_(): string
    The path that resolves this app's installation id.
  tokenRequest_(): Record<string, unknown>
    The `access_tokens` request body — only the fields that were narrowed.

class GhSarifSettings
  Settings for {@link GhSarifApi.uploadSarif}.

  file_?: string
    The SARIF file to upload. Set by {@link file}.
  repo_?: string
    `owner/repo` to upload for. Set by {@link repo}.
  commit_?: string
    The commit the results describe. Set by {@link commit}.
  ref_?: string
    The ref the results describe. Set by {@link ref}.
  token_?: string
    The token to authenticate with. Set by {@link token}.
  checkoutUri_?: string
    Where the checkout that produced the results lives. Set by {@link checkoutUri}.
  baseUrl_: string
    REST base URL. Set by {@link baseUrl}.
  fetch_: typeof fetch
    The `fetch` implementation. Set by {@link fetch}.
  file(path: PathLike): this
    The SARIF report to upload (required).
  repo(slug: string): this
    The `owner/repo` to upload for. Defaults to `GITHUB_REPOSITORY`.
  commit(sha: string): this
    The commit SHA the results describe. Defaults to `GITHUB_SHA`.
  ref(ref: string): this
    The full ref the results describe (`refs/heads/main`). Defaults to `GITHUB_REF`.
  token(value: string): this
    The token to authenticate with — needs `security-events: write`. Defaults to
    `GITHUB_TOKEN` in the environment, so it never has to reach argv.
  checkoutUri(uri: string): this
    The URI of the checkout the results are relative to (`file:///…`).
  baseUrl(url: string): this
    Use a different REST base (GitHub Enterprise Server).
  fetch(fn: typeof fetch): this
    Override the `fetch` implementation (a test seam).
  repoSlug_(): string
    The effective `owner/repo`, from the setting or the Actions environment.
  async body_(): Promise<Record<string, string>>
    The request body. The `sarif` field is the report gzipped then base64'd,
    which is what the endpoint accepts — a plain JSON body is rejected.

class GhSettings extends SubcommandSettings
  Settings for a `gh` invocation.

  override protected defaultTool(): string
    The default executable name: `gh`.
  repo(slug: string): this
    Target repository as `OWNER/REPO` (`-R`/`--repo`).
  override protected middleTokens(): string[]
    Emit `--repo <slug>` between the command path and the flags, when set.

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

interface GhAppTokenApi
  The shape of the app-token task, mixed into `GhTasks`.

  appToken(configure?: Configure<GhAppTokenSettings>): Promise<GhAppTokenResult>
    Mint a GitHub App installation token, scoped to the repositories and
    permissions the settings request. The returned token is registered with the
    Actions log masker, so it is safe to pass onward through `env`.

interface GhAppTokenResult
  A minted installation token and when it stops working.

  token: string
    The installation token, usable as a bearer token or a git password.
  expiresAt: string
    ISO-8601 expiry — one hour out, as GitHub issues it.
  installationId: number
    The installation the token was minted for.

interface GhSarifApi
  The shape of the SARIF task, mixed into `GhTasks`.

  uploadSarif(configure?: Configure<GhSarifSettings>): Promise<GhSarifUploadResult>
    Upload a SARIF report to GitHub code scanning, so its findings land in the
    repository's Security tab. Needs a token with `security-events: write`.

interface GhSarifUploadResult
  What GitHub returns for an accepted SARIF upload.

  id: string
    The opaque id of the upload, for polling its processing status.
  url: string
    The URL that reports whether GitHub finished processing the report.

interface GhTasksApi extends GhAppTokenApi, GhSarifApi
  The shape of {@link GhTasks}: the `gh` CLI plus the GitHub operations that
  have no CLI subcommand (see {@link GhAppTokenApi}, {@link GhSarifApi}) and
  would otherwise force a build back to a marketplace action.

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

type GhPermissionLevel = "read" | "write" | "admin"
  A permission level an installation token can be narrowed to.
````

</details>

<!-- ZUKE:API:END -->

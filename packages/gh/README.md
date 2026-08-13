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

## Post a check run without duplicating it

`GhTasks.checkRun` posts a **completed** check run for a commit, updating the
one already there instead of creating a second. The GitHub API is create-only,
so a caller that retries — a re-run step, a supervisor finishing work a dead
process started — otherwise leaves several check runs of one name on a commit,
and the newest silently wins. That matters when the name is a **required status
context**.

```ts
import { GhTasks } from "jsr:@zuke/gh";

// A token scoped to this one job: `checks: write` and nothing else.
const { token } = await GhTasks.appToken((s) =>
  s.appId(appId).privateKey(key).repositories("acme/app").permission(
    "checks",
    "write",
  )
);

await GhTasks.checkRun((s) =>
  s.repo("acme/app")
    .name("CI / Required checks")
    .headSha(headSha) // pinned when the work started, not resolved now
    .conclusion(passed ? "success" : "failure")
    .summary("11 of 12 checks passed")
    .externalId(`${runId}/gate`)
    .token(token)
);
```

- **Upsert by convergence, not atomically.** The lookup and the write are two
  calls, so two callers racing on a commit with no check run yet can both create
  one, and nothing here orders two conclusions written at the same moment. What
  it removes is the _serial_ duplicate — the retry, the re-drive — which is the
  case that actually happens. Callers that need one answer must agree on it
  before they get here.
- **`externalId` is identity, when set.** Only a check run carrying that id is a
  candidate, so two callers reporting under one context stay distinct — and the
  match is symmetric, so a caller that sets no id never adopts one that did.
  With no id on either side, the name alone decides and the newest wins.
- **A check run owned by another app is replaced, not updated.** Only the app
  that created a check run may update it, so a refusal means "not ours" and a
  new one is posted instead. That is what keeps this working during a migration,
  while the workflow being replaced still posts the same name.
- **Completed only.** A conclusion is required: a pending check run whose poster
  dies never settles, and for a required context that is a pull request that can
  never merge.
- **Pin the head SHA.** Resolving it at post time reports on whatever has been
  pushed since — a green required check on a commit nothing tested.

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

function assertRefName(name: string, what: string): void
  Reject a branch or tag name that git itself would.

  Not cosmetic. These names are interpolated into request paths, and URL
  normalisation resolves `..` before the request is sent — so
  `../../../user/repos` as a branch turns `/repos/o/n/git/ref/heads/<branch>`
  into `/repos/o/n/user/repos`, sending a write-scoped token somewhere the
  caller never named. Validating here rather than trusting every caller is the
  difference between an API that is safe to hand a string and one that is safe
  only when used carefully.

  The rules are git's own (see `git check-ref-format`), minus those that only
  matter for multi-level refs.

async function commitFiles(configure?: (settings: GhCommitSettings) => GhCommitSettings): Promise<GhCommitResult>
  Perform the configured commit.

async function findPullRequest(configure?: (settings: GhPullRequestSettings) => GhPullRequestSettings): Promise<GhPullRequestResult | undefined>
  Look for an open pull request without opening one.

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

async function openPullRequest(configure?: (settings: GhPullRequestSettings) => GhPullRequestSettings): Promise<GhPullRequestResult>
  Perform the configured pull request.

async function postCheckRun(configure?: (settings: GhCheckRunSettings) => GhCheckRunSettings): Promise<GhCheckRunResult>
  Perform the configured check run.

function readWorkflowResult(state: TargetStateHandle): WorkflowResult | undefined
  Read the {@link WorkflowResult} a completed {@link githubWorkflow} wait wrote
  to a target's state, or `undefined` if the wait has not completed (or this is
  not a github-workflow gate). Call it from a dependent target's body with
  the gate's handle: `readWorkflowResult(ctx.stateOf("<gate-target>"))`.

async function tagCommit(configure?: (settings: GhTagSettings) => GhTagSettings): Promise<void>
  Perform the configured tag.

async function uploadReleaseAsset(configure?: Configure<GhReleaseAssetSettings>): Promise<GhReleaseAssetResult>
  Upload the release asset the settings describe.

async function uploadSarifReport(configure?: Configure<GhSarifSettings>): Promise<GhSarifUploadResult>
  Upload the SARIF report the settings describe.

const GhTasks: GhTasksApi
  Typed task functions for GitHub: the `gh` CLI and the REST-only operations.

class GhApiError extends Error
  A GitHub REST call that did not succeed, carrying the status.

  The status is the point. Callers recover from specific failures — a missing
  ref, a pull request that already exists — and doing that on a bare `catch`
  would swallow an expired token or a missing permission and retry it as
  though it were the expected case.

  constructor(method: string, path: string, status: number, body: string)
    Build the error from the failing call's method, path, status and body.
  override name: string
    The error name.
  readonly status: number
    The HTTP status of the failing response.

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

    The API names multi-word permissions with underscores (`pull_requests`), so
    a hyphen is normalised to one. That spelling is the trap here:
    `create-github-app-token` takes its inputs as `permission-pull-requests`,
    and passing that form straight through is rejected as a permission the
    installation does not grant — which reads as a misconfigured app rather
    than a misspelled key.
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

class GhCheckRunSettings
  Settings for posting a completed check run.

  `owner/repo` and the token fall back to the Actions environment, so a job
  that already has them names only what it is reporting.

  name_?: string
    The check run's name — half of its identity. Set by {@link name}.
  headSha_?: string
    The commit it reports on. Set by {@link headSha}.
  conclusion_?: GhCheckConclusion
    The conclusion to report. Set by {@link conclusion}.
  title_?: string
    The output panel's title. Set by {@link title}.
  summary_?: string
    The output panel's markdown body. Set by {@link summary}.
  externalId_?: string
    The caller's own correlation id. Set by {@link externalId}.
  detailsUrl_?: string
    Where the check run's "Details" link points. Set by {@link detailsUrl}.
  repo_?: string
    `owner/repo`. Set by {@link repo}.
  token_?: string
    The token. Set by {@link token}.
  baseUrl_: string
    The API root. Set by {@link baseUrl}.
  fetch_: typeof fetch
    The `fetch` implementation. Set by {@link fetch}.
  name(value: string): this
    The check run's name — what appears in the PR's checks list, and what a
    branch protection rule names as a required status context.
  headSha(sha: string): this
    The full SHA of the commit being reported on.

    Pin this at the start of the work, not when the result is posted. A caller
    that resolves the head of a pull request at post time reports on whatever
    has been pushed since — which, for a required context, is a green check on
    a commit nothing ever tested.
  conclusion(value: GhCheckConclusion): this
    The conclusion to report.
  title(text: string): this
    The output panel's title. Defaults to the check run's name.
  summary(markdown: string): this
    The output panel's body, as markdown.
  externalId(id: string): this
    A correlation id of the caller's own, stored on the check run.

    Also what this operation matches on when deciding whether a check run is
    "the same one": with an external id set, two callers writing the same name
    on the same commit for different reasons stay distinct, and a re-drive of
    one of them updates its own check run rather than the other's.
  detailsUrl(url: string): this
    Where the check run's "Details" link points.
  repo(slug: string): this
    `owner/repo`. Defaults to `GITHUB_REPOSITORY`.
  token(value: string): this
    The token to authenticate with. Defaults to `GITHUB_TOKEN`.
  baseUrl(url: string): this
    The API root, for GitHub Enterprise.
  fetch(fn: typeof fetch): this
    Override the `fetch` implementation (a test seam).
  repoSlug_(): string
    The effective `owner/repo`, from the setting or the environment.
  authToken_(): string
    The effective token, from the setting or the environment.

class GhCommitSettings
  Settings for committing files through the API.

  `owner/repo` and the token fall back to the Actions environment, so a job
  that already has them needs to name only what it is committing.

  files_: Map<string, string>
    The files to write, by path.
  branch_?: string
    The branch to commit onto. Set by {@link branch}.
  from_?: string
    The branch to create from, when creating one. Set by {@link from}.
  replace_: boolean
    Whether an existing {@link branch} is reset. Set by {@link replace}.
  message_?: string
    The commit message. Set by {@link message}.
  repo_?: string
    `owner/repo`. Set by {@link repo}.
  token_?: string
    The token. Set by {@link token}.
  baseUrl_: string
    The API root. Set by {@link baseUrl}.
  fetch_: typeof fetch
    The `fetch` implementation. Set by {@link fetch}.
  file(path: string, content: string): this
    Add a file to the commit, replacing any earlier one at the same path.
  branch(name: string): this
    The branch to commit onto. It must exist unless {@link from} is set.
  from(base: string): this
    Create {@link branch} from this one rather than committing onto an
    existing branch. Creating a ref and moving one are different calls, and
    which is wanted is the caller's to say rather than something to infer.
  replace(): this
    Reset {@link branch} onto {@link from} when it already exists, rather than
    failing because it does.

    For a branch only one automated caller ever writes, and whose contents are
    regenerated in full each time. Without this, a job that creates the branch
    and then fails before opening its pull request can never retry: the second
    run is refused because the ref it wants to create is already there, and the
    work is stuck until someone deletes the branch by hand.

    Deliberately not the default. Discarding commits on a branch that already
    exists is exactly what should not happen to a branch someone is working on,
    so it stays something the caller asks for.
  message(text: string): this
    The commit message.
  repo(slug: string): this
    `owner/repo`. Defaults to `GITHUB_REPOSITORY`.
  token(value: string): this
    The token to authenticate with. Defaults to `GITHUB_TOKEN`.
  baseUrl(url: string): this
    The API root, for GitHub Enterprise.
  fetch(fn: typeof fetch): this
    Override the `fetch` implementation (a test seam).
  repoSlug_(): string
    The effective `owner/repo`, from the setting or the environment.
  authToken_(): string
    The effective token, from the setting or the environment.

class GhPullRequestSettings
  Settings for opening a pull request.

  `owner/repo` and the token fall back to the Actions environment, so a job
  that already has them needs to name only what it is proposing.

  head_?: string
    The branch being proposed. Set by {@link head}.
  base_?: string
    The branch it targets. Set by {@link base}.
  title_?: string
    The title. Set by {@link title}.
  body_: string
    The body. Set by {@link body}.
  repo_?: string
    `owner/repo`. Set by {@link repo}.
  token_?: string
    The token. Set by {@link token}.
  baseUrl_: string
    The API root. Set by {@link baseUrl}.
  fetch_: typeof fetch
    The `fetch` implementation. Set by {@link fetch}.
  head(branch: string): this
    The branch being proposed.
  base(branch: string): this
    The branch it targets.
  title(text: string): this
    The pull request's title.
  body(text: string): this
    The pull request's body.
  repo(slug: string): this
    `owner/repo`. Defaults to `GITHUB_REPOSITORY`.
  token(value: string): this
    The token to authenticate with. Defaults to `GITHUB_TOKEN`.
  baseUrl(url: string): this
    The API root, for GitHub Enterprise.
  fetch(fn: typeof fetch): this
    Override the `fetch` implementation (a test seam).
  repoSlug_(): string
    The effective `owner/repo`, from the setting or the environment.
  authToken_(): string
    The effective token, from the setting or the environment.

class GhReleaseAssetSettings
  Settings for {@link GhReleaseAssetApi.uploadReleaseAsset}.

  file_?: string
    The file to upload. Set by {@link file}.
  name_?: string
    The asset name on the release. Set by {@link name}.
  contentType_?: string
    The asset's `content-type`. Set by {@link contentType}.
  repo_?: string
    `owner/repo` to upload to. Set by {@link repo}.
  tag_?: string
    The release tag to attach to. Set by {@link tag}.
  token_?: string
    The token to authenticate with. Set by {@link token}.
  baseUrl_: string
    REST base URL. Set by {@link baseUrl}.
  fetch_: typeof fetch
    The `fetch` implementation. Set by {@link fetch}.
  file(path: PathLike): this
    The file to upload (required).
  name(value: string): this
    The asset's name on the release. Defaults to the file's base name.
  contentType(value: string): this
    The asset's `content-type`. Defaults by extension (`.tar.gz`/`.tgz`,
    `.zip`, `.json`), then to `application/octet-stream`.
  repo(slug: string): this
    The `owner/repo` to upload to. Defaults to `GITHUB_REPOSITORY`.
  tag(value: string): this
    Attach to the release with this tag instead of the latest release.
  token(value: string): this
    The token to authenticate with — needs `contents: write`. Defaults to
    `GITHUB_TOKEN` in the environment, so it never has to reach argv.
  baseUrl(url: string): this
    Use a different REST base (GitHub Enterprise Server).
  fetch(fn: typeof fetch): this
    Override the `fetch` implementation (a test seam).
  repoSlug_(): string
    The effective `owner/repo`, from the setting or the Actions environment.
  filePath_(): string
    The file to upload, or a friendly error naming the missing setting.
  assetName_(): string
    The effective asset name: the setting, or the file's base name.
  effectiveContentType_(): string
    The effective `content-type`: the setting, or inferred by extension.

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

class GhTagSettings
  Settings for pointing a tag at a commit.

  name_?: string
    The tag name. Set by {@link name}.
  commit_?: string
    The commit the tag points at. Set by {@link commit}.
  message_?: string
    The annotation message. Set by {@link message}.
  move_: boolean
    Whether to move an existing tag. Set by {@link move}.
  repo_?: string
    `owner/repo`. Set by {@link repo}.
  token_?: string
    The token. Set by {@link token}.
  baseUrl_: string
    The API root. Set by {@link baseUrl}.
  fetch_: typeof fetch
    The `fetch` implementation. Set by {@link fetch}.
  name(value: string): this
    The tag name, e.g. `v1.2.3`.
  commit(sha: string): this
    The commit SHA to tag. Defaults to `GITHUB_SHA`.
  message(text: string): this
    The annotation message. Defaults to the tag name.
  move(): this
    Move the tag if it already exists, rather than failing.

    Forced by necessity: pointing a major tag at a newer release is a
    non-fast-forward by definition. A tag that does not exist yet is created,
    since for the first release of a major those are the same intent.
  repo(slug: string): this
    `owner/repo`. Defaults to `GITHUB_REPOSITORY`.
  token(value: string): this
    The token to authenticate with. Defaults to `GITHUB_TOKEN`.
  baseUrl(url: string): this
    The API root, for GitHub Enterprise.
  fetch(fn: typeof fetch): this
    Override the `fetch` implementation (a test seam).
  repoSlug_(): string
    The effective `owner/repo`, from the setting or the environment.
  authToken_(): string
    The effective token, from the setting or the environment.

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

interface GhCheckRunApi
  The check-run operation {@link GhTasks} exposes.

  checkRun(configure?: (settings: GhCheckRunSettings) => GhCheckRunSettings): Promise<GhCheckRunResult>
    Post a completed check run for `.headSha(...)` named `.name(...)`, updating
    the one already on that commit if there is one.

    The lookup and the write are two calls, so this is an upsert by
    convergence, not an atomic one: two callers racing on a commit that has no
    check run yet can both find nothing and both create one. What it removes is
    the serial duplicate — the retry, the re-drive, the supervisor finishing
    a dead process's work — which is the case that actually happens.

interface GhCheckRunResult
  The check run a {@link GhCheckRunApi.checkRun} call left on the commit.

  id: number
    Its numeric id.
  url: string
    Its web URL.
  created: boolean
    Whether this call created it, as opposed to updating one already there.

    Worth reporting rather than hiding: a caller that expected to create and
    updated instead has learned that something else posted first, which is the
    difference between a first attempt and a re-drive.

interface GhCommitApi
  The commit and tag operations {@link GhTasks} exposes.

  commit(configure?: (settings: GhCommitSettings) => GhCommitSettings): Promise<GhCommitResult>
    Commit files through the API, with no git credential on disk.

    Commits onto `.branch(...)`, or creates it from `.from(...)` when that is
    set. The ref update is not forced, so a commit landing between reading the
    head and writing it is rejected rather than silently overwritten — unless
    `.replace()` is set, which resets an existing branch onto its base and
    discards whatever was on it.
  tag(configure?: (settings: GhTagSettings) => GhTagSettings): Promise<void>
    Point an annotated tag at a commit, creating or moving its ref.

interface GhCommitResult
  The commit a {@link GhTasksApi.commit} call created.

  sha: string
    The new commit's SHA.
  branch: string
    The branch it landed on.

interface GhPullRequestApi
  The pull-request operation {@link GhTasks} exposes.

  pullRequest(configure?: (settings: GhPullRequestSettings) => GhPullRequestSettings): Promise<GhPullRequestResult>
    Open a pull request from `.head(...)` onto `.base(...)`, or return the one
    already open for that branch.

    Idempotent on purpose. An unattended job that proposes the same branch
    twice — because a later step failed and the whole thing ran again — should
    find its existing proposal rather than fail on it.

    An existing pull request is returned as it stands: the title and body set
    here are not written over it, since the caller asked for a proposal to
    exist and one does. `created` says which happened.
  findPullRequest(configure?: (settings: GhPullRequestSettings) => GhPullRequestSettings): Promise<GhPullRequestResult | undefined>
    Find the open pull request from `.head(...)` onto `.base(...)`, without
    opening one.

    For a caller that must know whether a proposal already exists before it
    writes anything — because the answer changes what it should do, not just
    what it should report. Opening one to find out is not a substitute: by
    then the branch it would have to prepare has already been written.

interface GhPullRequestResult
  The pull request a {@link GhPullRequestApi.pullRequest} call resolved to.

  number: number
    Its number.
  url: string
    Its web URL.
  created: boolean
    Whether this call opened it, as opposed to finding one already open.

    Worth reporting rather than hiding: "proposed" and "already proposed" are
    different things to a human reading a build log, even though neither is a
    failure.

interface GhReleaseAssetApi
  The shape of the release-asset task, mixed into `GhTasks`.

  uploadReleaseAsset(configure?: Configure<GhReleaseAssetSettings>): Promise<GhReleaseAssetResult>
    Attach a file to a GitHub release — the latest release by default, or the
    one named by `.tag(...)`. Idempotent: an asset the release already
    carries under the same name is kept as-is, and a repository with no
    releases resolves to `state: "no-release"` rather than throwing. Needs a
    token with `contents: write`.

interface GhReleaseAssetResult
  What became of a release-asset upload.

  state: "uploaded" | "already-exists" | "no-release"
    `uploaded` when the asset was sent; `already-exists` when the release
    carries an asset of the same name (nothing was changed); `no-release`
    when the repository has no release to attach to.
  name: string
    The asset name the call targeted.
  releaseTag?: string
    The tag of the release the asset belongs to, when one was resolved.
  releaseId?: number
    The id of the release the asset belongs to, when one was resolved.
  url?: string
    The asset's download URL, when it was uploaded or already present.

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

interface GhTasksApi extends GhAppTokenApi, GhSarifApi, GhReleaseAssetApi, GhCommitApi, GhPullRequestApi, GhCheckRunApi
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

type GhCheckConclusion = "success" | "failure" | "neutral" | "cancelled" | "skipped" | "timed_out" | "action_required"
  A check run's conclusion, as GitHub spells them.

  `"stale"` is deliberately absent: GitHub sets it itself and rejects it from a
  caller.

type GhPermissionLevel = "read" | "write" | "admin"
  A permission level an installation token can be narrowed to.
````

</details>

<!-- ZUKE:API:END -->

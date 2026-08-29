# @zuke/gh

Typed [`gh`](https://cli.github.com/) (GitHub CLI) task wrapper for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. The groups a build reaches for — `pr`, `issue`, `release`,
`run`, `workflow`, `repo`, `secret`, `variable`, `label`, and `cache` — have
typed tasks with their real flags; `gh` is broad, so `GhTasks.run` stays the
builder for the long tail: name the command with `.command(...)`, set `--repo`,
and pass anything else with `.flag(...)`. Arguments stay a discrete argv array,
so command construction is injection-free.

```ts
import { GhTasks } from "jsr:@zuke/gh";

await GhTasks.releaseCreate((s) =>
  s.repo("acme/app").tag("v1.2.3").title("v1.2.3").generateNotes().latest()
);

// Anything not yet modelled, through the builder.
await GhTasks.run((s) => s.command("auth", "status"));
```

## Typed pr, issue and release commands

Every task takes a settings lambda mirroring the real subcommand's flags, and
keeps `.repo(...)` plus the `.command(...)`/`.flag(...)` escape hatches it
inherits.

| Group     | Tasks                                                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `pr`      | `prCreate`, `prList`, `prListEntries`, `prView`, `prChecks`, `prMerge`, `prComment`, `prEdit`, `prClose`                                |
| `issue`   | `issueCreate`, `issueList`, `issueListEntries`, `issueView`, `issueComment`, `issueClose`                                               |
| `release` | `releaseCreate`, `releaseList`, `releaseListEntries`, `releaseView`, `releaseUpload`, `releaseDownload`, `releaseEdit`, `releaseDelete` |

```ts
import { GhTasks } from "jsr:@zuke/gh";

await GhTasks.prMerge((s) => s.selector(123).squash().deleteBranch().auto());
await GhTasks.issueClose((s) => s.selector(42).reason("completed"));
await GhTasks.releaseUpload((s) =>
  s.tag("v1.2.3").files("dist/app.tgz").clobber()
);
```

The three `…ListEntries` tasks are the value-returning readers: they ask `gh`
for `--json` with a pinned field set and hand back parsed entries, so a build
branches on data rather than on scraped text.

```ts
const open = await GhTasks.prListEntries((s) => s.state("open").limit(50));
const stale = open.filter((pr) => pr.isDraft);
```

Where `gh` would prompt — deleting a release, deleting a comment — the settings
refuse before `gh` is ever spawned, because a build has no one to answer the
prompt; `.yes()` is how it says it means the deletion. Contradictory flag pairs
that `gh` silently resolves in its own favour (a draft that is also the latest
release, `--pattern` alongside `--archive`, `--clobber` alongside
`--skip-existing`) are refused the same way, so a build never quietly gets an
outcome other than the one it asked for.

## GitHub Actions — runs, workflows, secrets, variables, caches

The CI-facing half of `gh`, typed the same way. `runListEntries` is the one a
release build reads for control flow: which run failed, on which branch, with
what conclusion.

| Group      | Tasks                                                                                                     |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| `run`      | `runList`, `runListEntries`, `runView`, `runRerun`, `runCancel`, `runDelete`, `runDownload`, `runWatch`   |
| `workflow` | `workflowList`, `workflowListEntries`, `workflowView`, `workflowRun`, `workflowEnable`, `workflowDisable` |
| `secret`   | `secretSet`, `secretList`, `secretListEntries`, `secretDelete`                                            |
| `variable` | `variableSet`, `variableGet`, `variableValue`, `variableList`, `variableListEntries`, `variableDelete`    |
| `cache`    | `cacheList`, `cacheListEntries`, `cacheDelete`                                                            |

```ts
import { GhTasks } from "jsr:@zuke/gh";

const failed = await GhTasks.runListEntries((s) =>
  s.status("failure").branch("master").limit(20)
);
await GhTasks.runRerun((s) => s.selector(failed[0].databaseId ?? 0).failed());
await GhTasks.workflowRun((s) =>
  s.workflow("e2e.yml").ref("master").field("environment", "staging")
);
await GhTasks.cacheDelete((s) => s.all().ref(ref).succeedOnNoCaches());
```

`workflowRun` returns once the dispatch is accepted. When the build must wait
for the result instead, use the `githubWorkflow` wait trigger below — it
suspends the run and resurfaces the per-job conclusions.

### Passing a secret

`GhTasks.secretSet` puts `.body(...)` in the process's arguments, which other
processes on the same machine can read while it runs. That is a property of the
command line, not of this wrapper. Omit the value and gh reads standard input,
or point at a dotenv file:

```ts
await GhTasks.secretSet((s) => s.name("NPM_TOKEN").envFile(".env.ci"));
```

Source the value from a `parameter().secret()` either way, so Zuke redacts it in
its own output. A variable is not a secret — GitHub returns its value in the
clear, and `variableValue` hands it back.

## Repositories and labels

| Group   | Tasks                                                                                                                                                                 |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repo`  | `repoClone`, `repoCreate`, `repoView`, `repoList`, `repoListEntries`, `repoFork`, `repoSync`, `repoEdit`, `repoRename`, `repoArchive`, `repoDelete`, `repoSetDefault` |
| `label` | `labelList`, `labelListEntries`, `labelCreate`, `labelEdit`, `labelDelete`, `labelClone`                                                                              |

```ts
await GhTasks.repoClone((s) =>
  s.repository("acme/app").directory("vendor/app").gitArgs("--depth=1")
);
await GhTasks.repoSync((s) => s.source("upstream/app").branch("master"));
await GhTasks.labelCreate((s) => s.name("flaky").color("d73a4a").force());
```

`gh repo clone` and `gh repo fork` forward what follows a `--` separator to
`git clone`, so shallow-clone flags go through `.gitArgs(...)` rather than a
flag of gh's own. This group also names its repository as an **operand** rather
than with `--repo` — `repoRename` is the one exception, where `-R` names the
repository being renamed — so `.repo(...)` is refused here with a message naming
the operand to use instead. `repoEdit`'s toggles are tri-state, as gh's are:
`.enableIssues()` turns one on and `.enableIssues(false)` turns it off.

The group has subcommands beyond these — `gitignore`, `license`, `read-file`,
`read-dir`, `deploy-key`, `autolink` — which a build has no reason to drive;
`GhTasks.run` stays the builder for those.

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

async function markReleaseLatest(configure?: Configure<GhReleaseLatestSettings>): Promise<GhReleaseLatestResult>
  Perform the configured mark-latest call.

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

const CACHE_LIST_FIELDS: readonly string[]
  The `--json` fields {@link readCaches} asks for; gh requires the list by
  name, so the reader pins the set {@link GhCacheEntry} describes.

const GhTasks: GhTasksApi
  Typed task functions for GitHub: the `gh` CLI and the REST-only operations.

const ISSUE_LIST_FIELDS: readonly string[]
  The `--json` fields {@link readIssues} asks for; gh requires the list by
  name, so the reader pins the set {@link GhIssueEntry} describes.

const LABEL_LIST_FIELDS: readonly string[]
  The `--json` fields {@link readLabels} asks for; gh requires the list by
  name, so the reader pins the set {@link GhLabelEntry} describes.

const PR_LIST_FIELDS: readonly string[]
  The `--json` fields {@link readPullRequests} asks for. gh requires the list
  by name — there is no "everything" form — so the reader pins the set its
  {@link GhPullRequestEntry} describes.

const RELEASE_LIST_FIELDS: readonly string[]
  The `--json` fields {@link readReleases} asks for; gh requires the list by
  name, so the reader pins the set {@link GhReleaseEntry} describes.

const REPO_LIST_FIELDS: readonly string[]
  The `--json` fields {@link readRepositories} asks for; gh requires the list
  by name, so the reader pins the set {@link GhRepositoryEntry} describes.

const RUN_LIST_FIELDS: readonly string[]
  The `--json` fields {@link readRuns} asks for; gh requires the list by name,
  so the reader pins the set {@link GhRunEntry} describes.

const SECRET_LIST_FIELDS: readonly string[]
  The `--json` fields {@link readSecrets} asks for; gh requires the list by
  name, so the reader pins the set {@link GhSecretEntry} describes.

const VARIABLE_LIST_FIELDS: readonly string[]
  The `--json` fields {@link readVariables} asks for; gh requires the list by
  name, so the reader pins the set {@link GhVariableEntry} describes.

const WORKFLOW_LIST_FIELDS: readonly string[]
  The `--json` fields {@link readWorkflows} asks for; gh requires the list by
  name, so the reader pins the set {@link GhWorkflowEntry} describes.

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

class GhApiSettings extends ToolSettings
  Settings for {@link "./gh.ts".GhTasksApi.api | GhTasks.api}, mirroring the
  real `gh api` flags: `--method`, `--field`, `--raw-field`, `--header`,
  `--jq`, and `--silent`.

  constructor(readonly endpoint: string)
    Build settings for a call to `endpoint` (e.g. `"user/starred/o/r"`).
  override protected defaultTool(): string
    The default binary: `gh`.
  method(verb: string): this
    The HTTP method (`--method`, e.g. `"PUT"`; `gh` defaults to GET).
  field(key: string, value: string | number | boolean): this
    Add a typed body parameter (`--field key=value`). Repeatable.
  rawField(key: string, value: string): this
    Add a string body parameter (`--raw-field key=value`). Repeatable.
  header(name: string, value: string): this
    Add a request header (`--header key:value`). Repeatable.
  jq(expression: string): this
    Filter the response through a jq expression (`--jq`).
  silent(): this
    Do not print the response body (`--silent`).
  override protected buildArgs(): string[]
    Assemble `api <endpoint>` plus the flags, in call order.

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

abstract class GhBodySettings extends GhCommandSettings
  Base for the commands that take message text: `pr create`, `pr comment`,
  `pr edit`, `issue create`, `issue comment`.

  gh spells it `--body` for the text and `--body-file` for a file, with `-`
  meaning standard input — the same pair on every one of them.

  body(text: string): this
    The message text (`--body`).
  bodyFile(path: PathLike): this
    Read the message from a file (`--body-file`); `-` reads standard input.
  protected bodyFlags(task: string): string[]
    The body flags, after refusing both at once: gh takes one source for the
    text, and silently preferring one would hide which text was posted.

class GhCacheDeleteSettings extends GhCommandSettings
  Settings for `gh cache delete`.

  selector(idOrKey: string | number): this
    The cache to delete, by its id or its key.
  all(): this
    Delete every cache (`--all`), narrowed by {@link ref} when one is set.
  ref(name: string): this
    Restrict the deletion to one ref (`--ref`).
  succeedOnNoCaches(): this
    Exit zero when there was nothing to delete (`--succeed-on-no-caches`).
  override protected commandPath(): string[]
    The `gh cache delete` command path.
  override protected commandFlags(): string[]
    Assemble the `gh cache delete` flags.

class GhCacheListSettings extends GhReadSettings
  Settings for `gh cache list`.

  key(prefix: string): this
    Only caches whose key starts with this (`--key`).
  ref(name: string): this
    Only caches for this ref (`--ref`), e.g. `refs/heads/master`.
  sort(field: GhCacheSort): this
    What to order by (`--sort`); gh's default is `last_accessed_at`.
  order(direction: "asc" | "desc"): this
    The direction (`--order`): `asc` or `desc`.
  limit(count: number): this
    Cap how many are fetched (`--limit`); gh's default is 30.
  override protected commandPath(): string[]
    The `gh cache list` command path.
  override protected commandFlags(): string[]
    Assemble the `gh cache list` flags.

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

abstract class GhCommandSettings extends GhSettings
  Base for a typed `gh` subcommand: it contributes the command path (the
  group, the verb, and any operand) and its own flags, and inherits
  everything else from {@link "./settings.ts".GhSettings}.

  abstract protected commandPath(): string[]
    The command path — group, verb, then any positional operand.
  abstract protected commandFlags(): string[]
    This command's own flags, rendered after `--repo`.
  override protected leadingTokens(): string[]
    The command path leads the argv, before anything `.command(...)` added.
  override protected middleTokens(): string[]
    `--repo` first, as the package already renders it, then this command's flags.

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

class GhIssueCloseSettings extends GhCommandSettings
  Settings for `gh issue close`.

  selector(value: string | number): this
    The issue — its number or URL (required).
  comment(text: string): this
    Leave a closing comment (`--comment`).
  reason(value: GhCloseReason): this
    Why it is closed (`--reason`).
  duplicateOf(numberOrUrl: string | number): this
    Which issue it duplicates (`--duplicate-of`), by number or URL.
  override protected commandPath(): string[]
    The `gh issue close` command path.
  override protected commandFlags(): string[]
    Assemble the `gh issue close` flags.

class GhIssueCommentSettings extends GhBodySettings
  Settings for `gh issue comment`.

  selector(value: string | number): this
    The issue — its number or URL (required).
  editLast(): this
    Edit your most recent comment instead of adding one (`--edit-last`).
  createIfNone(): this
    With {@link editLast}, post a new comment when there is none (`--create-if-none`).
  deleteLast(): this
    Delete your most recent comment (`--delete-last`).
  yes(): this
    Skip the confirmation a delete otherwise prompts for (`--yes`).
  override protected commandPath(): string[]
    The `gh issue comment` command path.
  override protected commandFlags(): string[]
    Assemble the `gh issue comment` flags.

class GhIssueCreateSettings extends GhBodySettings
  Settings for `gh issue create`.

  title(text: string): this
    The issue's title (`--title`).
  assignee(...logins: string[]): this
    Assign someone by login (`--assignee`), `@me` for yourself; repeatable.
  label(...names: string[]): this
    Add a label by name (`--label`); repeatable.
  project(...titles: string[]): this
    Add to a project by title (`--project`); repeatable.
  milestone(name: string): this
    Add to a milestone by name (`--milestone`).
  type(name: string): this
    Set the issue type by name (`--type`).
  parent(numberOrUrl: string | number): this
    File it as a sub-issue of this number or URL (`--parent`).
  templateName(name: string): this
    The issue template to start the body from (`--template`).
  override protected commandPath(): string[]
    The `gh issue create` command path.
  override protected commandFlags(): string[]
    Assemble the `gh issue create` flags.

class GhIssueListSettings extends GhWebReadSettings
  Settings for `gh issue list`.

  state(value: "open" | "closed" | "all"): this
    Filter by state (`--state`): `open`, `closed`, or `all`.
  author(login: string): this
    Filter by author (`--author`).
  app(name: string): this
    Filter by the GitHub App that opened it (`--app`).
  assignee(login: string): this
    Filter by assignee (`--assignee`).
  mention(login: string): this
    Filter by who is mentioned (`--mention`).
  milestone(nameOrNumber: string): this
    Filter by milestone number or title (`--milestone`).
  type(name: string): this
    Filter by issue type (`--type`).
  label(...names: string[]): this
    Filter by label (`--label`); repeatable.
  limit(count: number): this
    Cap how many are fetched (`--limit`); gh's default is 30.
  search(query: string): this
    Filter with a search query (`--search`).
  override protected commandPath(): string[]
    The `gh issue list` command path.
  override protected commandFlags(): string[]
    Assemble the `gh issue list` flags.

class GhIssueViewSettings extends GhWebReadSettings
  Settings for `gh issue view`.

  selector(value: string | number): this
    The issue — its number or URL (required).
  comments(): this
    Include the comments (`--comments`).
  override protected commandPath(): string[]
    The `gh issue view` command path.
  override protected commandFlags(): string[]
    Assemble the `gh issue view` flags.

class GhLabelCloneSettings extends GhCommandSettings
  Settings for `gh label clone`.

  source(slug: string): this
    The repository to copy the labels from, as `owner/name` (required).
  force(): this
    Overwrite labels of the same name in the destination (`--force`).
  override protected commandPath(): string[]
    The `gh label clone` command path.
  override protected commandFlags(): string[]
    Assemble the `gh label clone` flags.

class GhLabelCreateSettings extends GhCommandSettings
  Settings for `gh label create`.

  name(value: string): this
    The label's name (required).
  color(hex: string): this
    Its colour (`--color`), as a hex triplet; gh accepts it with or without `#`.
  description(text: string): this
    Its description (`--description`).
  force(): this
    Update the label when it already exists rather than failing (`--force`).
  override protected commandPath(): string[]
    The `gh label create` command path.
  override protected commandFlags(): string[]
    Assemble the `gh label create` flags.

class GhLabelDeleteSettings extends GhCommandSettings
  Settings for `gh label delete`.

  name(value: string): this
    The label to delete (required).
  yes(): this
    Skip the confirmation a delete otherwise prompts for (`--yes`).
  override protected commandPath(): string[]
    The `gh label delete` command path.
  override protected commandFlags(): string[]
    Assemble the `gh label delete` flags.

class GhLabelEditSettings extends GhCommandSettings
  Settings for `gh label edit`.

  name(value: string): this
    The label to edit, by its current name (required).
  newName(value: string): this
    Rename it (`--name`).
  color(hex: string): this
    Set its colour (`--color`).
  description(text: string): this
    Set its description (`--description`).
  override protected commandPath(): string[]
    The `gh label edit` command path.
  override protected commandFlags(): string[]
    Assemble the `gh label edit` flags.

class GhLabelListSettings extends GhWebReadSettings
  Settings for `gh label list`.

  search(query: string): this
    Search names and descriptions (`--search`).
  sort(field: GhLabelSort): this
    What to order by (`--sort`); gh's default is `created`.
  order(direction: "asc" | "desc"): this
    The direction (`--order`): `asc` or `desc`.
  limit(count: number): this
    Cap how many are fetched (`--limit`); gh's default is 30.
  override protected commandPath(): string[]
    The `gh label list` command path.
  override protected commandFlags(): string[]
    Assemble the `gh label list` flags.

class GhPrChecksSettings extends GhPrReadSettings
  Settings for `gh pr checks`.

  watch(): this
    Keep watching until the checks finish (`--watch`). A target that watches
    blocks until CI is done, so pair it with `.killAfter(...)` unless the wait
    is the point.
  failFast(): this
    Stop watching at the first failure (`--fail-fast`).
  required(): this
    Only the checks marked required (`--required`).
  interval(seconds: number): this
    How often to refresh while watching (`--interval`), in seconds.
  override protected commandPath(): string[]
    The `gh pr checks` command path.
  override protected commandFlags(): string[]
    Assemble the `gh pr checks` flags, refusing the flags that only mean
    something while watching — gh ignores them otherwise, which would leave a
    build believing it had asked for something it had not.

class GhPrCloseSettings extends GhCommandSettings
  Settings for `gh pr close`.

  selector(value: string | number): this
    The pull request — number, URL, or branch; defaults to the current branch's.
  comment(text: string): this
    Leave a closing comment (`--comment`).
  deleteBranch(): this
    Delete the branch afterwards (`--delete-branch`).
  override protected commandPath(): string[]
    The `gh pr close` command path.
  override protected commandFlags(): string[]
    Assemble the `gh pr close` flags.

class GhPrCommentSettings extends GhPrTargetSettings
  Settings for `gh pr comment`.

  editLast(): this
    Edit your most recent comment instead of adding one (`--edit-last`).
  createIfNone(): this
    With {@link editLast}, post a new comment when there is none (`--create-if-none`).
  deleteLast(): this
    Delete your most recent comment (`--delete-last`).
  yes(): this
    Skip the confirmation a delete otherwise prompts for (`--yes`).
  override protected commandPath(): string[]
    The `gh pr comment` command path.
  override protected commandFlags(): string[]
    Assemble the `gh pr comment` flags.

class GhPrCreateSettings extends GhBodySettings
  Settings for `gh pr create`.

  title(text: string): this
    The pull request's title (`--title`).
  base(branch: string): this
    The branch to merge into (`--base`).
  head(branch: string): this
    The branch holding the commits (`--head`).
  assignee(...logins: string[]): this
    Assign someone by login (`--assignee`), `@me` for yourself; repeatable.
  label(...names: string[]): this
    Add a label by name (`--label`); repeatable.
  reviewer(...handles: string[]): this
    Request a review from a person or team (`--reviewer`); repeatable.
  milestone(name: string): this
    Add to a milestone by name (`--milestone`).
  project(...titles: string[]): this
    Add to a project by title (`--project`); repeatable.
  draft(): this
    Open it as a draft (`--draft`).
  fill(): this
    Take the title and body from the commits (`--fill`).
  fillFirst(): this
    Take them from the first commit only (`--fill-first`).
  fillVerbose(): this
    Take the body from every commit's message (`--fill-verbose`).
  dryRun(): this
    Print what would be created without creating it (`--dry-run`).
  noMaintainerEdit(): this
    Refuse maintainer edits to the branch (`--no-maintainer-edit`).
  templateFile(path: string): this
    A template file to seed the body from (`--template`).
  override protected commandPath(): string[]
    The `gh pr create` command path.
  override protected commandFlags(): string[]
    Assemble the `gh pr create` flags.

class GhPrEditSettings extends GhPrTargetSettings
  Settings for `gh pr edit`.

  title(text: string): this
    Set the title (`--title`).
  base(branch: string): this
    Change the base branch (`--base`).
  addLabel(...names: string[]): this
    Add a label (`--add-label`); repeatable.
  removeLabel(...names: string[]): this
    Remove a label (`--remove-label`); repeatable.
  addAssignee(...logins: string[]): this
    Add an assignee (`--add-assignee`); repeatable.
  removeAssignee(...logins: string[]): this
    Remove an assignee (`--remove-assignee`); repeatable.
  addReviewer(...handles: string[]): this
    Request a review (`--add-reviewer`); repeatable.
  removeReviewer(...handles: string[]): this
    Drop a review request (`--remove-reviewer`); repeatable.
  addProject(...titles: string[]): this
    Add to a project by title (`--add-project`); repeatable.
  removeProject(...titles: string[]): this
    Take it off a project by title (`--remove-project`); repeatable.
  milestone(name: string): this
    Set the milestone (`--milestone`).
  removeMilestone(): this
    Clear the milestone (`--remove-milestone`).
  override protected commandPath(): string[]
    The `gh pr edit` command path.
  override protected commandFlags(): string[]
    Assemble the `gh pr edit` flags.

class GhPrListSettings extends GhWebReadSettings
  Settings for `gh pr list`.

  state(value: "open" | "closed" | "merged" | "all"): this
    Filter by state (`--state`): `open`, `closed`, `merged`, or `all`.
  base(branch: string): this
    Filter by base branch (`--base`).
  head(branch: string): this
    Filter by head branch (`--head`).
  author(login: string): this
    Filter by author (`--author`).
  app(name: string): this
    Filter by the GitHub App that opened it (`--app`).
  assignee(login: string): this
    Filter by assignee (`--assignee`).
  label(...names: string[]): this
    Filter by label (`--label`); repeatable.
  limit(count: number): this
    Cap how many are fetched (`--limit`); gh's default is 30.
  search(query: string): this
    Filter with a search query (`--search`).
  draft(): this
    Only draft pull requests (`--draft`).
  override protected commandPath(): string[]
    The `gh pr list` command path.
  override protected commandFlags(): string[]
    Assemble the `gh pr list` flags.

class GhPrMergeSettings extends GhPrTargetSettings
  Settings for `gh pr merge`.

  merge(): this
    Merge with a merge commit (`--merge`).
  squash(): this
    Squash the commits into one (`--squash`).
  rebase(): this
    Rebase the commits onto the base (`--rebase`).
  auto(): this
    Merge once the requirements are met (`--auto`).
  disableAuto(): this
    Turn auto-merge off again (`--disable-auto`).
  admin(): this
    Merge with administrator privileges (`--admin`).
  deleteBranch(): this
    Delete the branch afterwards (`--delete-branch`).
  subject(text: string): this
    The merge commit's subject (`--subject`).
  authorEmail(address: string): this
    The merge commit's author email (`--author-email`).
  matchHeadCommit(sha: string): this
    Refuse the merge unless the head is still this commit
    (`--match-head-commit`) — the guard against merging a PR that moved
    between the check and the merge.
  override protected commandPath(): string[]
    The `gh pr merge` command path.
  override protected commandFlags(): string[]
    Assemble the `gh pr merge` flags.

abstract class GhPrReadSettings extends GhWebReadSettings
  Base for the `pr` commands that read one pull request and can print JSON —
  `view` and `checks` — so the operand has one implementation across them.

  selector(value: string | number): this
    The pull request — number, URL, or branch; defaults to the current branch's.
  protected selectorArgs(): string[]
    The operand, when one was given.

abstract class GhPrTargetSettings extends GhBodySettings
  Base for the `pr` commands that take a pull request and post text —
  `merge`, `comment`, and `edit` — so the operand and the `--body` pair have
  one implementation across them.

  selector(value: string | number): this
    The pull request — its number, URL, or branch name. Omit it to act on the
    PR for the current branch, as gh does.
  protected selectorArgs(): string[]
    The operand, when one was given.

class GhPrViewSettings extends GhPrReadSettings
  Settings for `gh pr view`.

  comments(): this
    Include the comments (`--comments`).
  override protected commandPath(): string[]
    The `gh pr view` command path.
  override protected commandFlags(): string[]
    Assemble the `gh pr view` flags.

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

abstract class GhReadSettings extends GhCommandSettings
  Base for the commands that can print JSON: `pr list`, `pr view`,
  `pr checks`, `issue list`, `issue view`, `release list`, `release view`.

  gh requires an explicit field list for `--json`, which is why the
  value-returning tasks pin one rather than leaving it to the caller.

  A `…ListEntries` reader parses the array `--json` prints, so `.jq(...)` and
  `.template(...)` — which replace that array with whatever they render —
  belong on the plain `…List` task instead.

  json(...fields: string[]): this
    Emit JSON with these fields (`--json`), which gh requires by name — there
    is no "all fields" form.
  jq(expression: string): this
    Filter the JSON with a jq expression (`--jq`).
  template(text: string): this
    Format the JSON through a Go template (`--template`).
  protected readFlags(): string[]
    The read flags, for a subclass to place among its own.

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
  refresh_: boolean
    Replace an existing asset whose bytes differ. Set by {@link refresh}.
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
  refresh(): this
    Replace an asset the release already carries when its bytes differ from
    the file's — compared by the sha256 digest the API reports — instead of
    keeping it. An asset whose digest matches, or whose digest the API does
    not report, is still kept: without a comparison to trust, replacement
    would churn a published release's assets on every run, which is exactly
    what the default protects. For an asset that must track its source
    across runs (an extension archive, a docs bundle) on a long-lived
    release.
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

class GhReleaseCreateSettings extends GhCommandSettings
  Settings for `gh release create`.

  tag(name: string): this
    The tag to release (required); gh creates it when it does not exist.
  files(...paths: PathLike[]): this
    Asset files to attach (positional); repeatable. gh reads a `#label`
    suffix on a path as the asset's display label.
  title(text: string): this
    The release title (`--title`).
  notes(text: string): this
    The release notes (`--notes`).
  notesFile(path: PathLike): this
    Read the notes from a file (`--notes-file`); `-` reads standard input.
  generateNotes(): this
    Have GitHub write the title and notes (`--generate-notes`).
  notesFromTag(): this
    Take the notes from the tag's annotation (`--notes-from-tag`).
  notesStartTag(name: string): this
    Generate notes starting from this tag (`--notes-start-tag`).
  draft(): this
    Save it as a draft rather than publishing (`--draft`).
  prerelease(): this
    Mark it a prerelease (`--prerelease`).
  latest(): this
    Mark it the latest release (`--latest`).
  target(branchOrSha: string): this
    The branch or commit to tag (`--target`).
  discussionCategory(name: string): this
    Open a discussion in this category (`--discussion-category`).
  verifyTag(): this
    Abort unless the tag already exists on the remote (`--verify-tag`).
  failOnNoCommits(): this
    Fail when there are no commits since the last release (`--fail-on-no-commits`).
  override protected commandPath(): string[]
    The `gh release create` command path, with the tag and any assets.
  override protected commandFlags(): string[]
    Assemble the `gh release create` flags.

class GhReleaseDeleteSettings extends GhCommandSettings
  Settings for `gh release delete`.

  tag(name: string): this
    The release to delete, by tag (required).
  cleanupTag(): this
    Delete the git tag as well (`--cleanup-tag`).
  yes(): this
    Skip the confirmation prompt (`--yes`).
  override protected commandPath(): string[]
    The `gh release delete` command path.
  override protected commandFlags(): string[]
    Assemble the `gh release delete` flags.

class GhReleaseDownloadSettings extends GhCommandSettings
  Settings for `gh release download`.

  tag(name: string): this
    The release's tag; gh takes the latest release when it is omitted.
  pattern(...globs: string[]): this
    Only assets matching this glob (`--pattern`); repeatable.
  dir(path: PathLike): this
    The directory to download into (`--dir`).
  output(path: PathLike): this
    Write a single asset to this file (`--output`); `-` writes standard output.
  archive(format: "zip" | "tar.gz"): this
    Download the source archive instead of the assets (`--archive`).
  clobber(): this
    Overwrite files that already exist (`--clobber`).
  skipExisting(): this
    Leave files that already exist alone (`--skip-existing`).
  override protected commandPath(): string[]
    The `gh release download` command path.
  override protected commandFlags(): string[]
    Assemble the `gh release download` flags.

class GhReleaseEditSettings extends GhCommandSettings
  Settings for `gh release edit`.

  tag(name: string): this
    The release to edit, by its current tag (required).
  newTag(name: string): this
    Move the release to a different tag (`--tag`).
  title(text: string): this
    Set the title (`--title`).
  notes(text: string): this
    Set the notes (`--notes`).
  notesFile(path: PathLike): this
    Read the notes from a file (`--notes-file`); `-` reads standard input.
  draft(): this
    Make it a draft (`--draft`).
  prerelease(): this
    Mark it a prerelease (`--prerelease`).
  latest(): this
    Mark it the latest release (`--latest`).
  target(branchOrSha: string): this
    Change the target branch or commit (`--target`).
  discussionCategory(name: string): this
    Open a discussion in this category when publishing (`--discussion-category`).
  verifyTag(): this
    Abort unless the tag exists on the remote (`--verify-tag`).
  override protected commandPath(): string[]
    The `gh release edit` command path.
  override protected commandFlags(): string[]
    Assemble the `gh release edit` flags.

class GhReleaseLatestSettings
  Settings for marking a release as latest.

  `owner/repo` and the token fall back to the Actions environment, so a job
  that already has them needs to name only the tag.

  tag_?: string
    The tag whose release becomes latest. Set by {@link tag}.
  repo_?: string
    `owner/repo`. Set by {@link repo}.
  token_?: string
    The token. Set by {@link token}.
  baseUrl_: string
    The API root. Set by {@link baseUrl}.
  fetch_: typeof fetch
    The `fetch` implementation. Set by {@link fetch}.
  tag(value: string): this
    The tag whose release the pointer should name (required).
  repo(slug: string): this
    `owner/repo`. Defaults to `GITHUB_REPOSITORY`.
  token(value: string): this
    The token to authenticate with — needs `contents: write`. Defaults to `GITHUB_TOKEN`.
  baseUrl(url: string): this
    The API root, for GitHub Enterprise.
  fetch(fn: typeof fetch): this
    Override the `fetch` implementation (a test seam).
  repoSlug_(): string
    The effective `owner/repo`, from the setting or the environment.
  authToken_(): string
    The effective token, from the setting or the environment.

class GhReleaseListSettings extends GhReadSettings
  Settings for `gh release list`.

  limit(count: number): this
    Cap how many are fetched (`--limit`); gh's default is 30.
  order(direction: "asc" | "desc"): this
    The order they come back in (`--order`): `asc` or `desc`.
  excludeDrafts(): this
    Leave out drafts (`--exclude-drafts`).
  excludePreReleases(): this
    Leave out prereleases (`--exclude-pre-releases`).
  override protected commandPath(): string[]
    The `gh release list` command path.
  override protected commandFlags(): string[]
    Assemble the `gh release list` flags.

class GhReleaseUploadSettings extends GhCommandSettings
  Settings for `gh release upload`.

  tag(name: string): this
    The release's tag (required).
  files(...paths: PathLike[]): this
    Asset files to attach (required); repeatable. gh reads a `#label` suffix
    on a path as the asset's display label.
  clobber(): this
    Replace an asset of the same name (`--clobber`).
  override protected commandPath(): string[]
    The `gh release upload` command path, with the tag and the assets.
  override protected commandFlags(): string[]
    Assemble the `gh release upload` flags.

class GhReleaseViewSettings extends GhWebReadSettings
  Settings for `gh release view`.

  tag(name: string): this
    The release's tag; gh shows the latest release when it is omitted.
  override protected commandPath(): string[]
    The `gh release view` command path.
  override protected commandFlags(): string[]
    Assemble the `gh release view` flags.

class GhRepoArchiveSettings extends GhRepoCommandSettings
  Settings for `gh repo archive` and `gh repo unarchive`.

  override protected readonly taskName: string
    The task this settings class backs.
  override protected readonly operandHint: string
    How this command names its repository.
  repository(slug: string): this
    The repository; gh acts on the current one otherwise.
  unarchive(): this
    Restore an archived repository instead — `gh repo unarchive`.
  yes(): this
    Skip the confirmation gh otherwise prompts for (`--yes`).
  override protected commandPath(): string[]
    The `gh repo archive` or `gh repo unarchive` command path.
  override protected commandFlags(): string[]
    Assemble the flags.

class GhRepoCloneSettings extends GhRepoCommandSettings
  Settings for `gh repo clone`.

  override protected readonly taskName: string
    The task this settings class backs.
  override protected readonly operandHint: string
    How this command names its repository.
  repository(slug: string): this
    The repository, as `owner/name` or a URL (required).
  directory(path: PathLike): this
    The directory to clone into; gh names it after the repository otherwise.
  upstreamRemoteName(name: string): this
    The remote name for a fork's parent (`--upstream-remote-name`).
  noUpstream(): this
    Do not add the upstream remote when cloning a fork (`--no-upstream`).
  gitArgs(...args: string[]): this
    Flags for the underlying `git clone`, which gh takes after a `--`
    separator — `.gitArgs("--depth=1")` for a shallow clone.
  override protected commandPath(): string[]
    The `gh repo clone` command path, with the repository and directory.
  override protected commandFlags(): string[]
    Assemble the `gh repo clone` flags, with any git flags after `--`.

abstract class GhRepoCommandSettings extends GhCommandSettings
  Base for the `gh repo` commands that neither print JSON nor take `--repo`.
  {@link GhRepoListSettings} and {@link GhRepoViewSettings} do print JSON, so
  they extend the read bases and call {@link refuseRepoFlag} themselves.

  abstract protected readonly taskName: string
    The task name a refusal names, e.g. `repoClone`.
  abstract protected readonly operandHint: string
    How this command names its repository, e.g. `.repository(...)`.
  override protected middleTokens(): string[]
    This command's flags, after refusing a `--repo` it cannot render.

class GhRepoCreateSettings extends GhRepoCommandSettings
  Settings for `gh repo create`.

  override protected readonly taskName: string
    The task this settings class backs.
  override protected readonly operandHint: string
    How this command names its repository.
  name(value: string): this
    The repository's name, or `owner/name` to create it elsewhere (required).
  visibility(value: GhRepoVisibility): this
    How visible it is: `--public`, `--private`, or `--internal` (required).
  description(text: string): this
    Its description (`--description`).
  homepage(url: string): this
    Its homepage (`--homepage`).
  team(name: string): this
    Grant an organization team access (`--team`).
  template(slug: string): this
    Base it on a template repository (`--template`).
  gitignore(name: string): this
    Start from a gitignore template (`--gitignore`).
  license(name: string): this
    Add an open-source license (`--license`).
  source(path: PathLike): this
    Create it from a local repository (`--source`).
  remote(name: string): this
    The remote name for the new repository (`--remote`).
  clone(): this
    Clone it after creating it (`--clone`).
  push(): this
    Push the local commits to it (`--push`).
  addReadme(): this
    Add a README (`--add-readme`).
  includeAllBranches(): this
    Copy every branch of the template, not just its default (`--include-all-branches`).
  disableIssues(): this
    Turn issues off (`--disable-issues`).
  disableWiki(): this
    Turn the wiki off (`--disable-wiki`).
  override protected commandPath(): string[]
    The `gh repo create` command path.
  override protected commandFlags(): string[]
    Assemble the `gh repo create` flags.

class GhRepoDeleteSettings extends GhRepoCommandSettings
  Settings for `gh repo delete`.

  override protected readonly taskName: string
    The task this settings class backs.
  override protected readonly operandHint: string
    How this command names its repository.
  repository(slug: string): this
    The repository to delete, as `owner/name` (required — see below).
  yes(): this
    Skip the confirmation a delete otherwise prompts for (`--yes`).
  override protected commandPath(): string[]
    The `gh repo delete` command path.
  override protected commandFlags(): string[]
    Assemble the `gh repo delete` flags.

class GhRepoEditSettings extends GhRepoCommandSettings
  Settings for `gh repo edit`.

  override protected readonly taskName: string
    The task this settings class backs.
  override protected readonly operandHint: string
    How this command names its repository.
  repository(slug: string): this
    The repository to edit; gh edits the current one otherwise.
  description(text: string): this
    Set the description (`--description`).
  homepage(url: string): this
    Set the homepage (`--homepage`).
  defaultBranch(name: string): this
    Set the default branch (`--default-branch`).
  visibility(value: GhRepoVisibility): this
    Change the visibility (`--visibility`), which needs {@link acceptVisibilityChangeConsequences}.
  acceptVisibilityChangeConsequences(): this
    Acknowledge what a visibility change does (`--accept-visibility-change-consequences`).
  addTopic(...names: string[]): this
    Add a topic (`--add-topic`); repeatable.
  removeTopic(...names: string[]): this
    Remove a topic (`--remove-topic`); repeatable.
  enableIssues(enabled: boolean): this
    Turn issues on or off (`--enable-issues`).
  enableWiki(enabled: boolean): this
    Turn the wiki on or off (`--enable-wiki`).
  enableProjects(enabled: boolean): this
    Turn projects on or off (`--enable-projects`).
  enableDiscussions(enabled: boolean): this
    Turn discussions on or off (`--enable-discussions`).
  enableAutoMerge(enabled: boolean): this
    Turn auto-merge on or off (`--enable-auto-merge`).
  enableMergeCommit(enabled: boolean): this
    Allow or forbid merge commits (`--enable-merge-commit`).
  enableSquashMerge(enabled: boolean): this
    Allow or forbid squash merges (`--enable-squash-merge`).
  enableRebaseMerge(enabled: boolean): this
    Allow or forbid rebase merges (`--enable-rebase-merge`).
  deleteBranchOnMerge(enabled: boolean): this
    Delete the head branch after a merge, or stop (`--delete-branch-on-merge`).
  allowForking(enabled: boolean): this
    Allow or forbid forking (`--allow-forking`).
  allowUpdateBranch(enabled: boolean): this
    Allow or forbid updating a pull request branch (`--allow-update-branch`).
  enableSecretScanning(enabled: boolean): this
    Turn secret scanning on or off (`--enable-secret-scanning`).
  enableSecretScanningPushProtection(enabled: boolean): this
    Turn push protection on or off (`--enable-secret-scanning-push-protection`).
  override protected commandPath(): string[]
    The `gh repo edit` command path.
  override protected commandFlags(): string[]
    Assemble the `gh repo edit` flags.

class GhRepoForkSettings extends GhRepoCommandSettings
  Settings for `gh repo fork`.

  override protected readonly taskName: string
    The task this settings class backs.
  override protected readonly operandHint: string
    How this command names its repository.
  repository(slug: string): this
    The repository to fork; gh forks the current one otherwise.
  org(name: string): this
    Create the fork in an organization (`--org`).
  forkName(value: string): this
    Name the fork something else (`--fork-name`).
  remoteName(value: string): this
    The remote name to add for the fork (`--remote-name`).
  clone(): this
    Clone the fork after creating it (`--clone`).
  remote(): this
    Add a git remote for the fork (`--remote`).
  defaultBranchOnly(): this
    Fork only the default branch (`--default-branch-only`).
  gitArgs(...args: string[]): this
    Flags for the underlying `git clone`, passed after a `--` separator.
  override protected commandPath(): string[]
    The `gh repo fork` command path.
  override protected commandFlags(): string[]
    Assemble the `gh repo fork` flags, with any git flags after `--`.

class GhRepoListSettings extends GhReadSettings
  Settings for `gh repo list`.

  owner(login: string): this
    Whose repositories to list; gh lists your own when it is omitted.
  language(name: string): this
    Filter by primary language (`--language`).
  topic(...names: string[]): this
    Filter by topic (`--topic`); repeatable.
  visibility(value: GhRepoVisibility): this
    Filter by visibility (`--visibility`).
  archived(): this
    Only archived repositories (`--archived`).
  noArchived(): this
    Leave archived repositories out (`--no-archived`).
  fork(): this
    Only forks (`--fork`).
  source(): this
    Only repositories that are not forks (`--source`).
  limit(count: number): this
    Cap how many are fetched (`--limit`); gh's default is 30.
  override protected commandPath(): string[]
    The `gh repo list` command path, with the owner when one was given.
  override protected middleTokens(): string[]
    This command's flags, after refusing a `--repo` gh would reject.
  override protected commandFlags(): string[]
    Assemble the `gh repo list` flags.

class GhRepoRenameSettings extends GhCommandSettings
  Settings for `gh repo rename`.

  newName(value: string): this
    The repository's new name, without the owner (required).
  yes(): this
    Skip the confirmation a rename otherwise prompts for (`--yes`).
  override protected commandPath(): string[]
    The `gh repo rename` command path.
  override protected commandFlags(): string[]
    Assemble the `gh repo rename` flags.

class GhRepoSetDefaultSettings extends GhRepoCommandSettings
  Settings for `gh repo set-default`.

  override protected readonly taskName: string
    The task this settings class backs.
  override protected readonly operandHint: string
    How this command names its repository.
  repository(slugOrRemote: string): this
    The repository to make the default, as `owner/name` or a remote name.
  unset(): this
    Forget the current default instead (`--unset`).
  view(): this
    Report the current default instead (`--view`).
  override protected commandPath(): string[]
    The `gh repo set-default` command path.
  override protected commandFlags(): string[]
    Assemble the `gh repo set-default` flags.

class GhRepoSyncSettings extends GhRepoCommandSettings
  Settings for `gh repo sync`.

  override protected readonly taskName: string
    The task this settings class backs.
  override protected readonly operandHint: string
    How this command names its repository.
  destination(slug: string): this
    The repository to update; gh syncs the local one otherwise.
  source(slug: string): this
    Where to sync from (`--source`); gh uses the fork's parent otherwise.
  branch(name: string): this
    The branch to sync (`--branch`); gh uses the default branch otherwise.
  force(): this
    Hard-reset the destination branch onto the source (`--force`).
  override protected commandPath(): string[]
    The `gh repo sync` command path.
  override protected commandFlags(): string[]
    Assemble the `gh repo sync` flags.

class GhRepoViewSettings extends GhWebReadSettings
  Settings for `gh repo view`.

  repository(slug: string): this
    The repository, as `owner/name`; gh uses the current one otherwise.
  branch(name: string): this
    View a particular branch (`--branch`).
  override protected commandPath(): string[]
    The `gh repo view` command path.
  override protected middleTokens(): string[]
    This command's flags, after refusing a `--repo` gh would reject.
  override protected commandFlags(): string[]
    Assemble the `gh repo view` flags.

class GhRunCancelSettings extends GhRunTargetSettings
  Settings for `gh run cancel`.

  force(): this
    Cancel a run the ordinary request will not stop (`--force`).
  override protected commandPath(): string[]
    The `gh run cancel` command path.
  override protected commandFlags(): string[]
    Assemble the `gh run cancel` flags.

class GhRunDeleteSettings extends GhRunTargetSettings
  Settings for `gh run delete`.

  override protected commandPath(): string[]
    The `gh run delete` command path.
  override protected commandFlags(): string[]
    `gh run delete` takes no flags of its own.

class GhRunDownloadSettings extends GhRunTargetSettings
  Settings for `gh run download`.

  name(...names: string[]): this
    Only artifacts with this exact name (`--name`); repeatable.
  pattern(...globs: string[]): this
    Only artifacts matching this glob (`--pattern`); repeatable.
  dir(path: PathLike): this
    The directory to download into (`--dir`); gh's default is the cwd.
  override protected commandPath(): string[]
    The `gh run download` command path.
  override protected commandFlags(): string[]
    Assemble the `gh run download` flags.

class GhRunListSettings extends GhReadSettings
  Settings for `gh run list`.

  all(): this
    Include runs of disabled workflows (`--all`).
  branch(name: string): this
    Filter by branch (`--branch`).
  commit(sha: string): this
    Filter by the commit that triggered them (`--commit`).
  created(query: string): this
    Filter by creation date (`--created`), in GitHub's date-query syntax.
  event(name: string): this
    Filter by the event that triggered them (`--event`).
  status(value: GhRunStatus): this
    Filter by status or conclusion (`--status`).
  user(login: string): this
    Filter by the user who triggered them (`--user`).
  workflow(nameOrId: string): this
    Filter by workflow, by name, id, or file name (`--workflow`).
  limit(count: number): this
    Cap how many are fetched (`--limit`); gh's default is 20.
  override protected commandPath(): string[]
    The `gh run list` command path.
  override protected commandFlags(): string[]
    Assemble the `gh run list` flags.

class GhRunRerunSettings extends GhRunTargetSettings
  Settings for `gh run rerun`.

  failed(): this
    Rerun only the failed jobs and their dependencies (`--failed`).
  job(jobId: string | number): this
    Rerun one job and its dependencies (`--job`), by job id.
  debug(): this
    Rerun with debug logging enabled (`--debug`).
  override protected commandPath(): string[]
    The `gh run rerun` command path.
  override protected commandFlags(): string[]
    Assemble the `gh run rerun` flags.

abstract class GhRunTargetSettings extends GhCommandSettings
  Base for the `run` commands that name one run. gh prompts for a run when the
  operand is omitted, so unlike a pull request there is no useful default.

  selector(runId: string | number): this
    The run — its id (required).
  protected requireSelector(task: string): string
    The run id, or the failure explaining that gh would otherwise prompt.

class GhRunViewSettings extends GhWebReadSettings
  Settings for `gh run view`.

  selector(runId: string | number): this
    The run — its id; gh shows a picker without one.
  attempt(number: number): this
    View an earlier attempt (`--attempt`).
  job(jobId: string | number): this
    View one job of the run (`--job`), by job id.
  log(): this
    Print the full log (`--log`).
  logFailed(): this
    Print only the failed steps' log (`--log-failed`).
  exitStatus(): this
    Exit non-zero when the run failed (`--exit-status`).
  verbose(): this
    Include the individual job steps (`--verbose`).
  override protected commandPath(): string[]
    The `gh run view` command path.
  override protected commandFlags(): string[]
    Assemble the `gh run view` flags.

class GhRunWatchSettings extends GhRunTargetSettings
  Settings for `gh run watch`.

  compact(): this
    Report only the relevant and failed steps (`--compact`).
  exitStatus(): this
    Exit non-zero when the run fails (`--exit-status`).
  interval(seconds: number): this
    Seconds between refreshes (`--interval`); gh's default is 3.
  override protected commandPath(): string[]
    The `gh run watch` command path.
  override protected commandFlags(): string[]
    Assemble the `gh run watch` flags.

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

class GhSecretDeleteSettings extends GhSecretScopeSettings
  Settings for `gh secret delete`.

  name(value: string): this
    The secret's name (required).
  override protected commandPath(): string[]
    The `gh secret delete` command path.
  override protected commandFlags(): string[]
    Assemble the `gh secret delete` flags.

class GhSecretListSettings extends GhReadSettings
  Settings for `gh secret list`.

  app(name: GhSecretApp): this
    Which application's secrets to list (`--app`).
  org(name: string): this
    List an organization's secrets (`--org`).
  environment(name: string): this
    List an environment's secrets (`--env`).
  user(): this
    List your own secrets (`--user`).
  override protected commandPath(): string[]
    The `gh secret list` command path.
  override protected commandFlags(): string[]
    Assemble the `gh secret list` flags.

abstract class GhSecretScopeSettings extends GhCommandSettings
  Base for the `secret` commands that name one scope: the application, and
  whether the secret belongs to a repository, an organization, an
  environment, or the authenticated user.

  app(name: GhSecretApp): this
    Which application reads it (`--app`); gh's default is `actions`.
  org(name: string): this
    Scope it to an organization (`--org`).
  environment(name: string): this
    Scope it to a deployment environment (`--env`).
  user(): this
    Scope it to the authenticated user (`--user`).
  repositories(...names: string[]): this
    Share an organization secret with these repositories (`--repos`).
  visibility(value: GhScopeVisibility): this
    The visibility of an organization secret (`--visibility`).
  protected scopeFlags(task: string): string[]
    The scope flags, for a subclass to place among its own.

class GhSecretSetSettings extends GhSecretScopeSettings
  Settings for `gh secret set`.

  name(value: string): this
    The secret's name (required).
  body(value: string): this
    The secret's value (`--body`). Omit it and gh reads standard input, which
    keeps the value out of the process's arguments — see the module docs.
  envFile(path: PathLike): this
    Read names and values from a dotenv file (`--env-file`).
  noStore(): this
    Print the encrypted value instead of storing it (`--no-store`).
  noReposSelected(): this
    Share the organization secret with no repositories (`--no-repos-selected`).
  override protected commandPath(): string[]
    The `gh secret set` command path.
  override protected commandFlags(): string[]
    Assemble the `gh secret set` flags.

class GhSettings extends SubcommandSettings
  Settings for a `gh` invocation.

  override protected defaultTool(): string
    The default executable name: `gh`.
  repo(slug: string): this
    Target repository as `OWNER/REPO` (`-R`/`--repo`).
  protected get repoSlug(): string | undefined
    The repository `.repo(...)` named, for a subclass whose command does not
    take the flag and has to say so.
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

class GhVariableDeleteSettings extends GhCommandSettings
  Settings for `gh variable delete`.

  name(value: string): this
    The variable's name (required).
  org(name: string): this
    Delete an organization variable (`--org`).
  environment(name: string): this
    Delete an environment variable (`--env`).
  override protected commandPath(): string[]
    The `gh variable delete` command path.
  override protected commandFlags(): string[]
    Assemble the `gh variable delete` flags.

class GhVariableGetSettings extends GhReadSettings
  Settings for `gh variable get`.

  name(value: string): this
    The variable's name (required).
  org(name: string): this
    Read an organization variable (`--org`).
  environment(name: string): this
    Read an environment variable (`--env`).
  override protected commandPath(): string[]
    The `gh variable get` command path.
  override protected commandFlags(): string[]
    Assemble the `gh variable get` flags.

class GhVariableListSettings extends GhReadSettings
  Settings for `gh variable list`.

  org(name: string): this
    List an organization's variables (`--org`).
  environment(name: string): this
    List an environment's variables (`--env`).
  override protected commandPath(): string[]
    The `gh variable list` command path.
  override protected commandFlags(): string[]
    Assemble the `gh variable list` flags.

class GhVariableSetSettings extends GhCommandSettings
  Settings for `gh variable set`.

  name(value: string): this
    The variable's name (required).
  body(value: string): this
    Its value (`--body`); omit it and gh reads standard input.
  envFile(path: PathLike): this
    Read names and values from a dotenv file (`--env-file`).
  org(name: string): this
    Scope it to an organization (`--org`).
  environment(name: string): this
    Scope it to a deployment environment (`--env`).
  repositories(...names: string[]): this
    Share an organization variable with these repositories (`--repos`).
  visibility(value: GhScopeVisibility): this
    The visibility of an organization variable (`--visibility`).
  override protected commandPath(): string[]
    The `gh variable set` command path.
  override protected commandFlags(): string[]
    Assemble the `gh variable set` flags.

abstract class GhWebReadSettings extends GhReadSettings
  Base for the read commands that also take `--web`: every one of them except
  `release list`, which gh gives no browser view. Keeping `.web()` here rather
  than on {@link GhReadSettings} is what stops a build offering a flag gh
  would reject.

  web(): this
    Open the result in a browser instead of printing it (`--web`). A build
    has no browser, so this is for a developer running the target by hand.
  override protected readFlags(): string[]
    The read flags, with `--web` last as gh's own help lists it.

class GhWorkflowDisableSettings extends GhWorkflowTargetSettings
  Settings for `gh workflow disable`.

  override protected commandPath(): string[]
    The `gh workflow disable` command path.
  override protected commandFlags(): string[]
    `gh workflow disable` takes no flags of its own.

class GhWorkflowEnableSettings extends GhWorkflowTargetSettings
  Settings for `gh workflow enable`.

  override protected commandPath(): string[]
    The `gh workflow enable` command path.
  override protected commandFlags(): string[]
    `gh workflow enable` takes no flags of its own.

class GhWorkflowListSettings extends GhReadSettings
  Settings for `gh workflow list`.

  all(): this
    Include disabled workflows (`--all`).
  limit(count: number): this
    Cap how many are fetched (`--limit`); gh's default is 50.
  override protected commandPath(): string[]
    The `gh workflow list` command path.
  override protected commandFlags(): string[]
    Assemble the `gh workflow list` flags.

class GhWorkflowRunSettings extends GhWorkflowTargetSettings
  Settings for `gh workflow run` — dispatching a `workflow_dispatch` run.

  ref(name: string): this
    The branch or tag to run it on (`--ref`).
  field(key: string, value: string | number | boolean): this
    An input, as `--field key=value`. gh reads a leading `@` in the value as
    a file to read, so use {@link rawField} for a value that starts with one.
  rawField(key: string, value: string | number | boolean): this
    An input passed verbatim (`--raw-field`), with no `@` file syntax.
  jsonInput(): this
    Read the whole input object as JSON on standard input (`--json`).
  override protected commandPath(): string[]
    The `gh workflow run` command path.
  override protected commandFlags(): string[]
    Assemble the `gh workflow run` flags.

abstract class GhWorkflowTargetSettings extends GhCommandSettings
  Base for the `workflow` commands that name one workflow, which gh takes by
  file name, name, or numeric id.

  workflow(nameOrId: string | number): this
    The workflow — its file name, its name, or its id (required).
  protected requireWorkflow(task: string): string
    The workflow operand, or the failure explaining that gh would prompt.

class GhWorkflowViewSettings extends GhWorkflowTargetSettings
  Settings for `gh workflow view`.

  Unlike the other viewing commands this one prints no JSON — gh gives it
  `--yaml` and `--web` but no `--json` — so it does not carry the read flags.

  ref(name: string): this
    The branch or tag holding the version to view (`--ref`).
  yaml(): this
    Print the workflow's YAML rather than its summary (`--yaml`).
  web(): this
    Open it in a browser instead of printing it (`--web`). A build has no
    browser, so this is for a developer running the target by hand.
  override protected commandPath(): string[]
    The `gh workflow view` command path.
  override protected commandFlags(): string[]
    Assemble the `gh workflow view` flags.

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

interface GhCacheApi
  The `gh cache` members of {@link "./gh.ts".GhTasks}.

  cacheList(configure?: Configure<GhCacheListSettings>): Promise<CommandOutput>
    List the Actions caches: `gh cache list`.
  cacheListEntries(configure?: Configure<GhCacheListSettings>): Promise<GhCacheEntry[]>
    The caches as parsed {@link GhCacheEntry} values — what a build reads to
    decide which ones to reclaim.
  cacheDelete(configure?: Configure<GhCacheDeleteSettings>): Promise<CommandOutput>
    Reclaim caches: `gh cache delete`.

interface GhCacheEntry
  One cache of {@link "./gh.ts".GhTasks.cacheListEntries}.

  id?: number
    The cache's numeric id — what {@link GhCacheDeleteSettings} takes.
  key?: string
    Its key, as the workflow that saved it chose.
  ref?: string
    The ref it belongs to.
  sizeInBytes?: number
    How much space it occupies, in bytes.
  createdAt?: string
    When it was created, ISO 8601.
  lastAccessedAt?: string
    When it was last read, ISO 8601 — what eviction goes by.

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

interface GhIssueApi
  The `gh issue` members of {@link "./gh.ts".GhTasks}.

  issueCreate(configure?: Configure<GhIssueCreateSettings>): Promise<CommandOutput>
    Open an issue: `gh issue create`.
  issueList(configure?: Configure<GhIssueListSettings>): Promise<CommandOutput>
    List issues: `gh issue list`.
  issueListEntries(configure?: Configure<GhIssueListSettings>): Promise<GhIssueEntry[]>
    The issues as parsed {@link GhIssueEntry} values. The `--json` field set
    is pinned, since gh requires one by name.
  issueView(configure?: Configure<GhIssueViewSettings>): Promise<CommandOutput>
    Show an issue: `gh issue view`.
  issueComment(configure?: Configure<GhIssueCommentSettings>): Promise<CommandOutput>
    Comment on an issue: `gh issue comment`.
  issueClose(configure?: Configure<GhIssueCloseSettings>): Promise<CommandOutput>
    Close an issue: `gh issue close`.

interface GhIssueEntry
  One issue of {@link "./gh.ts".GhTasks.issueListEntries}.

  number?: number
    The issue's number.
  title?: string
    Its title.
  state?: string
    Its state, as gh reports it: `OPEN` or `CLOSED`.
  url?: string
    Its web URL.
  author?: string
    The login of whoever opened it.

interface GhLabelApi
  The `gh label` members of {@link "./gh.ts".GhTasks}.

  labelList(configure?: Configure<GhLabelListSettings>): Promise<CommandOutput>
    List labels: `gh label list`.
  labelListEntries(configure?: Configure<GhLabelListSettings>): Promise<GhLabelEntry[]>
    The labels as parsed {@link GhLabelEntry} values. The `--json` field set
    is pinned, since gh requires one by name.
  labelCreate(configure?: Configure<GhLabelCreateSettings>): Promise<CommandOutput>
    Add a label: `gh label create`.
  labelEdit(configure?: Configure<GhLabelEditSettings>): Promise<CommandOutput>
    Change a label: `gh label edit`.
  labelDelete(configure?: Configure<GhLabelDeleteSettings>): Promise<CommandOutput>
    Remove a label: `gh label delete`.
  labelClone(configure?: Configure<GhLabelCloneSettings>): Promise<CommandOutput>
    Copy another repository's labels: `gh label clone`.

interface GhLabelEntry
  One label of {@link "./gh.ts".GhTasks.labelListEntries}.

  name?: string
    The label's name.
  color?: string
    Its colour, as a hex triplet without the `#`.
  description?: string
    Its description.

interface GhPrApi
  The `gh pr` members of {@link "./gh.ts".GhTasks}.

  prCreate(configure?: Configure<GhPrCreateSettings>): Promise<CommandOutput>
    Open a pull request: `gh pr create`. Needs the `gh` binary and its auth;
    {@link "./pull_request.ts".GhPullRequestApi.pullRequest} is the REST path,
    which needs a token instead.
  prList(configure?: Configure<GhPrListSettings>): Promise<CommandOutput>
    List pull requests: `gh pr list`.
  prListEntries(configure?: Configure<GhPrListSettings>): Promise<GhPullRequestEntry[]>
    The pull requests as parsed {@link GhPullRequestEntry} values. The
    `--json` field set is pinned, since gh requires one by name.
  prView(configure?: Configure<GhPrViewSettings>): Promise<CommandOutput>
    Show a pull request: `gh pr view`.
  prChecks(configure?: Configure<GhPrChecksSettings>): Promise<CommandOutput>
    Report a pull request's checks: `gh pr checks`.
  prMerge(configure?: Configure<GhPrMergeSettings>): Promise<CommandOutput>
    Merge a pull request: `gh pr merge`.
  prComment(configure?: Configure<GhPrCommentSettings>): Promise<CommandOutput>
    Comment on a pull request: `gh pr comment`.
  prEdit(configure?: Configure<GhPrEditSettings>): Promise<CommandOutput>
    Change a pull request's metadata: `gh pr edit`.
  prClose(configure?: Configure<GhPrCloseSettings>): Promise<CommandOutput>
    Close a pull request: `gh pr close`.

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

interface GhPullRequestEntry
  One pull request of {@link "./gh.ts".GhTasks.prListEntries}.

  number?: number
    The pull request's number.
  title?: string
    Its title.
  state?: string
    Its state, as gh reports it: `OPEN`, `CLOSED`, or `MERGED`.
  isDraft?: boolean
    Whether it is still a draft.
  headRefName?: string
    The branch the changes are on.
  baseRefName?: string
    The branch they would merge into.
  url?: string
    Its web URL.
  author?: string
    The login of whoever opened it.

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

interface GhReleaseApi
  The `gh release` members of {@link "./gh.ts".GhTasks}.

  releaseCreate(configure?: Configure<GhReleaseCreateSettings>): Promise<CommandOutput>
    Publish a release: `gh release create`.
  releaseList(configure?: Configure<GhReleaseListSettings>): Promise<CommandOutput>
    List releases: `gh release list`.
  releaseListEntries(configure?: Configure<GhReleaseListSettings>): Promise<GhReleaseEntry[]>
    The releases as parsed {@link GhReleaseEntry} values. The `--json` field
    set is pinned, since gh requires one by name.
  releaseView(configure?: Configure<GhReleaseViewSettings>): Promise<CommandOutput>
    Show a release: `gh release view`.
  releaseUpload(configure?: Configure<GhReleaseUploadSettings>): Promise<CommandOutput>
    Attach assets to a release: `gh release upload`. Needs the `gh` binary;
    {@link "./release_asset.ts".GhReleaseAssetApi.uploadReleaseAsset} is the
    REST path, which needs a token instead.
  releaseDownload(configure?: Configure<GhReleaseDownloadSettings>): Promise<CommandOutput>
    Download a release's assets: `gh release download`.
  releaseEdit(configure?: Configure<GhReleaseEditSettings>): Promise<CommandOutput>
    Change a release: `gh release edit`.
  releaseDelete(configure?: Configure<GhReleaseDeleteSettings>): Promise<CommandOutput>
    Remove a release: `gh release delete`.

interface GhReleaseAssetApi
  The shape of the release-asset task, mixed into `GhTasks`.

  uploadReleaseAsset(configure?: Configure<GhReleaseAssetSettings>): Promise<GhReleaseAssetResult>
    Attach a file to a GitHub release — the latest release by default, or the
    one named by `.tag(...)`. Idempotent: an asset the release already
    carries under the same name is kept as-is (unless `.refresh()` asks for
    one with different bytes to be replaced), and a repository with no
    releases resolves to `state: "no-release"` rather than throwing. Needs a
    token with `contents: write`.

interface GhReleaseAssetResult
  What became of a release-asset upload.

  state: "uploaded" | "refreshed" | "already-exists" | "no-release"
    `uploaded` when the asset was sent; `refreshed` when `.refresh()` found
    the release carrying different bytes under the name and replaced them;
    `already-exists` when the release carries an asset of the same name that
    was kept (nothing was changed); `no-release` when the repository has no
    release to attach to.
  name: string
    The asset name the call targeted.
  releaseTag?: string
    The tag of the release the asset belongs to, when one was resolved.
  releaseId?: number
    The id of the release the asset belongs to, when one was resolved.
  url?: string
    The asset's download URL, when it was uploaded or already present.

interface GhReleaseEntry
  One release of {@link "./gh.ts".GhTasks.releaseListEntries}.

  tagName?: string
    The release's tag.
  name?: string
    Its name, which GitHub calls the title.
  isDraft?: boolean
    Whether it is still a draft.
  isPrerelease?: boolean
    Whether it is marked a prerelease.
  isLatest?: boolean
    Whether it is the latest release.
  publishedAt?: string
    When it was published, ISO 8601; absent while it is a draft.

interface GhReleaseLatestApi
  The mark-latest operation {@link GhTasks} exposes.

  markReleaseLatest(configure?: Configure<GhReleaseLatestSettings>): Promise<GhReleaseLatestResult>
    Point the repository's "Latest release" at the release for `.tag(...)`.

    Idempotent, and quiet about it: a pointer already on the tag's release is
    left untouched rather than re-written, so an unattended pipeline can run
    this unconditionally without churning the release's audit history. A tag
    with no release resolves to `state: "no-release"` rather than throwing —
    the release may be cut by a later, human step — while a tag that does not
    exist at all is an error, because the caller named it. Needs a token with
    `contents: write`.

interface GhReleaseLatestResult
  What became of a {@link GhReleaseLatestApi.markReleaseLatest} call.

  state: "marked" | "already-latest" | "no-release"
    `marked` when the pointer was moved onto the tag's release;
    `already-latest` when it was there before the call (nothing was written);
    `no-release` when the tag has no release to point at — an ordinary
    outcome for a tag whose release is created by a later, human step.
  tag: string
    The tag the call targeted.
  releaseId?: number
    The id of the tag's release, when one was resolved.

interface GhRepoApi
  The `gh repo` members of {@link "./gh.ts".GhTasks}.

  repoClone(configure?: Configure<GhRepoCloneSettings>): Promise<CommandOutput>
    Clone a repository: `gh repo clone`.
  repoCreate(configure?: Configure<GhRepoCreateSettings>): Promise<CommandOutput>
    Create a repository: `gh repo create`.
  repoView(configure?: Configure<GhRepoViewSettings>): Promise<CommandOutput>
    Show a repository: `gh repo view`.
  repoList(configure?: Configure<GhRepoListSettings>): Promise<CommandOutput>
    List repositories: `gh repo list`.
  repoListEntries(configure?: Configure<GhRepoListSettings>): Promise<GhRepositoryEntry[]>
    The repositories as parsed {@link GhRepositoryEntry} values. The `--json`
    field set is pinned, since gh requires one by name.
  repoFork(configure?: Configure<GhRepoForkSettings>): Promise<CommandOutput>
    Fork a repository: `gh repo fork`.
  repoSync(configure?: Configure<GhRepoSyncSettings>): Promise<CommandOutput>
    Bring a fork up to date: `gh repo sync`.
  repoEdit(configure?: Configure<GhRepoEditSettings>): Promise<CommandOutput>
    Change a repository's settings: `gh repo edit`.
  repoRename(configure?: Configure<GhRepoRenameSettings>): Promise<CommandOutput>
    Rename a repository: `gh repo rename`.
  repoArchive(configure?: Configure<GhRepoArchiveSettings>): Promise<CommandOutput>
    Archive or unarchive a repository: `gh repo archive`/`unarchive`.
  repoDelete(configure?: Configure<GhRepoDeleteSettings>): Promise<CommandOutput>
    Delete a repository: `gh repo delete`. Needs the `delete_repo` scope.
  repoSetDefault(configure?: Configure<GhRepoSetDefaultSettings>): Promise<CommandOutput>
    Choose the repository gh acts on by default: `gh repo set-default`.

interface GhRepositoryEntry
  One repository of {@link "./gh.ts".GhTasks.repoListEntries}.

  name?: string
    The repository's name, without the owner.
  nameWithOwner?: string
    Its full `owner/name`.
  description?: string
    Its description.
  isPrivate?: boolean
    Whether it is private.
  isFork?: boolean
    Whether it is a fork.
  isArchived?: boolean
    Whether it is archived.
  url?: string
    Its web URL.
  updatedAt?: string
    When it was last updated, ISO 8601.

interface GhRunApi
  The `gh run` members of {@link "./gh.ts".GhTasks}.

  runList(configure?: Configure<GhRunListSettings>): Promise<CommandOutput>
    List workflow runs: `gh run list`.
  runListEntries(configure?: Configure<GhRunListSettings>): Promise<GhRunEntry[]>
    The runs as parsed {@link GhRunEntry} values — the reader a build branches
    on. The `--json` field set is pinned, since gh requires one by name.
  runView(configure?: Configure<GhRunViewSettings>): Promise<CommandOutput>
    Show a run: `gh run view`.
  runRerun(configure?: Configure<GhRunRerunSettings>): Promise<CommandOutput>
    Rerun a run, or its failed jobs: `gh run rerun`.
  runCancel(configure?: Configure<GhRunCancelSettings>): Promise<CommandOutput>
    Stop a run: `gh run cancel`.
  runDelete(configure?: Configure<GhRunDeleteSettings>): Promise<CommandOutput>
    Remove a run: `gh run delete`.
  runDownload(configure?: Configure<GhRunDownloadSettings>): Promise<CommandOutput>
    Fetch a run's artifacts: `gh run download`.
  runWatch(configure?: Configure<GhRunWatchSettings>): Promise<CommandOutput>
    Follow a run until it finishes: `gh run watch`. A target that watches
    blocks until Actions is done, so pair it with `.killAfter(...)` unless
    the wait is the point.

interface GhRunEntry
  One workflow run of {@link "./gh.ts".GhTasks.runListEntries}.

  databaseId?: number
    The run's numeric id — what every other `run` command takes.
  number?: number
    Its number within its workflow.
  displayTitle?: string
    The title GitHub displays, usually the head commit's subject.
  workflowName?: string
    The name of the workflow it ran.
  headBranch?: string
    The branch it ran on.
  event?: string
    The event that triggered it.
  status?: string
    Its status, as gh reports it: `completed`, `in_progress`, …
  conclusion?: string
    Its conclusion once complete: `success`, `failure`, …
  url?: string
    Its web URL.
  createdAt?: string
    When it was created, ISO 8601.

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

interface GhSecretApi
  The `gh secret` members of {@link "./gh.ts".GhTasks}.

  secretSet(configure?: Configure<GhSecretSetSettings>): Promise<CommandOutput>
    Store a secret: `gh secret set`. A value passed as `.body(...)` becomes an
    argv entry and is readable in a process listing — see the module docs of
    {@link "./secret.ts".GhSecretSetSettings} for the alternatives.
  secretList(configure?: Configure<GhSecretListSettings>): Promise<CommandOutput>
    List the secrets' names: `gh secret list`.
  secretListEntries(configure?: Configure<GhSecretListSettings>): Promise<GhSecretEntry[]>
    The secrets as parsed {@link GhSecretEntry} values — names and metadata;
    GitHub never returns a secret's value.
  secretDelete(configure?: Configure<GhSecretDeleteSettings>): Promise<CommandOutput>
    Remove a secret: `gh secret delete`.

interface GhSecretEntry
  One secret of {@link "./gh.ts".GhTasks.secretListEntries}. GitHub never
  returns a secret's value, so an entry is its name and its metadata.

  name?: string
    The secret's name.
  updatedAt?: string
    When it was last updated, ISO 8601.
  visibility?: string
    The visibility of an organization secret.

interface GhTasksApi extends GhAppTokenApi, GhSarifApi, GhReleaseAssetApi, GhReleaseLatestApi, GhCommitApi, GhPullRequestApi, GhCheckRunApi, GhPrApi, GhIssueApi, GhReleaseApi, GhRunApi, GhWorkflowApi, GhSecretApi, GhVariableApi, GhCacheApi, GhRepoApi, GhLabelApi
  The shape of {@link GhTasks}: the `gh` CLI plus the GitHub operations that
  have no CLI subcommand (see {@link GhAppTokenApi}, {@link GhSarifApi}) and
  would otherwise force a build back to a marketplace action.

  run(configure?: Configure<GhSettings>): Promise<CommandOutput>
    Run a `gh` command.
  api(endpoint: string, configure?: Configure<GhApiSettings>): Promise<CommandOutput>
    Call a REST endpoint through `gh api`, with the user's `gh` credentials —
    for operations that have no CLI verb, e.g. starring a repository:
    `GhTasks.api("user/starred/zuke-build/zuke", (s) => s.method("PUT"))`.

interface GhVariableApi
  The `gh variable` members of {@link "./gh.ts".GhTasks}.

  variableSet(configure?: Configure<GhVariableSetSettings>): Promise<CommandOutput>
    Store a variable: `gh variable set`.
  variableGet(configure?: Configure<GhVariableGetSettings>): Promise<CommandOutput>
    Read a variable: `gh variable get`.
  variableValue(configure?: Configure<GhVariableGetSettings>): Promise<string>
    A variable's value, with the trailing newline gh prints removed.
  variableList(configure?: Configure<GhVariableListSettings>): Promise<CommandOutput>
    List variables: `gh variable list`.
  variableListEntries(configure?: Configure<GhVariableListSettings>): Promise<GhVariableEntry[]>
    The variables as parsed {@link GhVariableEntry} values, values included —
    a variable is not a secret.
  variableDelete(configure?: Configure<GhVariableDeleteSettings>): Promise<CommandOutput>
    Remove a variable: `gh variable delete`.

interface GhVariableEntry
  One variable of {@link "./gh.ts".GhTasks.variableListEntries}.

  name?: string
    The variable's name.
  value?: string
    Its value, which GitHub returns in the clear.
  updatedAt?: string
    When it was last updated, ISO 8601.
  visibility?: string
    The visibility of an organization variable.

interface GhWorkflowApi
  The `gh workflow` members of {@link "./gh.ts".GhTasks}.

  workflowList(configure?: Configure<GhWorkflowListSettings>): Promise<CommandOutput>
    List workflows: `gh workflow list`.
  workflowListEntries(configure?: Configure<GhWorkflowListSettings>): Promise<GhWorkflowEntry[]>
    The workflows as parsed {@link GhWorkflowEntry} values. The `--json` field
    set is pinned, since gh requires one by name.
  workflowView(configure?: Configure<GhWorkflowViewSettings>): Promise<CommandOutput>
    Show a workflow, or its YAML: `gh workflow view`.
  workflowRun(configure?: Configure<GhWorkflowRunSettings>): Promise<CommandOutput>
    Dispatch a workflow: `gh workflow run`. This returns once the dispatch is
    accepted; {@link "./workflow.ts".githubWorkflow} is the wait trigger that
    suspends the build until the run finishes.
  workflowEnable(configure?: Configure<GhWorkflowEnableSettings>): Promise<CommandOutput>
    Turn a workflow on: `gh workflow enable`.
  workflowDisable(configure?: Configure<GhWorkflowDisableSettings>): Promise<CommandOutput>
    Turn a workflow off: `gh workflow disable`.

interface GhWorkflowEntry
  One workflow of {@link "./gh.ts".GhTasks.workflowListEntries}.

  id?: number
    The workflow's numeric id.
  name?: string
    Its name, as the `name:` key of its file declares it.
  path?: string
    Its path in the repository, e.g. `.github/workflows/ci.yml`.
  state?: string
    Its state, as gh reports it: `active`, `disabled_manually`, …

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

type GhCacheSort = "created_at" | "last_accessed_at" | "size_in_bytes"
  What `gh cache list --sort` orders the caches by.

type GhCheckConclusion = "success" | "failure" | "neutral" | "cancelled" | "skipped" | "timed_out" | "action_required"
  A check run's conclusion, as GitHub spells them.

  `"stale"` is deliberately absent: GitHub sets it itself and rejects it from a
  caller.

type GhCloseReason = "completed" | "not planned" | "duplicate"
  Why an issue is being closed (`--reason`).

type GhLabelSort = "created" | "name"
  What `gh label list --sort` orders the labels by.

type GhMergeMethod = "merge" | "squash" | "rebase"
  How `gh pr merge` combines the commits.

type GhPermissionLevel = "read" | "write" | "admin"
  A permission level an installation token can be narrowed to.

type GhRepoVisibility = "public" | "private" | "internal"
  How visible a repository is (`--visibility`).

type GhRunStatus = "queued" | "completed" | "in_progress" | "requested" | "waiting" | "pending" | "action_required" | "cancelled" | "failure" | "neutral" | "skipped" | "stale" | "startup_failure" | "success" | "timed_out"
  The status `gh run list --status` filters by: the run's state while it is
  going, then the conclusion it settles on.

type GhScopeVisibility = "all" | "private" | "selected"
  Who an organization value is visible to (`--visibility`).

type GhSecretApp = "actions" | "agents" | "codespaces" | "dependabot"
  Which application reads the secret (`--app`).
````

</details>

<!-- ZUKE:API:END -->

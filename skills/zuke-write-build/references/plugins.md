# Plugins: AI review, telemetry, canary, packaging

`@zuke/ai`, `@zuke/otel`, `@zuke/prometheus`, `@zuke/canary`, `@zuke/homebrew`,
`@zuke/chocolatey`, `@zuke/qr`, and the core helpers.

> Confirm exact signatures against the version the project has installed: on
> Node, `node_modules/@zuke/<package>/README.md` (its `## API` section) and the
> `.d.ts` files; on Deno, `deno doc jsr:@zuke/<package>`. For breadth, use
> `llms-full.txt`
> (<https://raw.githubusercontent.com/zuke-build/zuke/master/llms-full.txt>,
> which tracks `master`). This file is a summary, not the source of truth.

## In brief

- **AI review & self-healing (`@zuke/ai`):** gate a target on a structured LLM
  review of the diff (`securityReviewer(...)` etc. via `.validateBefore`), or
  attach `aiFixer(...)` with `.recoverWith(...)` so a failing target is
  diagnosed and (opt-in) auto-fixed, with a committable PR suggestion. Override
  `recoverWith()` on the build to apply one fixer to every target. Reviewers
  attached side by side to one target post one combined PR comment (verdict
  table, merged findings with a reviewer badge, folded reports), and all of them
  run even after one fails. A reviewer can go deeper and hold a discussion:
  `.conventionsFile("AGENTS.md")` (judged against the project's rules, read from
  the diff base), `.criteriaFile(...)` (project-specific notes read from that
  base too — `.criteria(text)` is build code and travels with the change),
  `.fileContext()` (whole changed files, not bare hunks), `.verify()`
  (adversarial re-check of every finding), and `.discussion()` (maintainers
  refute a finding by replying with its id — or, with `.discussion((d) =>
  d.threads())`, by replying in the finding's own line-anchored review thread;
  accepted dismissals persist instead of resurfacing, including when the model
  rewords the finding, refutations from `.verify()` are remembered too, and a
  rebuttal is adjudicated even when the next round's model drops the finding —
  only platform-verified maintainer comments ever reach the model, on GitHub,
  GitLab, Azure DevOps and Bitbucket alike). A maintainer's decision is
  inherited by a restatement on any file of the diff and at any severity, and
  shared with every reviewer on the pull request. A rebuttal needs no push:
  commenting the workflow's `command` (e.g. `@zuke-build review`) starts a run
  that adjudicates it and answers in the thread. With `.discussion((d) =>
  d.commands("@zuke-build"))` the comment carries a collapsed Commands panel,
  and `@zuke-build accept <id> <reason>` records a finding as accepted for the
  pull request without adjudication; the workflow generator derives the
  on-demand job from that mention, and `command: (c) => c.role(...).users(...)`
  chooses who may start it. Reviews post as `github-actions[bot]` by default, or
  as your own GitHub App via `GhTasks.appTokenSource`. Detail below.
- **Canary releases (`@zuke/canary`):** `rollout = canary((c) =>
  c.platform(p).steps(10, 50).bake("10m").analysis(...).lock(...))` stamps out
  `rollout.stage`, `rollout.stepN.expose` / `.bake` / `.analyze`, an optional
  `rollout.approve`, `rollout.promote` and `rollout.abort`; every failure path —
  a failed analysis or step, an approval timeout, `zuke cancel` — runs the one
  `abort`. Needs a state store. `p` is a `CanaryPlatform` (`stage`, `expose`,
  `promote`, `abort`); a hand-written object is fine, and Cloud Run has one
  ready: `cloudRunCanary((r) => r.service("api").region(…).image(…))` from
  `@zuke/gcloud` — judged on the candidate's own errors by `cloudMonitoring((m)
  => m.metricType(…).cloudRunCandidate("api", …).max(5))`, from the same package
  — and Kubernetes too: `kubectlCanary((k) => k.stable(…)
  .canary(…).container(…).image(…).replicas(…))` from `@zuke/kubectl`, and Helm:
  `helmCanary((h) => h.chart(…).version(…).stableRelease(…).image(…)
  .replicas(…))` from `@zuke/helm`, and Docker Compose: `dockerComposeCanary((d)
  => d.service(…).canaryService(…).replicas(…) .image(…))` from
  `@zuke/docker-compose`, and AWS Lambda: `lambdaCanary((l) =>
  l.functionName(…).alias("live") .zipFile(…).aws((a) => a.region(…)))` from
  `@zuke/aws`, and Azure Container Apps: `containerAppCanary((a) =>
  a.name(…).resourceGroup(…) .image(…).az((z) => z.subscription(…)))` from
  `@zuke/az`. Detail below.
- **Prometheus (`@zuke/prometheus`):** read a metric instead of hand-rolling the
  HTTP call — `PrometheusTasks.value(await PrometheusTasks.query((s) =>
  s.url(u).bearerToken(this.token.value).query(q)))` returns the one number (a
  scalar or a one-sample vector; empty or several fails). One task per endpoint
  (`queryRange`, `series`, `labels`, `labelValues`, `metadata`, `targets`,
  `rules`, `alerts`, `buildInfo`, `healthy`, `ready`); refusals are
  `PrometheusApiError` (status, `errorType`). A credentialed URL must be
  `https:` unless loopback (an unauthenticated in-cluster `http://` one is
  fine); custom auth via `.credentials(fn)`, and the managed services built in
  with no cloud CLI: `.google()`, `.azure()`, `.sigv4((a) => a.region(…))`.
  Canary's `prometheus(...)` analysis runs on it.
- **Homebrew (`@zuke/homebrew`):** ship a prebuilt binary through a tap —
  `HomebrewTasks.formula((s) => s.name(…).description(…).homepage(…) .binary((b)
  => b.os("macos").arch("arm").url(…).sha256(…)) .install(…).test((t) =>
  t.command("--version").expectVersion()))` renders the Ruby (every value
  escaped), `HomebrewTasks.publish((s) => s.tap("acme/tap") .formula(name,
  ruby).token(…))` writes `Formula/<name>.rb` (`unchanged`, no commit, when
  identical), `HomebrewTasks.verify` installs/tests/uninstalls it through a
  throwaway local tap, and `HomebrewTasks.verifyJob` is its macOS + Linux CI
  job. Set `.version(…)` only when the URLs do not carry it — `brew audit`
  rejects a version it can already scan from the URL. `BrewTasks` types the
  `brew` CLI itself.
- **Chocolatey (`@zuke/chocolatey`):** ship a prebuilt Windows binary —
  `ChocolateyTasks.package((s) => s.id(…).version(…).authors(…)
  .projectUrl(…).description(…).url64bit(zipUrl).checksum64(sha))` renders the
  nuspec and `tools/chocolateyinstall.ps1` (XML- and PowerShell-escaped; no
  uninstall script — choco removes the unpacked zip and its shims),
  `ChocolateyTasks.verify((s) => s.package(pkg).binary("app")
  .command("--version").expectVersion())` packs/installs/runs/uninstalls it from
  a temp source, `ChocolateyTasks.publish((s) => s.package(pkg) .apiKey(…))`
  pushes to `https://push.chocolatey.org/` with the key masked, and
  `ChocolateyTasks.verifyJob` is its Windows CI job. `ChocoTasks` types the
  `choco` CLI itself.
- **OpenTelemetry export (`@zuke/otel`):** register `otel((s) => s.endpoint(…))`
  as a plugin (`run(MyBuild, { plugins: [otel(…)] })`) to ship run/target spans
  and `zuke.run.started` / `zuke.run.suspended` / `zuke.runs` counters as
  OTLP/HTTP JSON. Needs a state store; the trace id is derived from the run id,
  so a suspend/resume across processes is one trace. Config falls back to the
  standard `OTEL_*` env vars, and it is inert with no endpoint. Dependency-free.
- **QR codes (`@zuke/qr`):** `QrTasks.print(text, (s) =>
  s.errorCorrection("Q"))` renders any data as a scannable code in the terminal
  — a URL, a Wi-Fi or login string, a token, JSON — with no `qrencode` or npm
  package. `QrTasks.render` returns the lines for a log or a file,
  `QrTasks.encode` the raw module matrix for an SVG, PNG or slide.
  Dependency-free.

## AI review & self-healing — `@zuke/ai`

A model becomes part of the build graph two ways. Only the provider (`"claude"`
| `"openai"` | `"gemini"`) and an API key (pass a `parameter().secret()`) are
required; everything else is defaulted.

Neither interface is AI-specific, and neither needs a base class: a
**`Validation`** is any object with a `validate(context)` method (throw to fail
the target), and a **`Remediation`** is any object with a `remediate(...)`
method that repairs the failure and asks for the body to be re-run — the real
build command is the verifier. Write your own wherever a check or a fix is
mechanical rather than a model's job.

**Review gate** — a reviewer is a `Validation`; attach with `.validateBefore` /
`.validateAfter`. It scores the diff and breaks the build past a threshold.

```ts
import { securityReviewer } from "@zuke/ai";

key = parameter("OpenAI API key").secret();
review = securityReviewer((r) =>
  r.provider("openai").apiKey(this.key).failWhen((g) => g.scoreAbove(8))
);
deploy = target().validateBefore(this.review).executes(() => {/* ... */});
```

Factories: `securityReviewer`, `secretsReviewer`, `correctnessReviewer`,
`licenseReviewer`, `genericReviewer`.

Depth and discussion knobs (all optional, per reviewer):

- `.conventionsFile("AGENTS.md")` — feed the project's conventions document as
  fenced reference material; read from the diff **base** (via `git show`) when
  the diff has one, so a PR cannot rewrite the rules it is judged by.
- `.criteriaFile(".github/review-criteria.md")` — project-specific notes read
  the same way, from the diff **base**. It is the base-anchored half of
  `.criteria(text)`, which is build code evaluated by the build under review and
  so is always read from the head: put the notes a branch should not be able to
  widen — an accepted design that suppresses the findings restating it — in the
  file. The suppress list is head-read too, and every suppressed finding stays
  listed in the report.
- `.fileContext()` — also send the changed files' full contents (bounded), so
  the model can check a finding against surrounding guards before reporting.
- `.verify()` — a second, adversarial pass re-checks every candidate finding;
  only a refutation backed by citable contrary evidence removes one (listed in
  the report, never gating), while a candidate the evidence neither confirms nor
  refutes stays reported as `uncertain`. With `.discussion()`, a refutation is
  remembered in the state block with its evidence and a digest of everything the
  verifier saw (diff and file context): a re-report while that input is
  unchanged is dropped in code (listed as standing from an earlier round, no
  verifier call), and one after it changed — or one a maintainer replied to in
  its thread — goes back to the verifier carrying the earlier evidence.
- `.comment("append")` — post a fresh PR comment per run (history stays on the
  thread) instead of the default single upserted comment per reviewer.
- Commenting reviewers side by side in one `.validateBefore(a, b)` share **one**
  PR comment, automatically: a verdict table (one row per reviewer), the merged
  findings table with a Reviewer column, and each reviewer's report folded
  underneath. Every one of them runs even when an earlier one fails; the target
  then fails with all their reasons. Another validation between two reviewers
  splits them. `.badge("🔒")` changes the reviewer's marker (defaults: 🛡️
  security, 🧹 generic, 🔑 secrets, 🐛 correctness, ⚖️ license).
- `.reactions(false)` — opt out of the reactions `.comment()` turns on: on the
  PR description 👀 while reviewing, then 👍 clean / 🎉 clean after a failed run
  / 🤏 findings under the gate (😕 on GitHub) / 👎 failed — the worst verdict
  across the run's reviewers — and 🚀 when a fixer pushes; on a `review` command
  comment 👍 started / 😕 cannot run; on a trusted maintainer reply 👀 read / ❤️
  decided a finding. GitHub and GitLab only; a no-op elsewhere.
- `.discussion((d) => d.threads())` — anchor each finding to its line as a PR
  **review thread**: the maintainer contests it by replying in that thread (no
  id to quote), and the reviewer replies with the outcome and resolves the
  thread when the finding is dismissed or fixed. The summary comment is still
  posted and still lists every finding, so an unanchorable finding (no line, an
  invented line, a line only present as a deletion) loses nothing — it stays in
  the table and the report's Notes say why. Lines are never guessed at. GitHub
  only; other hosts note it and post the summary alone. A finding the verifier
  refutes gets a "refuted" reply with the evidence and its thread resolved. A
  rebuttal is answered without a push by commenting the workflow's `command`
  (e.g. `@zuke-build review`): that run adjudicates every reply and answers in
  the thread. The workflow does not run on every reply — that would snowball.
- `.discussion((d) => d.commands("@zuke-build"))` — take commands addressed to
  that mention (the workflow command's handle). Every review comment then
  carries a collapsed **Commands** panel with one line of help per command, and
  `@zuke-build accept <id> <reason>` from a trusted maintainer records the
  finding as **accepted** for the pull request — no adjudication, listed under
  its own heading, its thread answered with ✅ and resolved, never raised again
  by any reviewer however it is reworded, moved or escalated. In a finding's
  thread the id may be left out. On GitHub the workflow generator derives the
  on-demand job from the mention — `@zuke-build review` and `@zuke-build accept`
  — so nothing is declared twice; `command: (c) =>
  c.role("triage").users("alice").secrets(this.appKey)` refines who may start a
  run and what the job holds, and `c.text("/review")` overrides the text. The
  reviews post as `github-actions[bot]` with nothing set up; to post as a GitHub
  App of your own (which also lets the reviewer resolve the threads it answers),
  declare its id and key as parameters and pass `GhTasks.appTokenSource((s) =>
  s.app(this.appId, this.appKey))` to `.commentToken(...)` — it mints once per
  run and yields `GITHUB_TOKEN` wherever the App is absent. `secrets:
  [this.appId, this.appKey]` on the workflow spec passes them to both jobs, by
  the parameters' env names.
- `.discussion()` — the reviewer engages with the PR thread instead of looping:
  a maintainer contests a finding by replying with its id quoted, an
  adjudication pass weighs the rebuttal on merit, and an accepted dismissal is
  remembered (in a state block inside the reviewer's own comment) so the finding
  — or a rewording — doesn't resurface without new evidence. A rewording is
  caught structurally, not just by asking the model nicely: a finding whose id
  the state doesn't know is compared against the decided findings, and a match
  adopts that identity, so a dismissal is inherited (shown with the earlier
  title) and a fixed finding reopens under the id the thread already knows. A
  maintainer's decision — a dismissal, an acceptance, a contested finding — is
  inherited across the files of the diff and at any severity, is offered first
  and outside the comparison cap, and is shared with every reviewer on the pull
  request (each reads the others' state blocks); the model's own decisions
  (refuted, fixed, still open) match same file only and never a more severe
  finding. The rewording is recorded as an alias, making later rounds free. The
  pass can only rename, with bounded comparisons per run, and every failure
  leaves the finding reported. It also tracks progress: still-open findings are
  re-assessed each round, ones that stop reproducing are marked fixed and listed
  cumulatively ("✅ Fixed since first review"), and a fixed finding that
  reappears reopens. A contested finding the next round does not re-report (or
  the verifier refutes) is still adjudicated: an accepted rebuttal records it
  dismissed — sticky, replied in-thread — never "fixed". Trust is decided in
  code from the host's author metadata (`OWNER`/`MEMBER`/ `COLLABORATOR` by
  default; tune with `.discussion((d) => d.trustAuthors(...))`) — untrusted
  comments never reach the model, which blunts comment-based prompt injection.
  Requires `.comment()`; works on every supported host, each mapping its own
  metadata onto those association names: GitHub uses `author_association` plus a
  collaborators API lookup that counts push access as `COLLABORATOR` (the
  Actions token sees a private organisation member as `CONTRIBUTOR`), GitLab
  derives it from project membership (Owner 50 → `OWNER`, Developer/Maintainer
  30/40 → `MEMBER`, below that `NONE`), Bitbucket from workspace permissions
  (`owner`/`collaborator`/`member`). **Azure DevOps reports no such
  relationship**, so nobody is trusted there by association — name the
  maintainers with `.trustAuthors(...)`. The mapping fails closed: if the
  membership listing is refused, associations come back empty and only
  `.trustAuthors(...)` admits anyone. `.trustAuthors(...)` takes each host's
  **stable** identifier, never a display name: GitHub `login`, GitLab
  `username`, Azure `uniqueName` (the sign-in address), Bitbucket the account
  **uuid** with braces (`"{9c2c…}"`) — a Bitbucket nickname is a self-assigned,
  non-unique alias and is deliberately not matched. Dismissals persist only
  while the reviewer can recognise its own comment, which on Bitbucket needs an
  app password (a repository/workspace access token is not an account and cannot
  self-identify).

**Self-healing** — `aiFixer` is a `Remediation`; attach with
`.recoverWith(...)`. On a failing body it diagnoses the failure and (safe
default) posts the diagnosis + a committable, Copilot-style inline suggestion to
the PR — writing no files. The build re-runs the real command to verify any
applied fix.

```ts
import { aiFixer } from "@zuke/ai";

// Per target:
test = target()
  .executes(() => DenoTasks.test((s) => s.allowAll()))
  .recoverWith(aiFixer((f) => f.provider("openai").apiKey(this.key)));

// Or globally — override recoverWith() to attach a fixer to EVERY target:
override recoverWith() {
  return [aiFixer((f) => f.provider("openai").apiKey(this.key))];
}
```

Both compose: a target's own `.recoverWith(...)` runs first, then the
build-level `recoverWith()`. Opt into changes with `.autoApply()` (path
allowlist, file cap) and `.commitFixes()`; `.diff((d) => d.fetchBase())` fetches
the PR base branch for context so CI needs no manual `git fetch`. Keys ride
through `parameter().secret()`, which Zuke masks in CI output.

`.runOnly(scope)` decides where a fixer may run: `"local"` (the default —
applies locally, only diagnoses on CI), `"ci"` (applies on CI and does not run
at all off it), or `"both"`. **Any fixer that can write should be
`.runOnly("ci")`** — it is the only scope that heals a pull request without ever
rewriting a working tree someone is editing, and an exported API key is not a
local guard. `.allowCI()` is the deprecated alias for `"both"`.

Everything a fixer sends the model comes from the branch under repair — the
error output, the diff, and the conventions read from `CLAUDE.md`/`AGENTS.md` —
so all three go out fenced as untrusted data, with the system prompt naming them
as data rather than instructions. **`.conventions(text)` is a trust pin**: it
overrides that read, so a fixer authorized to write (`.autoApply()`,
`.commitFixes()`, or any `agentFixer`, which runs an agent with no path
allowlist) is not taking direction from a document the author of the failing
change controls. `.conventions("")` sends none. The reviewers do the stronger
thing already — `.conventionsFile(...)` and `.criteriaFile(...)` read from the
diff base.

**Delegate to a coding agent** — `agentFixer(runner)` is a `Remediation` that
hands the failure to a coding agent you inject (`@zuke/claude`, `@zuke/codex`,
`@zuke/gemini`) which edits files itself, then re-runs the target to verify. One
generic fixer, agent chosen at the call site; takes the same `.runOnly(scope)`,
and `"ci"` matters most here since the agent edits files autonomously.

```ts
import { agentFixer } from "@zuke/ai";
import { ClaudeTasks } from "@zuke/claude";

test = target()
  .executes(() => DenoTasks.test((s) => s.allowAll()))
  .recoverWith(
    agentFixer((ctx) =>
      ClaudeTasks.run((s) => s.prompt(ctx.prompt).permissionMode("acceptEdits"))
    ),
  );
```

## OpenTelemetry export — `@zuke/otel`

A plugin that ships run/target spans and counters to an OTLP/HTTP JSON
collector. Register it on the run, not the build — it observes durable run
state, so a **state store is required**.

```ts
import { run } from "@zuke/core";
import { otel } from "@zuke/otel";

await run(MyBuild, {
  plugins: [
    otel((s) =>
      s.endpoint("http://localhost:4318") // else OTEL_EXPORTER_OTLP_ENDPOINT
        .serviceName("my-build") // else OTEL_SERVICE_NAME
        .header("authorization", "Bearer …") // else OTEL_EXPORTER_OTLP_HEADERS
    ),
  ],
});
// Or fully env-driven: run(MyBuild, { plugins: [otel()] })
```

- Exports a **trace** (run span + one child span per executed target) when the
  run settles, plus `zuke.run.started` / `zuke.run.suspended` /
  `zuke.runs{outcome}` counters.
- The trace id is `SHA-256(runId)`, so a **suspend/resume across processes is
  one trace** — the finishing process exports the complete, gap-spanning run.
- **Inert with no endpoint** (safe to always register); **best-effort** (a dead
  collector never fails the build); the record is **secret-free**. No runtime
  deps. See
  [`docs/observability.md`](https://github.com/zuke-build/zuke/blob/master/docs/observability.md).

## Prometheus — `@zuke/prometheus`

`PrometheusTasks` is the Prometheus HTTP API, one task per endpoint, each
configured by a lambda that sets the connection and the call's parameters (the
API's own names: `time`, `timeout`, `limit`, `lookbackDelta`, `start`, `end`,
`step`, `match`, …).

```ts
import {
  type PrometheusConnectionSettings,
  PrometheusTasks,
} from "@zuke/prometheus";

// Share the connection half across calls as a generic function.
const prod = <S extends PrometheusConnectionSettings>(s: S) =>
  s.url("https://prometheus.internal").bearerToken(token);

const ratio = PrometheusTasks.value(
  await PrometheusTasks.query((s) =>
    prod(s).query("sum(rate(errors[5m])) / sum(rate(requests[5m]))")
  ),
); // one number: a scalar, or a vector of exactly one float sample
const perJob = PrometheusTasks.samples(
  await PrometheusTasks.query((s) => prod(s).query("up")),
); // [{ metric, timestamp, value }, …]
const ready = await PrometheusTasks.ready(prod); // true / false (503)
```

- Results are typed unions on `resultType`; sample values are numbers (`NaN`,
  `±Infinity` kept); native histograms are typed; `warnings`/`infos` always
  present.
- `query`/`queryRange`/`series`/`labels` send a `POST` form by default
  (`.httpMethod("GET")` for a GET-only proxy).
- A refusal is `PrometheusApiError` (`status`, `errorType`, `detail`); no usable
  answer is `PrometheusRequestError`. Neither carries a credential.
- A URL sent any credential must be `https:` unless loopback
  (`ZUKE_ALLOW_INSECURE_URL` opts out); an unauthenticated in-cluster
  `http://prometheus.monitoring.svc:9090` is fine, and so is a plain
  `header("X-Scope-OrgID", …)` (only `Authorization`/`Proxy-Authorization`/
  `Cookie` and credential-looking names like `X-API-Key` count as credentials).
  Auth: `bearerToken`, `basicAuth`, `secretHeader` (API keys), or
  `credentials(fn)` — `fn` gets the exact outgoing request (method, URL,
  headers, body bytes) and the `readEnv`/`readTextFile`/`now`/`fetch` seams, and
  returns headers to add.
- Managed services, no cloud CLI: `.google((g) => …)` (Application Default
  Credentials — service-account key, gcloud login, workload identity federation,
  or the metadata server; `scopes`, `credentialsFile`, `quotaProject`),
  `.azure((a) => …)` (Entra ID — client secret, workload identity or managed
  identity from the `AZURE_*` env, or chosen with
  `clientSecret()`/`workloadIdentity()`/`managedIdentity()`), and `.sigv4((a) =>
  a.region(…))` (AWS SigV4 for `aps` — env keys, profile, web identity, ECS/EKS
  container endpoint, IMDSv2; put it last). Tokens are cached until shortly
  before expiry; errors never carry the secret.

## Canary releases — `@zuke/canary`

A component: `canary((c) => …)` assigned to a field stamps out the rollout's
targets under it. A **state store is required** — rolling back means knowing
what succeeded.

```ts
import { canary, httpProbe, prometheus } from "@zuke/canary";

class Deploy extends Build {
  rollout = canary((c) =>
    c.platform(myPlatform) // a CanaryPlatform: stage / expose / promote / abort
      .steps(10, 25, 50) // exposure after each step; promote is the 100 %
      .bake("10m") // .bakeStep(3, "30m") overrides one step
      .analysis(
        httpProbe((h) => h.url(HEALTH_URL).samples(30)),
        prometheus((p) => p.url(PROM).query(ERROR_RATIO).max(0.01)),
      )
      .approval("canary-approved").approvalTimeout("24h") // optional gate
      .lock((l) => l.lockKey("deploy", "api").withTtl("24h")) // holdForRun
    // .durable() — bakes suspend the run; `zuke resume --check` reopens them
  );
  ship = target().dependsOn(this.rollout.promote).executes(() => {});
}
```

- Targets: `rollout.stage`, `rollout.stepN.expose` / `.bake` / `.analyze`,
  `rollout.approve`, `rollout.promote` (an effect), `rollout.abort`. A step-free
  canary (a `"channel"` platform) gets one `rollout.soak` phase.
- **One rollback.** A failed analysis, a failed step, an approval timeout, and
  `zuke cancel` all run `abort`, with the state `stage` recorded — except a
  cancellation after `promote` finished (the release stays), and a rollout that
  lost the lock (it touches nothing). Inline bakes run the analyses every
  `.analysisInterval(...)` (default `"1m"`) through core's `.validateDuring`.
- `CanaryPlatform` contract: `expose` is absolute and returns the exposure
  achieved; `promote` / `abort` are idempotent; `ctx.state` is shared by every
  call (never a secret in it). `zuke rollout.abort` **by hand** is a fresh run
  with empty state, so `abort` must work from its own configuration; use `zuke
  cancel <run-id>` for a rollout still running or parked. `ctx.reason` tells
  `abort` why it runs: fall back to a configured stable version only for
  `"hand-run"` — a `"rollback"` with empty state means nothing was staged.
- Analyses are any `Validation`; a canary-aware one reads `ctx.step`,
  `ctx.requested`, `ctx.exposure`. See
  [`docs/canary.md`](https://github.com/zuke-build/zuke/blob/master/docs/canary.md).
- A managed Prometheus: `prometheus((p) => p.url(AMP).query(Q).max(0.01)
  .connection((c) => c.sigv4((a) => a.region("us-east-1"))))` — `connection`
  takes `@zuke/prometheus`'s settings (`google()`, `azure()`, `sigv4()`, …).
- **CloudWatch analysis:** `.analysis(cloudwatch((m) => m.name("canary
  5xx").namespace("AWS/ApplicationELB")
  .metricName("HTTPCode_Target_5XX_Count").dimension("TargetGroup",
  tg).stat("Sum") .window("5m").max(5).missingDataAs(0).aws((a) =>
  a.region("eu-west-1"))))` from `@zuke/aws` — fails when any datapoint in the
  window is out of bounds (each covers `.period(seconds)`, default 60), or on no
  data unless `.missingDataAs(...)`; `.metricStat(id, …)` +
  `.expression("100*e/r")` judges metric math.
- **Azure Monitor analysis:** `.analysis(azureMonitor((m) => m.name("canary
  failures").resource(appInsightsId)
  .metric("requests/failed").aggregation("Count").dimension("cloud/roleName",
  "api-canary") .window("5m").max(5).missingDataAs(0).az((a) =>
  a.subscription("prod"))))` from `@zuke/az` — fails when any datapoint in the
  window is out of bounds (each covers `.interval(...)`, default `PT1M`; the
  window may not be shorter), on no data unless `.missingDataAs(...)`, or when a
  dimension-filtered answer reached `.top(n)` (default 10); `.kql(workspace,
  query)` judges a Log Analytics query that returns one number instead.
- **Cloud Run:** `c.platform(cloudRunCanary((r) => r.service("api")
  .region("europe-west1").image(this.image.value).gcloud((g) => g.project(p))))`
  from `@zuke/gcloud`. It routes traffic through the candidate's tag
  (`.tag(...)`, default `canary`) in whole percents; `promote` refuses a
  revision deployed mid-rollout; a hand-run `abort` needs
  `.stable("<revision>")` to know where to send traffic, and refuses without it.
- **Cloud Monitoring analysis:** `.analysis(cloudMonitoring((m) =>
  m.name("canary 5xx").project(p)
  .metricType("run.googleapis.com/request_count").resourceType("cloud_run_revision")
  .cloudRunCandidate("api", "europe-west1").metricLabel("response_code_class",
  "5xx")
  .alignmentPeriod("60s").perSeriesAligner("ALIGN_SUM").crossSeriesReducer("REDUCE_SUM")
  .window("5m").max(5).missingDataAs(0)))` from `@zuke/gcloud` — fails when any
  aligned point in the window is out of bounds (the window may not be shorter
  than the alignment period, and ends `.delay(...)` before now, default 2m), on
  no data unless `.missingDataAs(...)` — which then passes a candidate with no
  traffic too — or when there are more pages than `.maxPages(n)`; a `CUMULATIVE`
  metric needs `ALIGN_DELTA` or `ALIGN_RATE`; `.cloudRunCandidate(service,
  region)` narrows it to the revision `cloudRunCanary` staged, in the analysis's
  project; `.logEntries((l) => …)` judges a log-entry count instead.
- **Kubernetes canary** — `kubectlCanary((k) =>
  k.stable("api").canary("api-canary").container("api").image(img).replicas(10))`
  from `@zuke/kubectl` is a `"replicas"` platform for `canary(...)`: two
  Deployments behind one Service, canary grown and ready before stable shrinks.
  Hand-run `rollout.abort` needs `.stableImage(...)`.
- **Helm canary** — `helmCanary((h) =>
  h.chart("./charts/api").stableRelease("api").image(tag).replicas(10).values("values-prod.yaml"))`
  (`@zuke/helm`, Helm 3.14+) — two releases, exposure by replica share
  (`"replicas"`); abort is `helm rollback` to the revision `stage` recorded, or
  `.stableRevision(n)` by hand. The chart's Service must select both releases'
  pods, and `.values()` must carry the stable release's whole config.
- **Canary on Docker Compose:** `dockerComposeCanary((d) =>
  d.service("app").canaryService("app-canary").replicas(4).image(img).stableImageVariable("APP_IMAGE").canaryImageVariable("APP_CANARY_IMAGE").stable(prev))`
  from `@zuke/docker-compose`, for `c.platform(...)`. Exposure is replicas
  (quantised). Promote is an env override: persist `APP_IMAGE` afterwards or a
  plain `docker compose up` reverts it.
- **Lambda canary** — `lambdaCanary((l) =>
  l.functionName("api").alias("live").zipFile(zip).aws((a) =>
  a.profile("deploy").region("eu-west-1")))` from `@zuke/aws` — the alias's
  weighted routing (`"traffic"`): `stage` publishes the candidate
  (`update-function-code --publish` from `.zipFile`, `.s3Bucket().s3Key()` or
  `.imageUri`; or `.version("12")` for one already published), waits for it to
  be `Active`, and leaves the alias alone; `expose` sets the candidate's
  `AdditionalVersionWeights`; `promote` moves the alias to it. The alias must
  point at a published version and not already split; every `update-alias`
  carries `--revision-id`; each call checks the alias's ARN (account and
  region), and expose/promote the candidate's code hash. A code source becomes
  `$LATEST` at stage and stays there after a rollback — use `.version(...)` if
  anything invokes the function unqualified. Hand-run `rollout.abort` needs
  `.stable("<version>")`.
- **Container Apps canary** — `containerAppCanary((a) =>
  a.name("api").resourceGroup("rg-prod").image(img).az((z) =>
  z.subscription("prod")))` from `@zuke/az` — the app's ingress traffic split by
  revision name (`"traffic"`, whole percents): `stage` pins the traffic to the
  serving revision by name, deploys the image with `containerapp update`
  (optionally `.containerName(...)`, `.revisionSuffix(...)`), and checks the new
  revision is `Provisioned`; `expose` sets `ingress traffic set
  --revision-weight`; `promote` hands the traffic to the candidate, back through
  "latest" if it followed it before. The app must be in multiple-revision mode
  with ingress, serving one revision without labels. Each call checks the app's
  resource id (the subscription), and expose/promote that the traffic still goes
  only to the two revisions. Hand-run `rollout.abort` needs
  `.stable("<revision>")`.

## Homebrew taps — `@zuke/homebrew`

Ship a prebuilt binary (e.g. a `deno compile` output) through a tap. Every value
is validated and Ruby-escaped, so the formula holds only literals.

```ts
import { HomebrewTasks } from "@zuke/homebrew";

const ruby = HomebrewTasks.formula((s) =>
  s.name("app").description("Command-line tool for widgets") // brew audit rules
    .homepage("https://example.com").license("MIT") // .version() only if the URL lacks it
    .binary((b) => b.os("macos").arch("arm").url(macArmUrl).sha256(macArmSha))
    .binary((b) => b.os("linux").arch("intel").url(linuxUrl).sha256(linuxSha))
    .install("app")
    .test((t) => t.command("--version").expectVersion())
); // on_macos/on_linux, on_arm/on_intel — fixed order, deterministic

const result = await HomebrewTasks.publish((s) =>
  s.tap("acme/tap") // or "acme/homebrew-tap" — same repository
    .formula("app", ruby).token(this.tapToken.value).message("app 1.2.3")
); // result.state: "created" | "updated" | "unchanged" (no commit)

// A target that installs it the way a user would, then removes it:
verifyFormula = target().executes(() =>
  HomebrewTasks.verify((s) => s.formulaFile("dist/app.rb").name("app"))
);
// …and its CI job, a macos-latest + ubuntu-latest matrix:
release = cicd({
  invokes: [HomebrewTasks.verifyJob((s) => s.target(this.verifyFormula))],
});
```

- `publish` goes through `GhTasks.createOrUpdateFile` (one GitHub transport);
  the token needs `contents: write` on the tap. The repository is always the tap
  — `GITHUB_REPOSITORY` is never used.
- `verify` copies the file into a `brew tap-new --no-git` tap and installs
  `<tap>/<name>`, because current Homebrew refuses formula files outside a tap.
  The uninstall and `untap --force` always run. On a GitHub Linux runner brew is
  off `PATH`; `verifyJob` adds it, or pass `.toolPath(...)`.
- `formula` needs a `test` block for `verify` (`brew test` fails without one).

## Chocolatey packages — `@zuke/chocolatey`

Ship a prebuilt Windows binary (a zip on a release) through Chocolatey. Every
nuspec value is XML-escaped and every script value PowerShell-quoted, so the
package holds only literals.

```ts
import { ChocolateyTasks } from "@zuke/chocolatey";

const pkg = ChocolateyTasks.package((s) =>
  s.id("app").version("1.2.3").authors("Acme") // id: lowercase, NuGet version
    .projectUrl("https://example.com").licenseUrl("https://example.com/LICENSE")
    .description("Command-line tool that builds and ships widgets") // 30-4000
    .tags("cli", "widgets")
    .url64bit(winZipUrl).checksum64(winZipSha) // https + 64 hex digits
); // pkg.files: { "app.nuspec", "tools/chocolateyinstall.ps1" } — deterministic

// A target that installs it the way a user would, then removes it:
verifyPackage = target().executes(() =>
  ChocolateyTasks.verify((s) =>
    s.package(pkg).binary("app").command("--version").expectVersion()
  )
);
// …and its CI job, a windows-latest matrix:
release = cicd({
  invokes: [ChocolateyTasks.verifyJob((s) => s.target(this.verifyPackage))],
});

await ChocolateyTasks.publish((s) =>
  s.package(pkg).apiKey(this.chocoApiKey.value) // default https://push.chocolatey.org/
); // { source, nupkg: "app.1.2.3.nupkg" }
```

- The zip is unpacked into the package's `tools`, where choco shims every
  `.exe`; uninstall removes both, so no `chocolateyuninstall.ps1` is rendered.
- `verify` packs in a temp directory, installs with `--source=<dir>
  --version=<v> --yes --force`, runs the shim, then always uninstalls and
  removes the directory (a cleanup error never hides the real one).
- choco takes the key only as `--api-key=` (or a key saved by
  `ChocoTasks.apikey((s) => s.add()…)`): it is masked in logs and errors but is
  in the process table during the push — on a shared host save it instead and
  leave `.apiKey` unset.

## Helpers from `@zuke/core`

- `glob(pattern, { cwd? })` — expand a glob to sorted paths.
- `assert(cond, msg?)`, `assertExists(v, msg?)`, `fail(msg)`,
  `assertFileExists(path)` — fail a target fast with a clear message.
- `httpDownload(url, dest)`, `httpText(url)`, `httpJson(url)` — fetch helpers
  that throw `HttpError` on non-2xx.
- `redactUrl(url)` / `redactUrls(text)` — strip `user:password@` and mask
  credential parameters (query and fragment; a value hiding one is masked whole)
  before a URL goes into a message or log; `redactUrls` does every URL in a
  message. Fails closed on unparseable input; secrets in the path are not
  recognised. `HttpError` already applies it. Run the build's secret redactor
  over the text first.
- `$` from `@zuke/core/shell` — injection-safe tagged-template shell, only when
  no typed wrapper fits.

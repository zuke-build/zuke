# @zuke/ai

AI code review as a target validation for
[Zuke](https://github.com/zuke-build/zuke#readme) builds. Define a reviewer
fluently — provider and API key are the only required options — and plug it into
a target with `.validateBefore(...)` / `.validateAfter(...)`. The reviewer
fetches the diff, asks the model for a structured assessment, prints the
findings, and **breaks the build** when the assessed risk crosses the threshold
you choose.

```ts
import { Build, parameter, run, target } from "jsr:@zuke/core";
import { securityReviewer } from "jsr:@zuke/ai";

class Pipeline extends Build {
  key = parameter("Anthropic API key").secret().required();

  // Provider + key is all that's required; everything else is defaulted.
  security = securityReviewer((r) =>
    r.provider("claude").apiKey(this.key).failWhen((g) => g.scoreAbove(7))
  );

  deploy = target()
    .validateBefore(this.security) // gate before deploying
    .executes(async () => {/* … */});
}

await run(Pipeline);
```

## Reviewers

`genericReviewer` (code quality / maintainability), `securityReviewer`,
`secretsReviewer`, `correctnessReviewer`, and `licenseReviewer` — all share the
same fluent `Reviewer` and return a `Validation`. Each has a built-in rubric in
its system prompt; `.criteria("…")` is optional fine-tuning that adds
project-specific notes (e.g. "strict TypeScript, no `any`") above the diff.

## Providers

`"claude"` (default model `claude-opus-4-8`), `"openai"`, and `"gemini"`. The
API key comes from a `parameter().secret()` (masked in CI) or a string. The
assessment JSON shape is enforced **server-side** via each provider's
structured-output mode (Claude `output_config.format`, OpenAI strict
`json_schema`, Gemini `responseSchema`), not merely requested in the prompt.

## Options (all optional, with defaults)

`.model(...)`, `.effort(...)`, `.diff((d) => d.base("origin/main"))`,
`.include(...)`/`.exclude(...)`, `.maxDiffTokens(n)`,
`.failWhen((g) => g.scoreAbove(7) / g.severityAtLeast("high"))`,
`.onError("fail" | "warn")`, `.retry({ attempts: 3 })`, `.skipIfKeyMissing()`,
`.comment()`, `.commentToken(...)`, `.quiet()`.

`.skipIfKeyMissing()` skips the review instead of failing when the API key is
absent — handy when the key is a CI-only secret — and announces the skip on the
console and in the job summary so the gap is visible rather than silent.

`.retry(...)` controls transient-failure retries (`HTTP 408/429/500/502/503/504`
and network errors) and a per-attempt timeout. The default is **on** — three
attempts with exponential backoff (1s, 2s, …), `Retry-After` honoured, and a 60s
timeout per attempt so a stuck connection can't hang the build. Pass
`{ attempts: 5 }` to retry more, `{ attempts: 1 }` to disable,
`{ timeoutMs: 0 }` to drop the timeout. Helps absorb provider hiccups — notably
Gemini's frequent 503 "model overloaded" responses.

Each review prints a **start line** echoing its settings (provider/model, gate)
and a **notice on every retry**, so a slow run reads as progress rather than a
hang. `.quiet()` suppresses all reviewer output.

## Pull-request comment (multi-host)

`.comment()` posts the assessment to the pull/merge request on whichever CI host
the build is running on — **GitHub Actions, GitLab CI, Azure Pipelines, or
Bitbucket Pipelines** — under a `🤖 Zuke AI review` header. It keeps **one
comment per reviewer up to date** across re-runs, matched by a hidden marker.

The token defaults to each host's conventional env var (`GITHUB_TOKEN`,
`GITLAB_TOKEN`, `SYSTEM_ACCESSTOKEN`, `BITBUCKET_TOKEN`); override with
`.commentToken(param | string)`. Outside a PR context (local runs, branch
pushes) the comment is skipped with a notice — a failed post never breaks the
build. On GitHub Actions, grant `pull-requests: write` in the workflow (or use
`aiReviewWorkflow(...)`, which does it for you).

## Token usage

When the provider's response carries token counts, the assessment footer reports
them — on the console (`tokens: 1234 in · 567 out · 1801 total`) and in the job
summary / PR comment (`**Tokens:** …`). Claude's total is derived from input +
output; OpenAI and Gemini report it directly. Only the counts a provider
actually returns are shown.

## Structured output (schema enforcement)

Asking the model for JSON in the prompt isn't enough — it can drift. Every
request also carries the assessment JSON **schema**, so the shape is enforced by
the provider's structured-output mode rather than merely requested:

- **Claude** — `output_config.format` with the JSON schema.
- **OpenAI** — `response_format: { type: "json_schema", strict: true }`.
- **Gemini** — `generationConfig.responseSchema`.

The prompt instruction stays as a backstop. Optional finding fields are nullable
in the strict schema; the parser treats `null` as "absent".

## GitHub Actions summary

When a review runs under GitHub Actions, it appends a Markdown section — score,
severity, and a findings table — to the job summary (`$GITHUB_STEP_SUMMARY`), so
the assessment shows up on the run page even when the gate passes. It writes on
gate failure too, just before breaking the build. `.quiet()` suppresses both the
console printout and the summary section.

See [Zuke](https://github.com/zuke-build/zuke#readme) and the
[AI review guide](https://github.com/zuke-build/zuke/blob/master/docs/ai-review.md)
for the full walkthrough.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/ai` — AI-powered code review for Zuke builds.

Define a reviewer fluently and plug it into a target as a {@link
"jsr:@zuke/core".Validation} with `.validateBefore(...)` / `.validateAfter(...)`.
Only the provider and API key are required; everything else is defaulted.

```ts
import { Build, parameter, target } from "jsr:@zuke/core";
import { securityReviewer } from "jsr:@zuke/ai";

class Pipeline extends Build {
  key = parameter("Anthropic API key").secret().required();
  security = securityReviewer((r) => r.provider("claude").apiKey(this.key));
  deploy = target().validateBefore(this.security).executes(async () => {});
}
```
@module

function agentFixer(run: AgentRunner, configure?: Configure<AgentFixer>): AgentFixer
  Construct an {@link AgentFixer} from an {@link AgentRunner} and apply the
  configuration lambda. Plug the result into a target with `.recoverWith(...)`.

function aiCache(configure?: Configure<AiCache>): AiCache
  Construct an {@link AiCache}, applying an optional configure lambda so it can
  be set up inline — e.g. `aiCache((c) => c.dir(".cache").ttl(3600))`.

function aiFixer(configure?: Configure<AiFixer>): AiFixer
  Construct an {@link AiFixer} and apply the configuration lambda. Plug the
  result into a target with `.recoverWith(...)`:

  ```ts
  test = target()
    .executes(() => DenoTasks.test((s) => s.allowAll()))
    .recoverWith(aiFixer((f) => f.provider("claude").apiKey(this.key)));
  ```

function aiReviewWorkflow(spec: AiReviewWorkflowSpec): CiFile
  Declare a generated AI-review workflow on the build. The returned
  {@link CiFile} is automatically discovered by `discoverCiFiles` and kept on
  disk by `syncCiFiles`. Default `host: "github"`; pass `"gitlab"` or
  `"azure"` to target those hosts.

  ```ts
  class Pipeline extends Build {
    openaiKey = parameter("OpenAI key").secret().env("OPENAI_API_KEY");
    review = securityReviewer((r) =>
      r.provider("openai").apiKey(this.openaiKey).comment()
    );
    reviewTarget = target().validateBefore(this.review).executes(() => {});
    ghWorkflow = aiReviewWorkflow({ reviewers: [this.review] });
    glWorkflow = aiReviewWorkflow({ host: "gitlab", reviewers: [this.review] });
  }
  ```

function budget(configure?: Configure<Budget>): Budget
  Construct a {@link Budget}, applying an optional configure lambda so caps can
  be set inline — e.g. `budget((b) => b.maxTokens(100_000).maxCost(1))`.

function correctnessReviewer(configure?: Configure<Reviewer>): Reviewer
  A reviewer that scores the diff for correctness bugs and regressions.

function findingFingerprint(assessment: AssessmentType, finding: AssessmentFinding): string
  A stable fingerprint for a finding: hash of the assessment kind, the
  normalised title (trimmed, lowercased, whitespace collapsed), and the file.
  Independent of line number so a finding keeps its id as code shifts.

function genericReviewer(configure?: Configure<Reviewer>): Reviewer
  A general-purpose reviewer scored on code quality and maintainability. Pair
  with `.criteria(...)` to add project-specific notes (idioms, conventions, a
  coding-style document); the built-in rubric is sufficient without them.

function licenseReviewer(configure?: Configure<Reviewer>): Reviewer
  A reviewer that scores the diff for license and compliance risk.

function secretsReviewer(configure?: Configure<Reviewer>): Reviewer
  A reviewer that scans the diff for leaked secrets and credentials.

function securityReviewer(configure?: Configure<Reviewer>): Reviewer
  A reviewer that scores the diff for security vulnerabilities.

function suppressions(configure?: Configure<Suppressions>): Suppressions
  Construct a {@link Suppressions}, applying an optional configure lambda so the
  file and inline fingerprints can be set inline — e.g.
  `suppressions((s) => s.file(".zuke/suppress.json").add("abc"))`.

class AgentFixer implements Remediation
  A fluent agent fixer. Construct one via {@link agentFixer} with a runner, and
  attach it to a target with `.recoverWith(...)`. Diagnose/report defaults are
  on; file changes happen through the agent, gated to local runs unless
  `.allowCI()`.

  constructor(run: AgentRunner)
  name: string
    A name for diagnostics — `"agent fix"`.
  allowCI(): this
    Permit the agent to run (and edit files) on CI; off by default.
  suggest(): this
    Propose the agent's changes as committable inline `suggestion`s on the
    pull request (from its `git diff`) instead of committing them. The build
    stays failed — the human applies the suggestions to fix it. Mutually
    exclusive with {@link commitFixes} (suggest takes precedence). GitHub only;
    elsewhere it falls back to the overview comment.
  commitFixes(): this
    After the agent runs, stage all its changes, commit, and push to the current
    branch so a healed PR carries the fix. Requires a checkout that can push; a
    failed push is reported, not fatal.
  commitMessage(message: string): this
    Override the commit subject used by {@link commitFixes}.
  noPush(): this
    Commit the fix but do not push it.
  comment(): this
    Also post what the agent did as a PR comment (on by default).
  noComment(): this
    Do not post a PR comment (the job summary is still written).
  commentToken(token: AnyParameter | string): this
    The token used to post the PR comment (defaults to the host's env var).
  criteria(criteria: string): this
    Project-specific notes appended to the agent's prompt.
  conventions(text: string): this
    Supply the project conventions text directly instead of reading
    `CLAUDE.md`/`AGENTS.md`. Pass an empty string to send none.
  quiet(): this
    Suppress the console printout (the summary/comment are still written).
  env(reader: EnvReader): this
    The environment reader used to detect CI and the comment host (test seam).
  exec(run: (argv: string[]) => Promise<string>): this
    The `git` runner used for committing (test seam).
  readFile(impl: (path: string) => Promise<string | undefined>): this
    The convention-file reader (test seam).
  fetch(impl: typeof fetch): this
    The `fetch` implementation used to post the PR comment (test seam).
  async remediate(context: RemediationContext): Promise<RemediationResult>
    Run the agent against the failure, optionally commit its changes, and ask
    the executor to re-run the target as the verifier. Skips (no retry) on CI
    unless {@link allowCI} is set, or if the agent run itself fails.

class AiCache
  A best-effort cache of AI provider responses, keyed by a {@link stableHash} of
  each call's salient parts and persisted through a {@link CacheStore} (the
  default writes JSON files under {@link AiCache.dir}). Configure it inline with
  {@link aiCache}: set the {@link AiCache.dir}, the {@link AiCache.ttl}, or
  {@link AiCache.disable} it entirely, then read with {@link AiCache.get_} and
  write with {@link AiCache.put_}.

  dir(path: string): this
    Directory for the default file store (default ".zuke/ai-cache").
  ttl(seconds: number): this
    Entries older than this many seconds are ignored (default 604800 = 7 days; 0 = never expire).
  disable(): this
    Turn the cache off programmatically ({@link get_} misses, {@link put_} is a no-op).
  store(custom: CacheStore): this
    Inject a custom backing store (test seam; overrides the file store).
  now(clock: () => number): this
    Clock seam for `createdAt` and TTL checks (default `Date.now`).
  enabled_(): boolean
    INTERNAL: whether the cache is active.
  key_(parts: string[]): string
    INTERNAL: derive a stable key from the given parts.
  async get_(key: string): Promise<CacheEntry | undefined>
    INTERNAL: fetch a live (non-expired) entry, or `undefined`.
  async put_(key: string, text: string, usage?: Usage): Promise<void>
    INTERNAL: store a response under `key`.

class AiFixer implements Remediation
  A fluent AI fixer. Construct one via {@link aiFixer}, configure it, and attach
  it to a target with `.recoverWith(...)`. Only `.provider(...)` and
  `.apiKey(...)` are required; everything else defaults.

  name: string
    A name for diagnostics — `"AI fix"`.
  provider(provider: Provider): this
    Set the model provider (required).
  apiKey(apiKey: AnyParameter | string): this
    Set the API key, from a secret parameter or a literal string (required).
  model(model: string): this
    Override the model (default: the provider's recommended model).
  effort(effort: Effort): this
    Set the thinking-effort hint (honoured by Claude; ignored elsewhere).
  criteria(criteria: string): this
    Project-specific notes appended to the prompt (idioms, constraints).
  conventions(text: string): this
    Supply the project conventions text directly, instead of letting the fixer
    read `CLAUDE.md`/`AGENTS.md`. Pass an empty string to send none.
  diff(configure: Configure<DiffSettings>): this
    Configure the diff source used for context (default: the working tree).
  include(...globs: string[]): this
    Only include diff sections matching these globs in the prompt context.
  exclude(...globs: string[]): this
    Exclude diff sections matching these globs from the prompt context.
  maxDiffTokens(tokens: number): this
    Cap the context diff at roughly this many tokens (default 16000).
  autoApply(): this
    Apply the proposed fix to the working tree and ask the executor to re-run
    the target. Off by default (the fixer only diagnoses). Writes are confined
    by {@link allowPaths}, the built-in exclusions, and {@link maxEdits}, and
    are refused on CI unless {@link allowCI} is set.
  allowPaths(...globs: string[]): this
    Restrict applied edits to paths matching these globs (default: all).
  excludePaths(...globs: string[]): this
    Exclude paths matching these globs from edits, on top of the built-ins.
  maxEdits(count: number): this
    Cap how many files a single applied fix may touch (default 10).
  allowCI(): this
    Permit auto-apply (and committing) on CI; off by default.
  commitFixes(): this
    After applying a fix, stage it, commit it, and push to the current branch —
    so a healed pull request carries the fix as a commit. Implies
    {@link autoApply}. Requires a checkout that can push (a non-detached branch
    with credentials); a failed push is reported, not fatal.
  commitMessage(message: string): this
    Override the commit subject used by {@link commitFixes}.
  noPush(): this
    Commit the fix but do not push it (leave it staged in a local commit).
  comment(): this
    Also post the diagnosis/fix as a PR comment (on by default).
  noComment(): this
    Do not post a PR comment (the job summary is still written).
  suggest(): this
    On GitHub, post each code location as an inline review comment with a
    committable `suggestion` block (the Copilot-style suggestion) instead
    of a single overview comment. On by default; a no-op off GitHub or when the
    model reports no specific locations, where the overview comment is used.
  noSuggest(): this
    Post a single overview comment instead of inline GitHub suggestions.
  commentToken(token: AnyParameter | string): this
    The token used to post the PR comment (defaults to the host's env var).
  retry(options: RetryOptions): this
    Retry the provider call on transient failures (see {@link RetryOptions}).
  quiet(): this
    Suppress the console printout (the summary/comment are still written).
  fetch(impl: typeof fetch): this
    The `fetch` implementation for the API call (test seam).
  exec(run: (argv: string[]) => Promise<string>): this
    The `git` runner used for the diff and commit (test seam).
  write(impl: (path: string, content: string) => Promise<void>): this
    The file writer used when applying edits (test seam).
  readFile(impl: (path: string) => Promise<string | undefined>): this
    The convention-file reader (test seam).
  env(reader: EnvReader): this
    The environment reader used to detect CI and the comment host (test seam).
  budget(budget: Budget): this
    Attach a shared {@link Budget} that caps token (and optionally USD) spend.
    Once the cap is reached the fixer skips the model call (and reports it)
    rather than running up the bill; share one budget across reviewers and
    fixers to bound a whole build's AI cost.
  cache(cache: AiCache): this
    Reuse a prior fix for an identical failure (same provider, model, and
    prompt) instead of calling the API again — see {@link AiCache}. Helpful when
    the same failure recurs across CI re-runs; a hit does not draw down the
    {@link budget}.
  async remediate(context: RemediationContext): Promise<RemediationResult>
    Diagnose the failure and, when permitted, apply (and commit) the fix. Always
    reports; returns `{ retry: true }` only when it changed the working tree so
    the executor re-runs the target as the verifier.

class AiReviewError extends Error
  Raised when a reviewer is misconfigured, the API fails, or the gate trips.

  constructor(message: string)
  override name: string

class Budget
  A running token and cost budget for AI provider calls. Build one with
  {@link budget}, set caps with the fluent setters, then fold each call's usage
  in with {@link Budget.record_} and gate further calls on
  {@link Budget.exhausted_}.

  maxTokens(total: number): this
    Cap total tokens (input + output across all recorded calls).
  maxCost(usd: number): this
    Cap estimated USD cost. Only takes effect for models you've priced via
    {@link prices} — no prices ship by default — so the estimate uses your own
    current rates. Pair it with {@link maxTokens} for a guaranteed hard cap.
  prices(table: Record<string, ModelPrice>): this
    Supply per-model prices (USD per 1,000,000 tokens, keyed by model id) so a
    {@link maxCost} cap and the cost estimate can be computed. Merges across
    calls. Nothing is priced until you call this — provider pricing changes too
    often to bake a table in, so the rates here are yours to keep current.
  exhausted_(): boolean
    INTERNAL: whether a configured cap has already been reached.
  record_(usage: Usage | undefined, model: string): void
    INTERNAL: fold one provider call's usage into the running totals.
  spend_(): BudgetSpend
    INTERNAL: a snapshot of consumption so far.
  remainingTokens_(): number | undefined
    INTERNAL: remaining tokens before the cap, or undefined when no token cap.
  describe_(): string
    INTERNAL: a one-line human summary, e.g. "1,234 tokens (~$0.01) of 10,000 / $1.00".

class DiffSettings
  Fluent diff source configuration passed to {@link "./reviewer.ts".Reviewer.diff}.

  base_?: string
  staged_: boolean
  text_?: string
  fetchRequested_: boolean
  fetchRemote_: string
  fetchBranch_?: string
  base(ref: string): this
    Review the diff against `ref` (e.g. `"origin/main"`).
  staged(): this
    Review the staged changes (`git diff --cached`).
  text(diff: string): this
    Review a diff supplied directly, bypassing `git` (useful in tests).
  fetchBase(branch?: string, remote: string): this
    Fetch the base branch (a shallow, tag-less `git fetch`) before diffing, and
    diff against it — so CI needs no manual `git fetch` step. With no `branch`,
    the base is auto-detected from the CI environment (GitHub's `GITHUB_BASE_REF`
    — the pull request's base branch). Honoured by the {@link
    "./fixer.ts".AiFixer}; if the fetch fails it falls back to the working-tree
    diff.
  argv_(): string[]
    The `git` argv this diff source resolves to.

class GateSettings
  Fluent gate configuration passed to {@link "./reviewer.ts".Reviewer.failWhen}.

  readonly rules_: GateRule[]
  scoreAbove(value: number): this
    Fail when the assessed risk score is strictly above `value` (0–10).
  severityAtLeast(value: Severity): this
    Fail when the overall severity is at least `value`.

class Reviewer implements Validation
  A fluent AI reviewer. Construct one via {@link securityReviewer} (and the
  sibling factories), configure it, and attach it to a target with
  `.validateBefore(...)` / `.validateAfter(...)`. `.provider(...)` and
  `.apiKey(...)` are required; everything else has a default.

  constructor(assessment: AssessmentType)
  name: string
    A name for diagnostics — `"<assessment> review"`.
  get provider_(): Provider | undefined
    The model provider, once `.provider(...)` has been called.
  get apiKey_(): AnyParameter | string | undefined
    The configured API key (a parameter — for its env var — or a literal).
  get commentEnabled_(): boolean
    Whether `.comment()` is set — i.e. this reviewer posts to the PR.
  get commentToken_(): AnyParameter | string | undefined
    The configured comment-posting token, if `.commentToken(...)` was called.
  provider(provider: Provider): this
    Set the model provider (required).
  apiKey(apiKey: AnyParameter | string): this
    Set the API key, from a secret parameter or a literal string (required).
  model(model: string): this
    Override the model (default: the provider's recommended model).
  effort(effort: Effort): this
    Set the thinking-effort hint (honoured by Claude; ignored elsewhere).
  criteria(criteria: string): this
    Optional project-specific notes appended above the diff in the user prompt
    — framing that fine-tunes the built-in rubric (e.g. "strict TypeScript,
    no `any`/`as`"). Works for every reviewer; the assessment's own system
    prompt already covers what to look for, so this is purely additive.
  diff(configure: Configure<DiffSettings>): this
    Configure the diff source (default: the working-tree diff, `git diff`).
  include(...globs: string[]): this
    Only review files matching these globs (default: all files).
  exclude(...globs: string[]): this
    Exclude files matching these globs (in addition to lockfiles).
  maxDiffTokens(tokens: number): this
    Cap the diff at roughly this many tokens, truncating the rest.
  failWhen(configure: Configure<GateSettings>): this
    Choose the gate that breaks the build (default: score above 7).
  onError(mode: "fail" | "warn"): this
    What to do when the review itself fails (API error, refusal, bad JSON):
    `"fail"` breaks the build (default), `"warn"` logs and passes.
  retry(options: RetryOptions): this
    Retry the provider call on transient failures (`HTTP 408/429/500/502/503/ 504` and network errors). The default is on — three attempts with
    exponential backoff and `Retry-After` honoured. Pass an object to override:
    `{ attempts: 5 }` to retry more, or `{ attempts: 1 }` to disable.
  skipIfKeyMissing(): this
    Skip the review (instead of failing) when the API key is missing — handy
    when the key is a CI-only secret. The skip is announced on the console and
    in the job summary so the gap is visible.
  comment(): this
    Also post the review to the pull/merge request as a comment. Works on
    every supported CI host — GitHub Actions, GitLab CI, Azure Pipelines,
    Bitbucket Pipelines — dispatched at runtime by {@link detectCiHost}. A
    single comment per reviewer is kept up to date across re-runs. A no-op
    outside a PR context (e.g. local runs). On each host the workflow must
    grant the right scope: GitHub `pull-requests: write`, GitLab a token with
    the `api` scope, Azure `System.AccessToken`, Bitbucket an app password.
  commentToken(token: AnyParameter | string): this
    The token used to post the PR/MR comment. Defaults to the active host's
    conventional env var: `GITHUB_TOKEN` (GitHub), `GITLAB_TOKEN` (GitLab),
    `SYSTEM_ACCESSTOKEN` (Azure), `BITBUCKET_TOKEN` (Bitbucket).
  githubToken(token: AnyParameter | string): this
    Backwards-compatible alias for {@link commentToken}.
  quiet(): this
    Suppress the findings printout and the job-summary section.
  fetch(impl: typeof fetch): this
    The `fetch` implementation for the API call (test seam).
  exec(run: (argv: string[]) => Promise<string>): this
    The `git` runner used to produce the diff (test seam).
  budget(budget: Budget): this
    Attach a shared {@link Budget} that caps token (and optionally USD) spend.
    Pass the same budget to several reviewers and a fixer to bound the whole
    build's AI cost: once the cap is reached, further reviews are skipped (not
    failed) with a note, rather than running up the bill.
  cache(cache: AiCache): this
    Reuse a prior model response for an identical review (same provider, model,
    and prompt) instead of calling the API again — see {@link AiCache}. A cache
    hit costs nothing and does not draw down the {@link budget}.
  suppress(suppressions: Suppressions): this
    Hide findings whose stable ID is in a {@link Suppressions} list — a learned
    set of dismissed false positives. Every finding is fingerprinted and its ID
    surfaced in the report, so dismissing one is a copy-paste into the list.
  async validate(context: ValidationContext): Promise<void>
    Run the review and gate the build. Throws an {@link AiReviewError} when the
    gate trips (or on a configuration/API error with `onError: "fail"`).

class Suppressions
  A file-backed set of suppressed finding fingerprints. The effective set is
  the union of the fingerprints read from {@link Suppressions.file} and any
  added inline with {@link Suppressions.add}; the reviewer drops a finding whose
  {@link findingFingerprint} is in that set.

  file(path: string): this
    Path of the JSON suppress list (default ".zuke/ai-suppress.json").
  add(...fingerprints: string[]): this
    Add fingerprints inline (in addition to any from the file).
  reader(read: (path: string) => Promise<string | undefined>): this
    Reader seam for the suppress file (default reads from disk, missing -> undefined).
  async load_(): Promise<Set<string>>
    INTERNAL: the effective set of suppressed fingerprints (file ∪ inline).

interface AgentContext
  The failure context handed to an {@link AgentRunner}, plus a ready prompt.

  target: string
    The name of the failed target.
  attempt: number
    The 1-based recovery attempt.
  command?: string
    The command line that failed, if known.
  output: string
    The captured error output (stderr, or the error message).
  conventions?: string
    Project conventions (CLAUDE.md / AGENTS.md), if found.
  prompt: string
    A ready-to-use prompt assembled from the fields above.

interface AiReviewWorkflowSpec
  What to generate — only `reviewers` is required.

  reviewers: readonly Reviewer[]
    The reviewers whose key env vars and `.comment()` setting drive the
    generated workflow. Each reviewer's `.apiKey(param)` parameter becomes an
    `env:` entry (or its host equivalent) that maps the secret in; any
    reviewer with `.comment()` causes the workflow to grant the right
    commenting scope and pass the host's token env var.
  host?: CiProvider
    The CI host the workflow targets. Defaults to `"github"`. Use `"gitlab"`,
    `"azure"`, or `"bitbucket"` to generate the equivalent for those hosts.
  target?: string
    The build target the workflow runs. Defaults to `"review"`.
  baseBranch?: string
    The base branch the diff is taken against (used by the GitHub workflow's
    fetch step). Defaults to `"master"`.
  path?: string
    Output path. Defaults to the host's conventional location.
  name?: string
    Workflow name shown in the host's UI. Defaults to `"AI Review"`.
  timeoutMinutes?: number
    Per-job timeout in minutes. Defaults to 15.

interface Assessment
  The structured result of a review.

  score: number
    Overall risk score, `0` (none) to `10` (severe).
  severity: Severity
    The overall severity.
  summary: string
    A one-line summary of the assessment.
  findings: AssessmentFinding[]
    The individual findings.

interface AssessmentFinding
  A single issue reported by the model.

  title: string
    A short title for the issue.
  severity: Severity
    The issue's severity.
  id?: string
    A stable fingerprint for the finding, assigned by the reviewer (see
    {@link "./suppress.ts".findingFingerprint}). Copy it into the suppress
    list to dismiss a recurring false positive.
  file?: string
    The file the issue is in, if the model attributed one.
  line?: number
    The line the issue is at, if the model attributed one.
  detail?: string
    A longer explanation, if provided.

interface BudgetSpend
  A snapshot of what a {@link Budget} has consumed so far.

  calls: number
    How many provider calls were recorded.
  inputTokens: number
    Total input (prompt) tokens across all recorded calls.
  outputTokens: number
    Total output (completion) tokens across all recorded calls.
  totalTokens: number
    Total tokens (input + output) across all recorded calls.
  cost?: number
    Estimated USD cost, when at least one recorded call had a known price.

interface CacheEntry
  A cached provider response.

  text: string
    The model's raw text response.
  usage?: Usage
    Token usage reported for the original call, if any.
  createdAt: number
    Epoch milliseconds when the entry was written (for TTL).

interface CacheStore
  A pluggable backing store for the cache (the default is file-backed).

  get(key: string): Promise<CacheEntry | undefined>
    Fetch the entry stored under `key`, or `undefined` when absent.
  set(key: string, entry: CacheEntry): Promise<void>
    Store `entry` under `key`, replacing any prior value.

interface FileEdit
  A whole-file edit: the complete new contents of one file.

  path: string
    Repository-relative path of the file to write.
  content: string
    The complete new contents of the file (not a patch).

interface Fix
  The structured result of a fix attempt.

  diagnosis: string
    A one-line explanation of what failed and why.
  rootCause: string
    The underlying root cause the fix addresses.
  confidence: Confidence
    The model's confidence that the edits resolve the failure.
  locations: FixLocation[]
    The specific code locations the fix targets, with verbatim source.
  edits: FileEdit[]
    The whole-file edits that, applied together, should fix the failure.

interface FixLocation
  A specific code location the fix targets: the exact offending source quoted
  verbatim, its file and line(s), and the suggested replacement. Rendered as a
  diff in the report so the comment shows real code, not just prose.

  file: string
    Repository-relative path of the file.
  line: number
    The 1-based line where the offending code starts.
  endLine?: number
    The 1-based line where it ends, when it spans more than one line.
  code: string
    The exact offending source line(s), quoted verbatim.
  suggestion?: string
    The suggested replacement for {@link code} (empty means delete it).

interface ModelPrice
  Per-model price in USD per 1,000,000 tokens.

  input: number
    USD per 1,000,000 input (prompt) tokens.
  output: number
    USD per 1,000,000 output (completion) tokens.

interface RetryInfo
  What happened before a retry, for {@link RetryOptions.onRetry}.

  attempt: number
    The attempt that just failed (1-based).
  attempts: number
    The total number of attempts that will be made.
  delayMs: number
    How long the helper will wait before the next attempt, in milliseconds.
  reason: string
    Why the attempt failed — e.g. `"HTTP 503"` or `"timed out after 60000ms"`.

interface RetryOptions
  Configurable knobs for {@link retryingFetch}.

  attempts?: number
    Total attempts (first try + retries). Defaults to {@link DEFAULT_ATTEMPTS}.
  baseDelayMs?: number
    Backoff for the first retry; doubles each subsequent retry.
  timeoutMs?: number
    Per-attempt timeout in milliseconds (default 60s). `0` disables it.
  onRetry?: (info: RetryInfo) => void
    Invoked before each retry, so a caller can report progress.
  sleep?: (ms: number) => Promise<void>
    Sleep seam — overridden in tests so retries don't take real time.

interface Usage
  Token counts a provider reported for a review call, when the response carries
  them. Each field is optional because not every provider reports every count.

  inputTokens?: number
    Tokens in the prompt / input.
  outputTokens?: number
    Tokens in the model's output / completion.
  totalTokens?: number
    Total tokens, reported by the provider or derived from input + output.

type AgentResult = CommandOutput | string | void
  What an {@link AgentRunner} may resolve to: a {@link CommandOutput} (its
  stdout is captured for the report), a string, or nothing.

type AgentRunner = (context: AgentContext) => Promise<AgentResult> | AgentResult
  Runs the coding agent against the assembled {@link AgentContext}. The agent is
  expected to edit files in place; the executor then re-runs the target. Throw
  (or let the underlying command throw) to signal the agent could not run.

type AssessmentType = "generic" | "security" | "secrets" | "correctness" | "license"
  The kind of review an assessment performs.

type Confidence = "low" | "medium" | "high"
  The model's confidence that a fix is correct.

type Effort = "low" | "medium" | "high" | "xhigh" | "max"
  The thinking-depth hint passed to providers that support it (Claude).

type Provider = "claude" | "openai" | "gemini"
  A supported model provider.

type Severity = "none" | "low" | "medium" | "high" | "critical"
  A severity level, ordered `none` < `low` < `medium` < `high` < `critical`.
````

</details>

<!-- ZUKE:API:END -->

# AI code review

[`@zuke/ai`](https://jsr.io/@zuke/ai) turns an LLM into a build gate: it reads
the diff, asks a model for a **structured assessment**, prints the findings,
writes them to the GitHub Actions job summary, and **breaks the build** when the
assessed risk crosses a threshold you choose. The model's output is constrained
to a typed shape, so the gate is a real verdict your build can branch on — not a
blob of prose.

## How it plugs in

A reviewer is a [`Validation`](./authoring.md#validations--validatebefore--validateafter):
an object with a `validate(ctx)` method. You build one fluently, then attach it
to a target with `.validateBefore(...)` (gate before the body) or
`.validateAfter(...)` (check after a successful body). The target decides _when_
it runs; the reviewer decides _what_ it checks.

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

## The reviewers

All share the same fluent `Reviewer` and return a `Validation`:

| Factory | Reviews for | Extra |
| --- | --- | --- |
| `securityReviewer` | security vulnerabilities | — |
| `secretsReviewer` | leaked secrets/credentials | — |
| `correctnessReviewer` | bugs and likely regressions | — |
| `licenseReviewer` | license / dependency-compliance risk | — |
| `genericReviewer` | code quality and maintainability | — |

## Providers and credentials

`.provider("claude" | "openai" | "gemini")` and `.apiKey(...)` are the only
required calls. The key is read from a `parameter().secret()` (so Zuke masks it
in CI output) or a literal string. Defaults: Claude `claude-opus-4-8`, plus a
sane default model for OpenAI and Gemini — override with `.model(...)`.

## Schema enforcement (why the gate is reliable)

The prompt tells the model the JSON shape, but a prompt can be ignored. So the
**schema is also sent on the request** and enforced by each provider's
structured-output mode:

- **Claude** → `output_config.format` (JSON schema).
- **OpenAI** → `response_format: { type: "json_schema", strict: true }`.
- **Gemini** → `generationConfig.responseSchema`.

The assessment is `{ score: 0–10, severity, summary, findings: [{ title,
severity, file?, line?, detail? }] }`. The strict dialect (OpenAI/Claude) makes
the optional fields nullable; the Gemini dialect drops `additionalProperties`
and uses `nullable`. Both map to the same parsed result.

## Choosing the gate

`.failWhen((g) => …)` picks what breaks the build (default: `scoreAbove(7)`):

- `g.scoreAbove(n)` — fail when the 0–10 risk score exceeds `n`.
- `g.severityAtLeast("high")` — fail on a severity floor.

`.onError("fail" | "warn")` decides what happens when the review _itself_ fails
(API error, refusal, unparsable response): `"fail"` (default) breaks the build
fail-closed; `"warn"` logs and passes.

`.skipIfKeyMissing()` handles the _absent key_ case separately: instead of
failing with "an API key is required", the review is skipped and the skip is
announced on the console and in the job summary. This keeps a reviewer that
relies on a CI-only secret from breaking local runs (or forks that receive no
secret), while still making the gap visible rather than silently passing.

## Surviving transient provider failures

Provider APIs routinely return short-lived `503 Service Unavailable` (model
overloaded — common on Gemini) and `429 Too Many Requests` (rate-limited). A
review that hits one of these would skip otherwise — even though a second
attempt seconds later would succeed.

`.retry(...)` wraps the provider call in **retry-with-exponential-backoff** on a
small allowlist of statuses that mean "try again shortly" (`408`, `429`, `500`,
`502`, `503`, `504`) plus thrown network errors (DNS, TCP, TLS). It honours a
server-supplied `Retry-After` header within a 30 s cap, and gives up on anything
non-retryable (a `401` config error, a refusal, bad JSON) without sleeping.
Defaults: **3 attempts** total, base backoff 1 s, doubling.

Each attempt is also bounded by a **per-attempt timeout** (default 60 s), so a
stuck connection can't hang the build forever — a timed-out attempt is aborted
and counts as a transient failure (so it's retried). Set `{ timeoutMs: 0 }` to
disable it.

### Progress output

So a slow run reads as work-in-progress rather than a hang, each review prints a
start line echoing its settings, and a notice on every retry:

```
[security review] reviewing "review" — openai/gpt-5.4-mini · gate score>8 · comment
[security review] attempt 1/3 failed (HTTP 503) — retrying in 1.0s
```

`.quiet()` suppresses both, along with the rest of the reviewer's output.

```ts
// On by default; override only when you want different behaviour.
securityReviewer((r) =>
  r.provider("gemini").apiKey(this.key)
    .retry({ attempts: 5 })          // more aggressive — five tries total
);

genericReviewer((r) =>
  r.provider("openai").apiKey(this.key)
    .retry({ attempts: 1 })          // disable retries
);
```

A retry exhausted-but-still-failing call surfaces through the usual `onError`
contract (`"fail"` breaks the build, `"warn"` logs and passes), so a stubborn
outage isn't a silent skip either.

## Scoping the diff and cost

- `.diff((d) => d.base("origin/main"))` reviews the diff against a ref;
  `.staged()` reviews staged changes; `.text("…")` injects a diff directly
  (handy in tests). The default is the working-tree diff (`git diff`).
- `.include(...)` / `.exclude(...)` filter files by glob (lockfiles are excluded
  by default).
- `.maxDiffTokens(n)` caps the diff so a huge change doesn't blow the budget.
- `.model("claude-haiku-4-5")` (or another cheap tier) and `.effort(...)` trade
  cost for depth.
- Cache the gate at the target level (`.cacheKey(headSha)`) so it doesn't re-run
  — or re-pay — when the diff is unchanged.
- `.budget(budget(...))` caps spend by an exact token count across all reviewers
  and fixers sharing it (a USD cap is opt-in, from prices you supply);
  `.cache(aiCache(...))` reuses a prior verdict for an identical review (same
  provider, model, and diff), with a 7-day default TTL — see
  [Caching → AI response cache](./caching.md#ai-response-cache). Once the budget
  is spent, the review is skipped (not failed) with a note. See
  [Cost controls and learning](./self-healing.md#cost-controls-and-learning).
- `.suppress(suppressions(...))` hides findings you've dismissed as false
  positives, matched by the stable ID shown next to each finding in the report. A
  suppressed finding is still listed (under "Suppressed (not gating)") so the
  dismissal is auditable — it mutes the gate, it never silently buries a finding.

  > **Migration:** the finding-fingerprint format was widened (32→64-bit), so
  > IDs recorded before that change no longer match. If previously dismissed
  > findings resurface, re-record them: copy the new ID shown in the report back
  > into your suppress file (default `.zuke/ai-suppress.json`).

## GitHub Actions summary

Under Actions, a review appends a Markdown section (score, severity, and a
findings table) to `$GITHUB_STEP_SUMMARY`, so the assessment appears on the run
page whether the gate passes or fails (it writes just before breaking the build
on a failure). `.quiet()` suppresses both the console output and the summary.

## Pull-request comment (multi-host)

`.comment()` additionally posts the assessment onto the pull/merge request,
under a **"🤖 Zuke AI review"** header linking back to the project. Rather than
adding a new comment every run, it **upserts a single comment per reviewer**:
the body carries a hidden marker (`<!-- zuke-ai-review:<name> -->`), so a
re-run finds its previous comment and edits it in place. Different reviewers
(e.g. a security and a secrets review) keep separate comments because the
marker includes the reviewer name.

Which API gets called is decided at runtime by [`detectCiHost()`](authoring.md):

| Host | API used | Default token env | Workflow scope to grant |
| --- | --- | --- | --- |
| **GitHub Actions** | issue/PR comments | `GITHUB_TOKEN` | `pull-requests: write` |
| **GitLab CI** | merge-request notes | `GITLAB_TOKEN` | personal/group token with `api` scope (the job token can't post notes) |
| **Azure Pipelines** | PR comment threads | `SYSTEM_ACCESSTOKEN` | `System.AccessToken` mapped into env |
| **Bitbucket Pipelines** | PR comments | `BITBUCKET_TOKEN` | app password or workspace access token |

Override the token explicitly with `.commentToken(param | string)` (or, for
backwards compatibility, the GitHub-only alias `.githubToken(...)`). Outside a
PR context (a local run, or a branch push rather than a PR/MR pipeline) the
review skips the comment with a notice — a failed post never breaks the build,
it's a best-effort side effect like the summary.

For GitHub Actions, the generator below also adds `pull-requests: write` to the
workflow permissions automatically when any reviewer has `.comment()` set.

## Token usage

If the provider's response reports token counts, the review prints them as a
footer — `tokens: 1234 in · 567 out · 1801 total` on the console, and a
`**Tokens:** …` line in the summary and PR comment. The counts are read from each
provider's own shape (Claude `usage.input_tokens` / `output_tokens`, OpenAI
`usage.*_tokens`, Gemini `usageMetadata.*TokenCount`); the total is taken
verbatim when present, or derived from input + output (Claude) otherwise. Only
the counts a provider actually returns are shown, so this is purely
informational — it never affects the gate.

## Generating the workflow

Maintaining `.github/workflows/ai-review.yml` by hand is a chore — it has to
stay in sync with every reviewer's secret env var, with `pull-requests: write`
when any reviewer uses `.comment()`, with the right harden-runner +
checkout pins, with the fork-gating `if`. `aiReviewWorkflow({...})` does it for
you: declare it on the build and Zuke writes a [`CiFile`](authoring.md#cicd)
that the standard `cicd` sync keeps current.

```ts
import { aiReviewWorkflow, securityReviewer } from "jsr:@zuke/ai";

class Pipeline extends Build {
  openaiKey = parameter("OpenAI key").secret().env("OPENAI_API_KEY");
  security = securityReviewer((r) =>
    r.provider("openai").apiKey(this.openaiKey).comment()
  );
  review = target().validateBefore(this.security).executes(() => {});

  // Generates `.github/workflows/ai-review.yml` from the reviewers above —
  // wires their API-key env vars in, grants `pull-requests: write` and passes
  // `GITHUB_TOKEN` when any reviewer uses `.comment()`, fork-gates the job.
  reviewWorkflow = aiReviewWorkflow({ reviewers: [this.security] });
}
```

Override what you need: `target` (default `"review"`), `baseBranch` (default
`"master"`), `name`, `path`, `timeoutMinutes`. A reviewer that uses
`.commentToken(param)` swaps its parameter's env var in for the host's default
token; a reviewer constructed with a literal-string `.apiKey("…")` is skipped
from the workflow env (the generator can't infer a secret name).

### Multi-host

`host` defaults to `"github"`; pass `"gitlab"`, `"azure"`, or `"bitbucket"` to
generate the equivalent for those providers — matching the cross-platform PR
commenting above. Output shape per host:

| `host` | Default path | What's generated |
| --- | --- | --- |
| `"github"` | `.github/workflows/ai-review.yml` | Full workflow — fork-gated, harden-runner + pinned checkout, base-branch fetch, `pull-requests: write` if any reviewer comments. |
| `"gitlab"` | `.gitlab/ai-review.gitlab-ci.yml` | Merge-request-only job snippet on `denoland/deno:latest`. **Include from your `.gitlab-ci.yml`** (`include: { local: '.gitlab/ai-review.gitlab-ci.yml' }`). GitLab project-level CI variables flow into the job automatically — no `variables:` block emitted. |
| `"azure"` | `pipelines/ai-review.azure-pipelines.yml` | PR-only job snippet. Each reviewer's secret is wired into the script step's `env:` block as `$(NAME)` (Azure doesn't expose pipeline secrets as env vars by default); `SYSTEM_ACCESSTOKEN` is added when any reviewer uses `.comment()`. **Use as a template** from your main pipeline. |
| `"bitbucket"` | `bitbucket-pipelines.yml` | Pull-request-only step on `denoland/deno:latest`, written to the repo-root pipelines file Bitbucket expects (it has no `include` mechanism). Repository variables flow into the step automatically — no env block emitted; map your secrets as **secured** repository variables. |

```ts
// Declare one per host you care about — they share the same reviewers.
ghReview = aiReviewWorkflow({ reviewers: [this.security] });
glReview = aiReviewWorkflow({ host: "gitlab", reviewers: [this.security] });
azReview = aiReviewWorkflow({ host: "azure", reviewers: [this.security] });
bbReview = aiReviewWorkflow({ host: "bitbucket", reviewers: [this.security] });
```

## Worked example: Zuke reviews itself

Zuke's own build gates the `review` target with **two reviewers on different
providers** on every internal PR — an OpenAI security scan and a Gemini
code-quality review — to show how providers compose. In [`zuke.ts`](../zuke.ts):

```ts
openaiKey = parameter("OpenAI API key for the AI security review")
  .secret()
  .env("OPENAI_API_KEY");

securityReview = securityReviewer((r) =>
  r.provider("openai") // default model: gpt-5.4-mini
    .apiKey(this.openaiKey)
    .skipIfKeyMissing() // skip + announce when the key is absent (local runs)
    .comment() // upsert the assessment onto the PR (uses GITHUB_TOKEN)
    .diff((d) => d.base(Deno.env.get("ZUKE_REVIEW_BASE") ?? "origin/master"))
    .maxDiffTokens(20000)
    .failWhen((g) => g.scoreAbove(8))
    .onError("warn")
);

geminiKey = parameter("Gemini API key for the AI code-quality review")
  .secret()
  .env("GEMINI_API_KEY");

generalReview = genericReviewer((r) =>
  r.provider("gemini")
    .apiKey(this.geminiKey)
    .skipIfKeyMissing()
    .comment() // a separate PR comment, keyed by the reviewer name
    // The built-in rubric covers code quality/maintainability already;
    // `.criteria(...)` is optional fine-tuning with project-specific notes.
    .criteria("Strict TypeScript on Deno: no `any`, no `as`; task-shaped API.")
    .diff((d) => d.base(Deno.env.get("ZUKE_REVIEW_BASE") ?? "origin/master"))
    .maxDiffTokens(20000)
    .failWhen((g) => g.scoreAbove(8))
    .onError("warn")
);

review = target()
  .validateBefore(this.securityReview, this.generalReview)
  .executes(() => {});
```

`.validateBefore(...)` takes both reviewers, so each runs before the (empty)
body and gates the target independently. Because the PR comment is keyed by the
reviewer name, the two land as **separate comments** ("security review" and
"generic review") rather than overwriting each other.

`.skipIfKeyMissing()` replaces an `.onlyWhen(() => this.openaiKey.isSet_())`
gate on the target: rather than the target vanishing silently when a key is
absent, the reviewer runs, sees no key, and prints a "skipped — no API key"
line (and a matching job-summary note). The
[`ai-review.yml`](../.github/workflows/ai-review.yml) workflow runs
`./zuke review` on pull requests (non-fork only, so the secrets are never
exposed to untrusted code), passing `OPENAI_API_KEY`, `GEMINI_API_KEY`, the
`GITHUB_TOKEN` (for the comments), and a `ZUKE_REVIEW_BASE` to diff against.
Each assessment lands in that run's job summary and as an upserted PR comment.

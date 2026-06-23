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

if (import.meta.main) await run(Pipeline);
```

## The reviewers

All share the same fluent `Reviewer` and return a `Validation`:

| Factory | Reviews for | Extra |
| --- | --- | --- |
| `securityReviewer` | security vulnerabilities | — |
| `secretsReviewer` | leaked secrets/credentials | — |
| `correctnessReviewer` | bugs and likely regressions | — |
| `licenseReviewer` | license / dependency-compliance risk | — |
| `genericReviewer` | whatever you describe | requires `.criteria("…")` |

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

## GitHub Actions summary

Under Actions, a review appends a Markdown section (score, severity, and a
findings table) to `$GITHUB_STEP_SUMMARY`, so the assessment appears on the run
page whether the gate passes or fails (it writes just before breaking the build
on a failure). `.quiet()` suppresses both the console output and the summary.

## Pull-request comment

`.comment()` additionally posts the assessment onto the pull request. Rather than
adding a new comment every run, it **upserts a single comment per reviewer**: the
body carries a hidden marker (`<!-- zuke-ai-review:<name> -->`), so a re-run finds
its previous comment and edits it in place. Different reviewers (e.g. a security
and a secrets review) keep separate comments because the marker includes the
reviewer name.

It uses a token with `pull-requests: write` — the workflow's `GITHUB_TOKEN` by
default, or one you pass with `.githubToken(param | string)`. Outside a GitHub PR
context (no `GITHUB_REPOSITORY` / `refs/pull/<n>/merge` ref, e.g. a local run) it
logs a notice and does nothing. A failed post never breaks the build — it is a
best-effort side effect, like the summary. The workflow must grant the scope:

```yaml
permissions:
  contents: read
  pull-requests: write
```

## Token usage

If the provider's response reports token counts, the review prints them as a
footer — `tokens: 1234 in · 567 out · 1801 total` on the console, and a
`**Tokens:** …` line in the summary and PR comment. The counts are read from each
provider's own shape (Claude `usage.input_tokens` / `output_tokens`, OpenAI
`usage.*_tokens`, Gemini `usageMetadata.*TokenCount`); the total is taken
verbatim when present, or derived from input + output (Claude) otherwise. Only
the counts a provider actually returns are shown, so this is purely
informational — it never affects the gate.

## Worked example: Zuke reviews itself

Zuke's own build runs a security review on every internal PR. In
[`zuke.ts`](../zuke.ts):

```ts
openaiKey = parameter("OpenAI API key for the AI security review")
  .secret()
  .env("OPENAI_API_KEY");

securityReview = securityReviewer((r) =>
  r.provider("openai")
    .apiKey(this.openaiKey)
    .skipIfKeyMissing() // skip + announce when the key is absent (local runs)
    .comment() // upsert the assessment onto the PR (uses GITHUB_TOKEN)
    .diff((d) => d.base(Deno.env.get("ZUKE_REVIEW_BASE") ?? "origin/master"))
    .maxDiffTokens(20000)
    .failWhen((g) => g.scoreAbove(8))
    .onError("warn")
);

review = target()
  .validateBefore(this.securityReview)
  .executes(() => {});
```

`.skipIfKeyMissing()` replaces an `.onlyWhen(() => this.openaiKey.isSet_())`
gate on the target: rather than the target vanishing silently when the key is
absent, the reviewer runs, sees no key, and prints a "skipped — no API key"
line (and a matching job-summary note). The
[`ai-review.yml`](../.github/workflows/ai-review.yml) workflow runs
`./zuke review` on pull requests (non-fork only, so the secret is never exposed
to untrusted code), passing `OPENAI_API_KEY`, the `GITHUB_TOKEN` (for the
comment), and a `ZUKE_REVIEW_BASE` to diff against. The assessment lands in that
run's job summary and as an upserted comment on the PR.

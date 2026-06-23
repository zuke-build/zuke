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

if (import.meta.main) await run(Pipeline);
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
`.comment()`, `.githubToken(...)`, `.quiet()`.

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

## Pull-request comment

`.comment()` also posts the assessment to the pull request (GitHub Actions),
under a **"🤖 Zuke AI review"** header that links back to the project. It keeps
**one comment per reviewer up to date** across re-runs — matched by a hidden
marker, so a new push edits the comment in place instead of piling up. It needs
a token with `pull-requests: write` (the workflow `GITHUB_TOKEN` by default, or
`.githubToken(...)`), and is a no-op outside a GitHub PR context (e.g. local
runs). The grant in the workflow:

```yaml
permissions:
  contents: read
  pull-requests: write
```

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

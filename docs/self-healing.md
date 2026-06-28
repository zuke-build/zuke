# Self-healing builds

When a target fails, Zuke can hand the failure to an **AI fixer** that diagnoses
it, proposes (or applies) a fix, and lets the build re-run the real command to
verify. [`@zuke/ai`](https://jsr.io/@zuke/ai)'s `aiFixer` is built on a small
core primitive — `recoverWith` — so the loop is part of the typed build graph,
not a bolt-on script.

Unlike a standalone tool, the fixer has the one thing that makes a good fix
possible: the **exact command that failed, its captured `stderr`, and the diff
around it**. The real build command is the verifier — a fix only "heals" when
the command actually goes green.

## The `recoverWith` primitive

A [`Remediation`](./authoring.md) is the failure-time sibling of a `Validation`:
an object with a `remediate(ctx)` method that runs **only after the target body
fails**. It receives the failure and returns whether the body should be re-run.

```ts
import { Build, run, target } from "jsr:@zuke/core";
import { DenoTasks } from "jsr:@zuke/deno";
import { aiFixer } from "jsr:@zuke/ai";

class CI extends Build {
  key = parameter("OpenAI API key").secret().required();

  test = target()
    .executes(() => DenoTasks.test((s) => s.allowAll()))
    .recoverWith(aiFixer((f) => f.provider("openai").apiKey(this.key)))
    .recoverAttempts(2); // up to two fix-then-rerun cycles (default 1)
}

await run(CI);
```

- `.recoverWith(...r)` attaches one or more remediations; the first to ask for a
  retry re-runs the body.
- `.recoverAttempts(n)` bounds how many fix-then-rerun cycles are tried.
- A remediation that throws is treated as "could not heal" — it **never masks
  the original build failure**.

Any object with a `remediate` method qualifies, so `recoverWith` is not
AI-specific (a deterministic "run `deno fmt`, then retry" remediation is valid).

### Per-target or global

Attach a fixer to one target with `.recoverWith(...)`, or override
`recoverWith()` on the **build** to apply it to **every** target at once — both
styles compose, with a target's own remediations running before the build-level
ones:

```ts
class CI extends Build {
  key = parameter("OpenAI API key").secret();

  // Applies to every target below, no per-target wiring needed.
  override recoverWith() {
    return [aiFixer((f) => f.provider("openai").apiKey(this.key))];
  }

  lint = target().executes(() => DenoTasks.lint());
  test = target().executes(() => DenoTasks.test((s) => s.allowAll()));
}
```

## `aiFixer` — safe by default

With only a provider and key, `aiFixer` is **diagnose-only**: it sends the
failed command, its output, the diff, and your project conventions (`CLAUDE.md`
/ `AGENTS.md`) to the model, parses a **structured fix**, and reports — without
touching any files. The diagnosis lands in the GitHub Actions job summary and on
the pull request.

```ts
test = target()
  .executes(() => DenoTasks.test((s) => s.allowAll()))
  .recoverWith(aiFixer((f) => f.provider("openai").apiKey(this.key)));
```

### Copilot-style inline suggestions

When the fix is **only proposed** (diagnose-only — the default), the fixer posts
each problem on GitHub as an **inline review comment with a committable
`suggestion` block**, anchored to the exact `file:line`, deduplicated across
re-runs, and skipped gracefully if a line isn't in the diff. The structured fix
carries per-problem locations (file, line, the verbatim offending code, and the
replacement), so the comment shows real code, not prose.

When the fix is **applied** (`.autoApply()`), a committable suggestion would be
contradictory — the change is already made — so the fixer posts a **single
overview comment showing what it fixed (with the code diff)** instead. Off
GitHub, or when the model reports no specific locations, it also falls back to
the overview comment. Use `.noSuggest()` to force the overview comment even in
diagnose mode.

### Applying and committing fixes

Escalate from diagnosis to action, behind explicit guards:

```ts
aiFixer((f) =>
  f.provider("openai").apiKey(this.key)
    .autoApply() // write the fix to the working tree
    .allowPaths("packages/**", "src/**") // allowlist; lockfiles/.git/workflows excluded
    .maxEdits(5) // blast-radius cap
    .allowCI() // default is local-only; opt in for CI
    .commitFixes() // stage, commit, and push to the PR branch
);
```

| Setting                             | Effect                                                                                                            |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `.autoApply()`                      | Write the proposed fix to the working tree and re-run the target. Off by default.                                 |
| `.allowPaths(...globs)`             | Restrict applied edits to matching paths (lockfiles, `.git`, CI workflows, and key material are always excluded). |
| `.maxEdits(n)`                      | Cap how many files one fix may touch.                                                                             |
| `.allowCI()`                        | Permit auto-apply/commit on CI (local-only by default).                                                           |
| `.commitFixes()`                    | Stage, commit, and push the fix so a healed PR carries it. Implies `.autoApply()`.                                |
| `.noPush()` / `.commitMessage(...)` | Tune the commit.                                                                                                  |

A fix is **never auto-committed** unless you opt in, and the post-apply re-run
is always the gate: a bad edit fails the build instead of landing silently.

## Delegating to a coding agent — `agentFixer`

`aiFixer` makes one structured API call and applies the edits itself. For
open-ended failures, `agentFixer` instead hands the failure to a **coding agent**
you inject — Claude Code, Codex, or the Gemini CLI — which reads and edits files
autonomously; the executor then re-runs the target to verify. There's one
generic fixer, not one per agent: you pick the agent at the call site.

```ts
import { agentFixer } from "jsr:@zuke/ai";
import { ClaudeTasks } from "jsr:@zuke/claude";

test = target()
  .executes(() => DenoTasks.test((s) => s.allowAll()))
  .recoverWith(
    agentFixer((ctx) =>
      // ctx.prompt is assembled from the failure; ctx also has the raw
      // target/command/output if you'd rather build your own.
      ClaudeTasks.run((s) => s.prompt(ctx.prompt).permissionMode("acceptEdits"))
    ),
  );
```

Any runner that takes the context and returns works — `CodexTasks.exec`,
`GeminiTasks.run`, or a custom function. Because the agent edits files directly,
`agentFixer` is **gated to local runs by default** (`.allowCI()` to opt in). It
reuses the same `.comment()` / `.commentToken()` / `.criteria()` /
`.conventions()` knobs as `aiFixer`, and mirrors the same propose-vs-apply rule:

- **`.suggest()` (propose)** — render the agent's `git diff` as **committable
  inline suggestions** on the PR and leave the build failed for the human to
  apply. Suggestions only ever appear in this not-auto-fixing mode.
- **`.commitFixes()` (apply)** — stage *all* of the agent's changes, commit, and
  push (no commit if it changed nothing), then re-run the target to verify, and
  post an **overview comment** of what it did. Takes precedence over `.suggest()`.

## Diff context without a CI step

For good diagnoses the fixer wants the PR diff. `.diff((d) => d.fetchBase())`
makes the fixer **fetch the base branch itself** — auto-detected from the CI
environment (GitHub's `GITHUB_BASE_REF`) — so your workflow needs no manual
`git fetch` step. Pass a branch (`.fetchBase("main")`) to be explicit; if the
fetch can't run, the fixer falls back to the working-tree diff.

## Cost controls and learning

Three opt-in primitives bound what the AI costs and teach it what to ignore.
They are shared objects you construct once and hand to any number of reviewers
and fixers.

### Token / cost budget

`budget(...)` caps spend across **every** reviewer and fixer it is attached to.
Each call folds its reported token usage into the running total; once a cap is
reached, the next AI step is **skipped (not failed)** with a note, rather than
running up the bill.

```ts
import { budget } from "jsr:@zuke/ai";

class CI extends Build {
  key = parameter("OpenAI API key").secret();
  ai = budget((b) => b.maxTokens(200_000).maxCost(1.0)); // 200k tokens or $1

  lint = target().executes(() => DenoTasks.lint())
    .recoverWith(aiFixer((f) => f.provider("openai").apiKey(this.key).budget(this.ai)));
  test = target().executes(() => DenoTasks.test((s) => s.allowAll()))
    .recoverWith(aiFixer((f) => f.provider("openai").apiKey(this.key).budget(this.ai)));
}
```

USD estimates use a built-in per-model price table; override or extend it with
`.prices({ "gpt-5.4-mini": { input: 0.4, output: 1.6 } })` (USD per 1M tokens).
A model with no known price still counts toward the **token** cap.

### Fix / response cache

`aiCache(...)` reuses a prior model response for an **identical** call (same
provider, model, and prompt) instead of paying for another one — handy when the
same failure recurs across CI re-runs. A cache hit costs nothing and does not
draw down the budget.

```ts
import { aiCache } from "jsr:@zuke/ai";

const cache = aiCache((c) => c.dir(".zuke/ai-cache").ttl(86_400)); // 1-day TTL
aiFixer((f) => f.provider("openai").apiKey(this.key).cache(cache));
```

### Learned false-positive suppression (review)

`suppressions(...)` hides reviewer findings whose **stable ID** you've dismissed.
Every finding is fingerprinted and its ID surfaced in the report and PR comment,
so silencing a recurring false positive is a copy-paste of that ID into the
suppress list (`.zuke/ai-suppress.json`, a JSON array of IDs):

```ts
import { suppressions } from "jsr:@zuke/ai";

securityReviewer((r) =>
  r.provider("openai").apiKey(this.key)
    .suppress(suppressions((s) => s.file(".zuke/ai-suppress.json")))
);
```

When suppression empties a finding list, the score and severity are cleared so
the gate sees a clean assessment; a partial suppression lowers the overall
severity to whatever remains. (Suppression is review-only — a fixer applies a
whole fix, not individual findings.)

## Other knobs

- `.model(...)`, `.effort(...)` — pick the model and thinking depth.
- `.criteria(...)` / `.conventions(...)` — add or override the project notes
  sent to the model.
- `.comment()` / `.noComment()` — toggle PR posting (the job summary is always
  written).
- `.maxDiffTokens(n)`, `.retry({ ... })`, `.quiet()` — budget, transient-failure
  retry, and output control.

## Dogfooding

Zuke's own `lint` target uses `recoverWith(aiFixer(...))`. On a lint failure in
CI it posts a committable suggestion to the pull request and a clean job-summary
diagnosis, reusing the same OpenAI key as the [AI review](./ai-review.md). On
fork PRs the key is absent, so the fixer simply skips and the build fails
normally.

## See also

- [AI code review](./ai-review.md) — the gate-the-build side of `@zuke/ai`.
- [Authoring API](./authoring.md) — targets, validations, and the build graph.

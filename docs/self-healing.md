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

## `aiFixer` — safe by default

With only a provider and key, `aiFixer` is **diagnose-only**: it sends the failed
command, its output, the diff, and your project conventions (`CLAUDE.md` /
`AGENTS.md`) to the model, parses a **structured fix**, and reports — without
touching any files. The diagnosis lands in the GitHub Actions job summary and on
the pull request.

```ts
test = target()
  .executes(() => DenoTasks.test((s) => s.allowAll()))
  .recoverWith(aiFixer((f) => f.provider("openai").apiKey(this.key)));
```

### Copilot-style inline suggestions

On GitHub, the fixer posts each problem as an **inline review comment with a
committable `suggestion` block** — anchored to the exact `file:line` in the diff,
deduplicated across re-runs, and skipped gracefully if a line isn't in the diff.
Off GitHub (or when the model reports no specific locations) it falls back to a
single overview comment. The structured fix carries per-problem locations (file,
line, the verbatim offending code, and the replacement), so the comment shows
real code, not prose. Use `.noSuggest()` to force the overview comment instead.

### Applying and committing fixes

Escalate from diagnosis to action, behind explicit guards:

```ts
aiFixer((f) =>
  f.provider("openai").apiKey(this.key)
    .autoApply()                         // write the fix to the working tree
    .allowPaths("packages/**", "src/**") // allowlist; lockfiles/.git/workflows excluded
    .maxEdits(5)                         // blast-radius cap
    .allowCI()                          // default is local-only; opt in for CI
    .commitFixes()                      // stage, commit, and push to the PR branch
);
```

| Setting | Effect |
| --- | --- |
| `.autoApply()` | Write the proposed fix to the working tree and re-run the target. Off by default. |
| `.allowPaths(...globs)` | Restrict applied edits to matching paths (lockfiles, `.git`, CI workflows, and key material are always excluded). |
| `.maxEdits(n)` | Cap how many files one fix may touch. |
| `.allowCI()` | Permit auto-apply/commit on CI (local-only by default). |
| `.commitFixes()` | Stage, commit, and push the fix so a healed PR carries it. Implies `.autoApply()`. |
| `.noPush()` / `.commitMessage(...)` | Tune the commit. |

A fix is **never auto-committed** unless you opt in, and the post-apply re-run is
always the gate: a bad edit fails the build instead of landing silently.

## Diff context without a CI step

For good diagnoses the fixer wants the PR diff. `.diff((d) => d.fetchBase())`
makes the fixer **fetch the base branch itself** — auto-detected from the CI
environment (GitHub's `GITHUB_BASE_REF`) — so your workflow needs no manual
`git fetch` step. Pass a branch (`.fetchBase("main")`) to be explicit; if the
fetch can't run, the fixer falls back to the working-tree diff.

## Other knobs

- `.model(...)`, `.effort(...)` — pick the model and thinking depth.
- `.criteria(...)` / `.conventions(...)` — add or override the project notes sent
  to the model.
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

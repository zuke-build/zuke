# Self-Healing Builds — Design & Implementation Plan

> Status: proposal. This document specifies a new core primitive (`recoverWith` /
> `Remediation`) and AI-backed fixers that diagnose a failed target, apply a fix,
> and re-run the real build command as the verifier.

## 1. Motivation

When a target fails — lint, type-check, test, build — zuke uniquely holds the
exact command that failed, its captured `stderr`, and the typed task graph
around it. A standalone AI tool never has that context. Self-healing closes the
loop:

1. A target body throws.
2. A configured `Remediation` receives the failure, diagnoses it, and (when
   permitted) applies a fix to the working tree.
3. The executor re-runs **the same target body** — the real, deterministic build
   command — as the verifier.
4. Repeat until the target passes or the attempt/cost budget is exhausted.

The deterministic re-run is what makes this trustworthy: a fix only "counts" when
the actual command goes green, not when a model claims success.

Two value tiers from one primitive:

- **Explain** (safe default): print a plain-English diagnosis plus a suggested
  patch. The build still fails. Zero write risk.
- **Heal** (opt-in, gated): apply the fix, re-run, loop until green.

## 2. Key finding: there is no failure hook today

`validateBefore` / `validateAfter` (`packages/core/src/target.ts`) only wrap a
**successful** body. The moment a body throws, `runTarget`
(`packages/core/src/executor.ts:437`) records `failed` and aborts. Self-healing
therefore requires a **new core primitive** before any AI work.

Enabling fact: when a target fails through the shell, the thrown error is a
`CommandError` (`packages/core/src/shell.ts:29`) carrying `.command`, `.code`,
and captured `.stderr`. That is exactly the context a fixer needs, and it is
already captured even while streaming live to the terminal.

## 3. Decisions (locked)

- **MVP scope:** ship through Phase 2 — core primitive + `aiFixer` with gated
  auto-apply and the verification loop.
- **Fixer packaging:** each agent fixer lives in the package that already wraps
  its CLI (`claudeFixer` in `@zuke/claude`, `codexFixer` in `@zuke/codex`,
  `geminiFixer` in `@zuke/gemini`). No new workspace package; no five-place
  registration churn.
- **Naming:** target method `.recoverWith(...)` / `.recoverAttempts(n)`;
  interface `Remediation`; context `RemediationContext`; result
  `RemediationResult`.

## 4. Architecture

Dependency direction stays clean — every package depends only on `@zuke/core`.

```
@zuke/core    Remediation primitive + .recoverWith() + executor recovery loop
@zuke/ai      aiFixer()      structured fix via the provider API (fast, bounded)
@zuke/claude  claudeFixer()  delegate to the wrapped agent CLI (open-ended)
@zuke/codex   codexFixer()        "
@zuke/gemini  geminiFixer()       "
```

`aiFixer` reuses `@zuke/ai`'s existing transport (`callProvider`), retry/backoff
(`retry.ts`), diff handling (`diff.ts`), and PR-comment hosts (`hosts.ts`). The
agent fixers reuse each package's existing run settings (`ClaudeTasks.run`, etc.).

## 5. Core primitive (`@zuke/core`)

### 5.1 Types (new, in `src/target.ts` beside `Validation`)

```ts
/** Context passed to a Remediation after a target body fails. */
export interface RemediationContext {
  /** The name of the failed target. */
  target: string;
  /** 1-based recovery attempt. */
  attempt: number;
  /** The failure — usually a CommandError with .command/.code/.stderr. */
  error: unknown;
}

/** The outcome of one remediation attempt. */
export interface RemediationResult {
  /** Re-run the body? `false` = explain-only / give up. */
  retry: boolean;
  /** One-line description of the diagnosis or action, for the report. */
  summary?: string;
}

/**
 * A recovery step plugged into a target with `.recoverWith(...)`. Runs only
 * after the body fails. Implemented by the AI fixers in `@zuke/ai`,
 * `@zuke/claude`, `@zuke/codex`, `@zuke/gemini`, but any object with a
 * `remediate` method qualifies.
 */
export interface Remediation {
  name?: string;
  remediate(context: RemediationContext): Promise<RemediationResult>;
}
```

### 5.2 `TargetBuilder` additions (in `src/target.ts`)

```ts
/** Remediations run after the body fails (set by .recoverWith). */
readonly recoverWith_: Remediation[] = [];
/** Max recovery attempts (fix → re-run cycles). Default 1. */
recoverAttempts_ = 1;

recoverWith(...remediations: Remediation[]): this {
  this.recoverWith_.push(...remediations);
  return this;
}
recoverAttempts(times: number): this {
  this.recoverAttempts_ = Math.max(1, Math.floor(times));
  return this;
}
```

Export `Remediation`, `RemediationContext`, `RemediationResult` from
`packages/core/mod.ts` alongside `Validation`.

### 5.3 Executor recovery loop (in `src/executor.ts:runTarget`)

Replace the single try/catch around the body with an outer recovery loop:

```
try {
  validateBefore; runBody; validateAfter; record; return passed
} catch (error) {
  if (recoverWith_.length === 0 || dryRun) return failed(error)
  for (let attempt = 1; attempt <= recoverAttempts_; attempt++) {
    let willRetry = false
    for (const r of recoverWith_) {
      try {
        const res = await r.remediate({ target: name, attempt, error })
        willRetry = willRetry || res.retry
        // accumulate res.summary for the report
      } catch { /* best-effort: a throwing remediation = could not heal */ }
    }
    if (!willRetry) break
    try {
      runBody; validateAfter
      if (cache) await cache.record(t)
      return { status: "healed", ms, ... }   // healed pass
    } catch (e) { error = e; continue }       // feed the new failure back
  }
  return failed(error)
}
```

Specifics:

- **Ordering vs `.retry()`:** `retry()` stays the inner loop (transient
  flakiness, identical body, in `runBody`). `recoverWith` is the outer loop
  (mutate state → re-run). Remediation wraps retry.
- **Dry-run / cache:** never remediate under `dryRun`; only `cache.record` after
  a healed pass.
- **New status `"healed"`:** add to `TargetStatus`, the report footers
  (`src/report.ts`), and the summary table so a recovered target reads
  distinctly from a clean `passed`. Counts as success for `BuildResult.ok`.
- **Lifecycle:** unchanged — `targetEnd(name, "healed")` fires once at the end.

A `Remediation` need not be AI-backed: a deterministic "run `deno fmt`, then
retry" remediation is a valid implementation and a useful test fixture.

## 6. `aiFixer()` (`@zuke/ai`)

### 6.1 Structured output — a `Fix` (new `Fix` schema beside `schema.ts`)

```ts
interface FileEdit {
  path: string;
  /** Exactly one of the following shapes is populated. */
  find?: string; replace?: string;   // targeted string replacement
  content?: string;                   // full new file content
  unifiedDiff?: string;               // a patch to apply
}
interface Fix {
  diagnosis: string;          // plain-English what & why
  rootCause: string;
  confidence: "low" | "medium" | "high";
  edits: FileEdit[];
  retrySafe: boolean;         // model's own judgement that re-running is safe
}
```

Enforced server-side per provider exactly like `ASSESSMENT_JSON_SCHEMA` /
`ASSESSMENT_GEMINI_SCHEMA` are today in `provider.ts`. `callProvider` is
generalized to accept the schema (or a second entry point `callProviderFix`) so
the transport, retry, and usage-reporting code is shared verbatim.

### 6.2 Prompt assembly (new `prompts/` siblings)

- **System:** "You are fixing a failed build step. Return a minimal, correct fix
  that respects the project's conventions."
- **User:** assembles
  `{ target name, failed command, stderr (+ tail of stdout), working-tree diff,
  CLAUDE.md / AGENTS.md conventions if present }`. The diff is produced by
  reusing `DiffSettings` / `filterDiff` / `truncate` from `diff.ts`. Convention
  injection is the same high-leverage idea as on the review side: fixes that
  honour "no `any`, no `as`, task-shaped API."

### 6.3 Fluent surface (settings-lambda, matching `Reviewer`)

```ts
aiFixer(s => s
  .provider("claude").apiKey(this.anthropicKey)
  .explainOnly()                       // DEFAULT — diagnose + suggest, never write
  .autoApply()                         // opt-in to write the fix
  .allowPaths("src/**", "packages/**") // allowlist; lockfiles/.git/CI excluded
  .maxEdits(5).maxChangedLines(120)    // blast-radius caps
  .onlyLocal()                         // DEFAULT — no auto-apply on CI...
  .allowCI()                           // ...unless explicitly allowed
  .maxAttempts(2)
  .onError("warn")                     // a fixer error never masks the real failure
  .comment()                           // post diagnosis/patch to the PR (hosts.ts)
  .quiet()
);
```

### 6.4 Apply step

`autoApply` writes edits via `FileTasks` (core) behind the guards in §7. After
writing, `remediate` returns `{ retry: true }` and the executor re-runs the
target. `explainOnly` returns `{ retry: false }` with the diagnosis in `summary`
and prints/posts the suggested patch.

## 7. Safety model (non-negotiable)

- `explainOnly()` is the default — no writes, ever. Build still fails.
- Auto-apply requires explicit opt-in **and** a path allowlist. Hard-excluded
  regardless of allowlist: lockfiles, `.git/**`, `.github/workflows/**`, and
  anything secret-shaped.
- `onlyLocal()` default: no surprise edits on CI unless `.allowCI()`.
- Blast-radius caps (`maxEdits`, `maxChangedLines`) and a `maxAttempts` budget;
  reuse token-usage reporting for cost visibility.
- **Never auto-commit.** A heal lands in the working tree; the human commits.
- Optional stash-before-apply so a rejected fix is trivially revertible.

## 8. Agent-delegation fixers (`@zuke/claude` / `codex` / `gemini`)

Each agent package gains one `Remediation`-implementing export (e.g.
`claudeFixer()`) that:

1. Builds a prompt from `RemediationContext` (failing command + stderr + target
   + conventions).
2. Invokes the agent headless via existing settings (`ClaudeTasks.run` with
   `--print`, a tool allowlist, an appropriate permission mode), letting it read
   and edit files autonomously.
3. Returns `{ retry: true }` so the executor re-runs the real target as the
   verifier.

Same safety gating as `aiFixer` (path allowlist via the agent's working-dir and
tool restrictions, local-only default, attempt cap). This is the tier for
open-ended failures (a real logic bug, a multi-file fix) that a single
structured edit can't cover.

## 9. Worked example (zuke's own build)

```ts
test = target()
  .description("Run the test suite, healing simple failures")
  .executes(() => DenoTasks.test(s => s.allowAll().coverage("cov_profile")))
  .recoverWith(
    aiFixer(s => s
      .provider("claude").apiKey(this.anthropicKey)
      .autoApply().allowPaths("packages/**/src/**", "packages/**/tests/**")
      .maxEdits(4).onlyLocal().maxAttempts(2)
      .skipIfKeyMissing()),
  )
  .recoverAttempts(2);
```

Locally: a failing test triggers a diagnosis, a scoped edit, and a re-run. On CI
(no `.allowCI()`): the fixer diagnoses and comments on the PR but does not write.

## 10. Registration & docs checklist

- No new workspace package (fixers live in existing packages), so the five-place
  registration does **not** change.
- New exports must be added to each package's `mod.ts` with JSDoc on every
  symbol.
- Regenerate `llms.txt`, `llms-full.txt`, and every touched README `## API`
  block via `./zuke apiDocs` (CI fails on drift via `./zuke apiDocsCheck`).
- Add this doc's user-facing companion to `docs/` and link it from the relevant
  READMEs.
- `deno task ci` green; coverage ≥ 95% lines and branches.

## 11. Testing strategy (hermetic)

- **Core loop:** a fake `Remediation` exercises the executor — explain-only (no
  retry), heal-on-first-attempt, heal-on-second-attempt, exhausted budget, and a
  throwing remediation. Assert `healed` status and `BuildResult.ok`.
- **`aiFixer`:** inject a fake `fetch` returning a canned `Fix`; assert prompt
  assembly, schema enforcement, the apply step, and every guard (allowlist
  rejection, `maxEdits`, `onlyLocal` on CI, `explainOnly` writes nothing).
- **Agent fixers:** inject a fake runner; assert prompt + permission/tool flags +
  `{ retry: true }`.
- **Apply guards:** unit-test path-allowlist matching and the hard exclusions.

## 12. Phased delivery

| Phase | Deliverable |
|------|-------------|
| 0 | Core `Remediation` + `.recoverWith()` / `.recoverAttempts()` + executor loop + `healed` status + tests. AI-free. |
| 1 | `aiFixer()` explain-only. "Zuke tells you why the build broke + a patch." |
| 2 | `aiFixer()` gated auto-apply + verification loop. **← MVP target** |
| 3 | `claudeFixer()` / `codexFixer()` / `geminiFixer()` agent delegation. |
| 4 | Polish: PR-comment posting, cost budgets, fix caching, learned suppression. |

Phase 0 is a self-contained first PR (`feat(core): add target recovery hook`)
that de-risks the executor change before any auto-write exists. Phases 1–2 land
as `feat(ai): …`.

## 13. Open questions

- Should `recoverWith` remediations run for a body that fails its
  `validateAfter` (a tripped AI review), or only for body failures? Proposed:
  body failures only in v1; revisit.
- Default `recoverAttempts` of 1 vs 2.
- Whether a healed target should be cache-recorded (proposed: yes — the body
  genuinely passed) or always re-run next time.

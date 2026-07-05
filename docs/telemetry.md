# Anonymous usage telemetry — design proposal

Status: **proposal** (nothing is implemented or collected today).

This document is the plan for adding completely anonymous, **opt-in** usage
telemetry to Zuke, so the project can answer four questions:

1. How many repositories use Zuke?
2. How many builds run (and how often)?
3. How often do builds fail?
4. Which tool wrapper packages (`@zuke/deno`, `@zuke/docker`, …) are actually
   used?

Everything else is a non-goal. In particular, telemetry must **never** be able
to answer "who is this?" or "what is this repository?" — not because we promise
not to look, but because the data to answer those questions is never sent.

## Principles

1. **Opt-in, never opt-out.** Telemetry is off until a human explicitly enables
   it for a repository. There is no nagging prompt, no "enabled by default in
   v2", no dark pattern. A fresh `zuke setup` leaves it off.
2. **Anonymous by construction, not by policy.** The payload is a *closed
   schema*: every field is either a number, a value from a fixed enum, or a
   name from a compile-time allowlist that ships in this repository. There is
   no free-form string field, so there is no field a path, hostname, username,
   email, or repo name could travel in — even by accident.
3. **Transparent and verifiable.** The exact payload can be inspected before
   and after opt-in (`zuke telemetry show`), the collection code is in this open
   repository, the schema is enforced by tests that fail CI if anyone widens
   it, and the ingest endpoint's source is public.
4. **Individually overridable.** Opt-in is per-repository (it lives in
   `zuke.json`, which is committed), but any individual or environment can kill
   it with `ZUKE_TELEMETRY=0` or the cross-tool
   [`DO_NOT_TRACK=1`](https://consoledonottrack.com/) convention — both win
   over the repo setting, always.
5. **Zero build impact.** Sending is fire-and-forget with a short timeout; a
   failed or slow send can never fail, slow down (beyond the timeout), or
   change the output of a build. No queueing, no retries, no persistent
   background state.

## Consent model

Opt-in is recorded in `zuke.json` — the committed repo-root marker file — so
consent is version-controlled, reviewable in the PR that enables it, and shared
by every clone and CI runner of that repository:

```jsonc
{
  "name": "MyProject",
  "telemetry": {
    "enabled": true,
    // A client-generated random UUID minted at opt-in time. Random — derived
    // from nothing — so it identifies the repo only as "the same repo as
    // last time", never as "this particular repo".
    "repoId": "3f8c9a52-1d2e-4b7a-9c31-8e5f0a6d4b21"
  }
}
```

Resolution order (first match wins):

| Signal                                   | Effect                       |
| ---------------------------------------- | ---------------------------- |
| `ZUKE_TELEMETRY=0` or `DO_NOT_TRACK=1`   | disabled, no matter what     |
| `zuke.json` → `telemetry.enabled: true`  | enabled                      |
| anything else (missing key, `false`, no `zuke.json`) | disabled        |

There is deliberately **no** `ZUKE_TELEMETRY=1` force-enable: consent belongs
to the repository owner via the committed file, not to an environment variable
someone can set in a CI runner the owner doesn't control.

New reserved CLI commands (added to `RESERVED_COMMANDS` in
`packages/core/src/cli_spec.ts` so they appear in `--help`, `--list --json`,
and shell completions):

- `zuke telemetry status` — prints enabled/disabled, the effective reason
  (env override vs. config), and the `repoId`.
- `zuke telemetry enable` — mints a random `repoId`, writes the `telemetry`
  block to `zuke.json`, and prints the docs URL plus a sample payload so the
  person enabling it sees exactly what will be sent *before* anything is sent.
- `zuke telemetry disable` — sets `enabled: false` (keeps the `repoId` so
  re-enabling doesn't double-count the repo).
- `zuke telemetry show` — prints, as JSON, the exact payload the *last* build
  would have produced (or a sample if none ran). Works even while disabled, so
  anyone can audit what opting in would share.

## The payload — the whole payload

One event is sent per `zuke <target>` invocation, at the end of the run. This
is the complete schema; a field not listed here cannot be sent (see
[Enforcement](#enforcement-proving-there-is-no-pii)):

```jsonc
{
  "schema": 1,                  // integer schema version
  "repoId": "3f8c9a52-…",       // the random UUID from zuke.json
  "zuke": "1.9.0",              // @zuke/core version (from the published build)
  "deno": "2.3",                // Deno major.minor only
  "os": "linux",                // enum: linux | darwin | windows | other
  "ci": "github",               // enum from detectCiHost(): github | gitlab |
                                //   azure | bitbucket | local
  "outcome": "failed",          // enum: passed | failed
  "durationBucket": "1m-5m",    // enum: <10s | 10s-1m | 1m-5m | 5m-20m | >20m
  "targets": {                  // counts only — never target names
    "planned": 12,
    "passed": 9,
    "failed": 1,
    "skipped": 1,
    "cached": 1
  },
  "parallel": true,             // whether --parallel was used
  "cacheEnabled": true,         // whether incremental caching was active
  "wrappers": ["deno", "docker"], // ⊆ compile-time allowlist of @zuke/*
                                  // package names (see below)
  "errorKind": "ToolNotFoundError" // enum of Zuke's own error class names,
                                   // or "other"; never an error message
}
```

What is **never** collected — because no field exists to carry it:

- repository names, URLs, remotes, or paths
- target names, parameter names, or parameter values
- usernames, hostnames, emails, machine IDs, MAC addresses
- environment variables, argv, tool output, error messages or stack traces
- IP addresses at rest (see [Backend](#backend)) or timestamps finer than the
  ingest server's aggregation window
- anything at all when the run is `--dry-run`, `--list`, `--help`, `graph`,
  `generate-ci`, or `completions` — only real target executions report

Notes on two fields that deserve scrutiny:

- **`wrappers`** answers "which package wrappers are used". Values come from a
  `const` allowlist in core (`"deno"`, `"npm"`, `"docker"`, … — the `PACKAGES`
  names). At runtime, `ToolSettings.run` records its owning wrapper's name
  into a process-local registry in core; the payload includes the intersection
  of that registry with the allowlist. A private/internal wrapper someone
  builds on `ToolSettings` is therefore *dropped*, not reported — its name
  never leaves the process.
- **`errorKind`** answers "why do builds fail" at the coarsest useful grain.
  It is matched against Zuke's own error classes (`ToolNotFoundError`,
  `ParameterError`, timeout, non-zero exit, …); anything unrecognised — i.e.
  any error a user's code threw — maps to the literal `"other"`.

`durationBucket` is bucketed rather than exact deliberately: exact durations
are a fingerprinting vector and we don't need them.

## Architecture

Everything lands in `@zuke/core` (keeping the zero-runtime-dependency rule; the
sender is plain `fetch`), split one-domain-per-file per the repo guidelines:

```
packages/core/src/telemetry/
  config.ts     # read/write the zuke.json telemetry block; env overrides;
                #   pure given injected readEnv/readFile seams
  payload.ts    # build the payload from a BuildResult + counters — PURE,
                #   no I/O, fully unit-testable (mirrors buildArgs() purity)
  allowlist.ts  # const WRAPPER_ALLOWLIST, error-kind enum, bucket edges
  registry.ts   # process-local wrapper-usage registry (record/snapshot/reset)
  plugin.ts     # telemetryPlugin(): a standard core Plugin
  send.ts       # fire-and-forget POST; injectable fetch (same seam as http.ts);
                #   hard timeout (~1500 ms via AbortSignal); swallows all errors
```

Integration points — all seams that already exist:

1. **The `Plugin` lifecycle** (`packages/core/src/plugin.ts`). Telemetry is a
   plain plugin: `onTargetEnd` accumulates status counts, `onFinish` builds
   the payload and fires the send. The CLI entry (`run`) appends
   `telemetryPlugin()` to `options.plugins` **only when consent resolves to
   enabled**; embedded/programmatic `execute()` calls and test runs (which
   pass `silent`/custom reporters) never send — same spirit as the
   `writeJobSummary` guard in `executor.ts`.
2. **`ToolSettings`** (`packages/core/src/tooling.ts`). Its `run` path calls
   `registry.record(wrapperName)`. One line in core; no change to any wrapper
   package. Recording is unconditional and free (a `Set.add`); the data leaves
   the process only if the plugin is active.
3. **`detectCiHost()`** (`host.ts`) supplies `ci`; `Deno.build.os` supplies
   `os`; the version constants supply `zuke`/`deno`.
4. **`zuke.json`** (`config.ts`) gains the optional `telemetry` block; the
   root-marker semantics are untouched.

The last-payload copy that `zuke telemetry show` prints is written to
`.zuke/telemetry-last.json` (the existing git-ignored artifact dir, next to
the cache) — so "what did my build just send?" is answerable from disk without
trusting the network path.

## Enforcement: proving there is no PII

Policy documents don't prove anything; tests and structure do. The same PR
that implements collection must include:

1. **A closed-schema test.** `payload.ts` exports the payload type with no
   `string`-typed field except `repoId` (validated as a UUID) and the
   enum/allowlist unions. A test feeds the payload builder adversarial inputs
   — target names containing paths and emails, error messages with `/home/…`
   and `@`-signs, a wrapper named `"../../etc/passwd"` — and asserts the
   serialized JSON contains none of them, matches the schema exactly, and
   contains no key outside the documented set. Widening the schema means
   editing this test, which means a reviewable diff on the privacy surface.
2. **A docs-drift gate.** A test asserts the field list in this document stays
   in sync with the payload type (same mechanism as `apiDocsCheck`), so the
   published promise and the code can't diverge silently.
3. **An override test matrix.** `DO_NOT_TRACK=1`, `ZUKE_TELEMETRY=0`, missing
   config, `enabled: false`, and dry-run each produce *zero* `fetch` calls
   (asserted through the injectable fetch seam — the test suite stays hermetic
   with no network, per repo rules).
4. **Coverage** at the usual 95%+ gate, like everything else in core.

Plus two operational transparency commitments, documented in this file and the
README once live:

- The ingest endpoint's source lives in this repository (see below), deployed
  from `master`.
- Aggregates are published back to the community (a simple public page:
  repo count, build counts, failure rate, wrapper popularity) — the only
  reason to collect this data is to share the picture it paints.

## Backend

Smallest thing that works, with the privacy posture enforced server-side too:

- A single `POST /v1/event` endpoint on Deno Deploy (source in this repo,
  e.g. `telemetry/ingest.ts`, deployed from `master` so the running code is
  auditable).
- The handler validates the event against the same closed schema (reject,
  don't store, anything malformed or over-sized), increments aggregate
  counters (per day: builds, failures, distinct `repoId`s via a sketch or
  set, wrapper tallies), and stores **no raw events, no IPs, no user agents,
  no precise timestamps**. `repoId` is used only for the distinct-count and
  is not queryable individually.
- No authentication (the data is worthless to an attacker and fake traffic
  only pollutes our own charts; basic rate-limiting at the edge suffices).
- The public aggregates page reads from the same store.

The client ships with the endpoint URL as a constant; `ZUKE_TELEMETRY_URL` is
honoured only in tests via the injectable fetch, not read in production code —
one less way to exfiltrate someone's build data by poisoning their env.

## Rollout plan

Each phase is an independently reviewable PR with a conventional-commit title
(this repo squash-merges and release-please parses the PR title):

1. `docs(core): add anonymous telemetry design proposal` — **this document.**
   Land the plan, gather feedback on the schema and consent model before any
   code.
2. `feat(core): telemetry consent, payload builder, and CLI commands` —
   `telemetry/` module, `zuke.json` block, `zuke telemetry
   status|enable|disable|show`, closed-schema + override tests, docs update,
   regenerated `llms.txt`/`llms-full.txt`/README API blocks (`./zuke apiDocs`).
   Ships **inert**: the sender is behind a constant that is unset, so nothing
   transmits yet even for opted-in repos.
3. `feat(core): wire the telemetry plugin into the CLI run path` — registry
   recording in `ToolSettings`, plugin attachment in `run`, endpoint constant
   set, `.zuke/telemetry-last.json`. First release that can actually send.
4. Backend + public aggregates page (`telemetry/ingest.ts`, deploy workflow),
   and an announcement (README section + CHANGELOG) inviting projects to
   opt in — including Zuke's own `zuke.json` as the first opted-in repo.

## Open questions (feedback wanted before phase 2)

1. **Committed `repoId` vs. none at all.** The random UUID in `zuke.json` is
   visible to everyone with repo access and enables the "how many repos"
   count. Alternative: no ID at all and accept fuzzy repo counts from
   server-side heuristics. Proposal: keep the committed random UUID — it is
   the most honest option (the identifier is in plain sight in the diff that
   enables telemetry) and carries zero derivable information.
2. **Per-target wrapper granularity.** We could report wrapper *counts*
   (`{"deno": 5, "docker": 1}`) instead of presence. Proposal: presence only
   for v1; counts add fingerprinting surface for marginal insight.
3. **Should `zuke setup` mention telemetry?** A single informative line
   ("anonymous telemetry is off; `zuke telemetry enable` to help the project —
   docs/telemetry.md") is discoverable without being a nag. Proposal: yes,
   one line, no prompt.

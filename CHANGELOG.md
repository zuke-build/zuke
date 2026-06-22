# Changelog

Project-level highlights. Per-package release notes live in each package's own
`CHANGELOG.md` and are generated automatically by release-please; this file
captures the milestones worth calling out.

## 2026-06-22 — `@zuke/core` 1.0.0 🎉

The first **stable** release of Zuke's core: a code-first, strongly-typed build
automation library for Deno & TypeScript. From here, `@zuke/core` follows
semantic versioning — depend on `^1` with confidence.

### Why Zuke

Your build is a **TypeScript class**, not a YAML file. Each target is a field,
and targets reference each other by `this.x` rather than `"x"` — so renames are
real refactors and a typo is a compile error, not a 3am pipeline failure.

### Highlights

- **Typed target graph.** Dependencies are passed as references; Zuke discovers
  targets by introspection, topologically sorts them, honours `before`/`after`
  hints, and reports cycles and forward references with friendly errors.
- **Injection-safe shell.** The `$` tagged template tokenizes interpolated
  values into discrete argv entries — never a concatenated shell string — so
  command construction has no injection surface.
- **`FileTasks`.** Namespaced filesystem operations for builds — create, clean,
  remove, copy, move, and read/write — with idempotent, missing-target-tolerant
  behaviour.
- **Built-in coverage gate.** `DenoTasks.coverage` parses the lcov report and
  enforces line/branch thresholds, failing the build below the bar.
- **Code-first CI.** Declare the pipeline in the build and Zuke generates GitHub
  Actions, GitLab CI, or Azure Pipelines YAML, regenerating and verifying it on
  every run.
- **30+ typed tool wrappers.** `DenoTasks`, `NpmTasks`, `JsrTasks`, and a tool
  per ecosystem favourite, plus a generic `@zuke/cmd` fallback — all in one
  consistent settings-lambda style.
- **Zero runtime dependencies**, published to [JSR](https://jsr.io/@zuke).

### Self-hosting

Zuke builds, tests, and releases itself: the repository's own `zuke.ts` runs the
full gate (format, lint, spell-check, type-check, test, coverage) and drives
release-please and JSR publishing.

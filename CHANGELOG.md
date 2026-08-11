# Changelog

Project-level highlights. Per-package release notes live in each package's own
`CHANGELOG.md` and are generated automatically by release-please; this file
captures the milestones worth calling out.

## 2026-07-30 — every package 1.0.0 🎉

All 54 packages are now `1.x`: `@zuke/core`, the `@zuke/cli` command, and all 50+
tool wrappers and plugins. There is no pre-1.0 tier left — `bump-minor-pre-major`
is off, so every package makes the same promise: a minor or patch release never
breaks a public symbol, and a breaking change bumps the major version. Depend on
`jsr:@zuke/<package>@^1` and take minors without reading the diff. See
[Versioning & compatibility](docs/versioning.md).

A wrapper's `1.x` promise covers its own typed surface, not the upstream CLI it
drives: if a tool renames a flag, the wrapper keeps the old method working
(deprecated) or bumps its major.

**`@zuke/tsgo` is dropped** in the same change — 54 packages, not 55. TypeScript
7.0 (2026-07-08) ships the native Go compiler as the `tsc` of the ordinary
`typescript` package, so [`@zuke/tsc`](https://jsr.io/@zuke/tsc) already drives
it and `TsgoSettings` was a duplicate of `TscSettings`. To drive the `tsgo`
nightly instead, point the `tsc` wrapper's `toolPath` at
`node_modules/.bin/tsgo` — the CLI surface is the same.

`@zuke/tsgo@0.1.3` stays resolvable on JSR for anyone already pinned to it; no
`1.0.0` was published and the package is archived there.

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

# How Zuke compares

Zuke exists for the build that has outgrown a list of commands: a real
dependency graph, typed inputs, external tools driven through checked argv, and
pipelines that have to survive waiting for something outside the build.

It is also a **young, single-maintainer project** — 55 JSR packages, `@zuke/core`
at `1.x` and most tool wrappers still `0.x` (see
[Versioning & compatibility](./versioning.md) for what each tier promises). The
package a consumer actually installs is the `@zuke/cli` command, at **0.8.1** —
pre-1.0, so it makes no compatibility promise yet, and it is the front door to
the `mcp`, `resume` and `cancel` surface below. Zuke has no hosted service, no
funded team and no plugin marketplace, and several tools here have all three.

**Scope:** tools a JavaScript or TypeScript team would realistically choose.
[NUKE](https://nuke.build/) is deliberately absent — it needs the .NET SDK — even
though it is the direct precedent for Zuke's design and is credited as such in
the [acknowledgements](../README.md#acknowledgements).

A **—** means the capability was **not found in the official documentation
reviewed** for this page. That is weaker evidence than a positive finding: the
docs may simply be silent.

<div style="overflow-x: auto">

| Capability                        | Zuke                                           | `deno task`                    | npm scripts                | GNU Make                    | Nx                                                        | Turborepo                                | Dagger                            |
| --------------------------------- | ---------------------------------------------- | ------------------------------ | -------------------------- | --------------------------- | --------------------------------------------------------- | ---------------------------------------- | --------------------------------- |
| Dependency wiring                 | typed `this.field` references                  | JSON array of task names       | none (`pre`/`post` naming) | Makefile prerequisites      | JSON `dependsOn` + inferred graph                         | JSON `dependsOn`                         | inferred from code data flow      |
| Bad reference caught              | compile error, then pre-flight scan            | CLI name yes; in-array unknown | only for a directly-run script | yes, before any recipe  | when the task graph is built                              | yes, before the run starts               | compile error in the host language |
| Authoring language                | TypeScript, no DSL                             | JSON + shell subset            | JSON + shell strings       | Makefile DSL                | JSON + TypeScript executors                               | JSON + `package.json` scripts            | Go/Python/TypeScript/… code       |
| Typed wrappers for tool flags     | 50+ `*Tasks` packages                          | no                             | no                         | no                          | executor options, JSON-schema                             | no                                       | no (plain `withExec` argv)        |
| Command construction              | argv arrays end to end, no shell               | built-in shell subset          | OS shell strings           | shell per recipe line       | per-executor, no stated contract                          | `package.json` shell strings             | argv arrays                       |
| Skip unchanged work               | hashes declared `.inputs()`/`.cacheKey()` only | opt-in `files` globs (2.9)     | no                         | file timestamps             | content hashing (files, config, command)                  | content hashing (files, config, command) | BuildKit operation cache          |
| Narrow a run to changed files     | `--affected=<ref>`, declaration-driven         | no                             | no                         | n/a (timestamps, not diffs) | `nx affected`, import-inferred                            | `turbo run --affected`, import-inferred  | no such concept                   |
| Cross-machine cache               | built in; needs `.inputs()` + `.outputs()`     | local only                     | no                         | no                          | Nx Cloud (hosted, free tier); own server via OpenAPI spec | in the CLI; free hosted; self-host       | Dagger Cloud (paid)               |
| Suspend and resume a run          | `.waitsFor()` + `zuke resume`                  | —                              | —                          | —                           | —                                                         | —                                        | —                                 |
| Cancellation with compensations   | `.onCancel()`, reverse order                   | —                              | —                          | —                           | —                                                         | —                                        | cancel visible in traces only     |
| Long-lived process dependencies   | `service()`                                    | —                              | —                          | —                           | `continuous: true`                                        | `persistent` + `with`                    | —                                 |
| MCP server for agents             | built in (`zuke mcp`)                          | —                              | —                          | —                           | official `nx-mcp`                                         | proposed, not shipped                    | modules exposed as MCP servers    |
| Machine-readable self-description | `--list --json`, generated `llms.txt`          | —                              | `npm pkg get scripts`      | —                           | workspace/graph tools over MCP                            | —                                        | typed API + MCP                   |
| Runtime it needs                  | Deno                                           | Deno                           | Node                       | system binary + shell       | Node + `@nx/*` plugins                                    | native binary via npm                    | CLI + engine container            |
| Backing                           | single maintainer; core `1.32`, cli `0.8.1`    | Deno Land Inc.                 | npm/GitHub, since ~2010    | GNU, 35+ years              | Nrwl, 29.1k stars, Nx Cloud                               | Vercel, 30.8k stars, MIT                 | funded startup, 16.1k stars       |

</div>

**Where Zuke does not win.** The two caching rows and the affected row are
qualified rather than won: Zuke's versions are declaration-driven, so they do
only as much as the target author declared, where Nx's and Turborepo's are
derived from the source graph. The cache does not notice an edited target body
unless a `.cacheKey()` says so, the cross-machine cache needs both `.inputs()`
and `.outputs()` and falls back quietly when the store is unreachable, and
exactly-once resume spans a single host unless you operate the
[HTTP state store](./state.md). Hosted caching, ecosystem and backing are losses,
not ties.

---

**Checked** against official documentation and public repositories on
**2026-07-28**, at `@zuke/core` 1.32 and `@zuke/cli` 0.8.1. Version-specific
facts as of that date: `deno task` file-fingerprint caching from **Deno 2.9**; Nx
continuous tasks from **Nx 21**, with `nx-mcp` shipped; Turborepo remote caching
in the OSS CLI with no MCP server; Dagger Cloud as the paid tier for
cross-machine caching. Star counts: `nrwl/nx` 29.1k, `vercel/turborepo` 30.8k,
`dagger/dagger` 16.1k.

One row is worth citing precisely, because an earlier draft of this page got it
wrong: **Nx self-hosted caching is not a paid feature.** The deprecation notice
for `@nx/s3-cache` and its siblings
([nx.dev](https://nx.dev/docs/reference/deprecated/self-hosted-cache-packages))
gives the reason as the CREEP vulnerability
([CVE-2025-36852](https://www.cve.org/CVERecord?id=CVE-2025-36852)), not
licensing, and the documented path for on-premises storage is to implement the
Nx remote cache OpenAPI specification
([nx.dev](https://nx.dev/docs/kb/self-hosted-caching)), where "Implementation is
up to you" and no subscription is required. Zuke's differentiator on that row is
that its cache is built into the build system with no separate service to adopt —
not price.

All of these move. Re-check before relying on a row.

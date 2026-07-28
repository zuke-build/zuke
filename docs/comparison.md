# How Zuke compares

Zuke exists for the build that has outgrown a list of commands: a real
dependency graph, typed inputs, external tools driven through checked argv, and
pipelines that have to survive waiting for something outside the build. It is
also a **young, single-maintainer project** — 55 JSR packages, `@zuke/core` at
`1.x` and most tool wrappers still `0.x` (see
[Versioning & compatibility](./versioning.md) for what each tier promises). The
package a consumer actually installs is the `@zuke/cli` command, and it is at
**0.8.1** — pre-1.0, so it makes no compatibility promise yet, and it is the
front door to the `mcp`, `resume` and `cancel` surface this page showcases. Zuke
has no hosted service, no funded team, and no plugin marketplace, and several
tools below have all three. This page compares **functionality**, axis by axis,
and says where each of them is ahead.

## The capability matrix

Rows are capabilities; columns are the tools. Cells are deliberately terse — the
nuance is in the prose under each tool.

A **—** means the capability was **not found in the official documentation
reviewed** for this page. That is weaker evidence than a positive finding: the
docs may simply be silent. Where a claim could not be pinned down at all it is
marked *unknown* rather than absent.

<div style="overflow-x: auto">

| Capability                       | Zuke                                | `deno task`                    | npm scripts                    | GNU Make                    | Nx                                 | Turborepo                          | Dagger                            | NUKE                              |
| -------------------------------- | ----------------------------------- | ------------------------------ | ------------------------------ | --------------------------- | ---------------------------------- | ---------------------------------- | --------------------------------- | --------------------------------- |
| Dependency wiring                | typed `this.field` references       | JSON array of task names       | none (`pre`/`post` naming)     | Makefile prerequisites      | JSON `dependsOn` + inferred graph  | JSON `dependsOn`                   | inferred from code data flow      | typed C# `.DependsOn`             |
| Bad reference caught             | compile error, then pre-flight scan | CLI name yes; in-array unknown | only for a directly-run script | yes, before any recipe      | when the task graph is built       | yes, before the run starts         | compile error in the host language | compile error                     |
| Authoring language               | TypeScript, no DSL                  | JSON + shell subset            | JSON + shell strings           | Makefile DSL                | JSON + TypeScript executors        | JSON + `package.json` scripts      | Go/Python/TypeScript/… code       | C#                                |
| Typed wrappers for tool flags    | 50+ `*Tasks` packages               | no                             | no                             | no                          | executor options, JSON-schema      | no                                 | no (plain `withExec` argv)        | generated C# wrappers             |
| Command construction             | argv arrays end to end, no shell    | built-in shell subset          | OS shell strings               | shell per recipe line       | per-executor, no stated contract   | `package.json` shell strings       | argv arrays                       | argv via wrappers; shell also     |
| Skip unchanged work              | hashes declared `.inputs()`/`.cacheKey()` only | opt-in `files` globs (2.9) | no                          | file timestamps             | content hashing (files, config, command) | content hashing (files, config, command) | BuildKit operation cache    | unknown                           |
| Narrow a run to changed files    | `--affected=<ref>`, declaration-driven | no                          | no                             | n/a (timestamps, not diffs) | `nx affected`, import-inferred     | `turbo run --affected`, import-inferred | no such concept              | —                                 |
| Cross-machine cache              | built in; needs `.inputs()` + `.outputs()` | local only              | no                             | no                          | Nx Cloud (hosted, free tier); own server via OpenAPI spec | in the CLI; free hosted; self-host | Dagger Cloud (paid)      | not native                        |
| Suspend and resume a run         | `.waitsFor()` + `zuke resume`       | —                              | —                              | —                           | —                                  | —                                  | —                                 | —                                 |
| Cancellation with compensations  | `.onCancel()`, reverse order        | —                              | —                              | —                           | —                                  | —                                  | cancel visible in traces only     | —                                 |
| Long-lived process dependencies  | `service()`                         | —                              | —                              | —                           | `continuous: true`                 | `persistent` + `with`              | —                                 | —                                 |
| MCP server for agents            | built in (`zuke mcp`)               | —                              | —                              | —                           | official `nx-mcp`                  | proposed, not shipped              | modules exposed as MCP servers    | —                                 |
| Machine-readable self-description | `--list --json`, generated `llms.txt` | —                            | `npm pkg get scripts`          | —                           | workspace/graph tools over MCP     | —                                  | typed API + MCP                   | `--help` target listing           |
| Runtime it needs                 | Deno                                | Deno                           | Node                           | system binary + shell       | Node + `@nx/*` plugins             | native binary via npm              | CLI + engine container            | .NET SDK                          |
| Backing                          | single maintainer; core `1.32`, cli `0.8.1` | Deno Land Inc.                 | npm/GitHub, since ~2010        | GNU, 35+ years              | Nrwl, 29.1k stars, Nx Cloud        | Vercel, 30.8k stars, MIT           | funded startup, 16.1k stars       | since ~2017, 3.7k stars           |

</div>

The rows Zuke was built to win are the first five and the three orchestration
ones. The two caching rows and the affected row are qualified rather than won:
Zuke's versions are **declaration-driven**, so they do only as much as the target
author told them to, where Nx's and Turborepo's are derived from the source. The
rows where it ties or loses — hosted caching, ecosystem, backing — are in the
table for the same reason: a comparison that concedes nothing is not worth
reading.

## `deno task`, npm scripts, and GNU Make

**Where Zuke differs most: a dependency is a reference, not a name.** In a
`deno.json` task the dependency is a string in a `dependencies` array; in npm
scripts there is no dependency field at all, only the `pre<name>`/`post<name>`
convention matched by string at run time — so a misspelled `pretest` is silently
never invoked, with no error anywhere. In a Zuke build the dependency is the
sibling field itself:

<!-- check -->

```ts
import { Build, run, target } from "jsr:@zuke/core";
import { DenoTasks } from "jsr:@zuke/deno";

class CI extends Build {
  lint = target().executes(() => DenoTasks.lint());

  test = target()
    .dependsOn(this.lint)
    .inputs("packages", "deno.json")
    .executes(() => DenoTasks.test((s) => s.allowAll()));
}

await run(CI);
```

`this.lint` is checked by `deno check` before the build ever runs, so a rename
moves every reference with it and a typo is a type error. On top of that, Zuke
validates the whole graph up front — unknown references, forward references to a
field declared lower in the class, and cycles are reported with the offending
target named, before any body executes. Make is the honourable exception among
the three: it resolves the entire prerequisite graph before running a single
recipe and stops with `No rule to make target X, needed by Y`. For `deno task`,
a cycle is rejected before execution, but whether a misspelled name *inside* a
`dependencies` array is caught before the run starts is not stated in Deno's
docs — treat it as unknown.

The second difference is how a command is built. All three of these write shell
strings: npm scripts hand the string to `/bin/sh` (or `cmd.exe` on Windows, with
the dialect differences that implies), Make hands each recipe line to `$(SHELL)`
in a fresh sub-shell, and `deno task` parses the string with Deno's own
cross-platform subset of `sh` — the same behaviour on every OS, which is a real
improvement, but still shell syntax written by hand. Zuke's
[tool wrappers](./tools.md) and [`$`](./shell.md) keep arguments a discrete array
from the settings lambda to `Deno.Command`, and interpolated values become single
argv entries rather than text spliced into a command line. Be precise about what
that buys: no shell ever parses the command, so there is **no shell-injection
surface** — a value containing `; rm -rf /` is passed through as one literal
argument. It does not make an interpolated value safe in general. A value
beginning with `-` still arrives as a **flag the invoked tool honours**, which is
argument injection, and validating that remains the caller's job — the same job
Zuke does for itself where it accepts one, as when `--affected` rejects a base
revision starting with `-` because git would read it as an option. Neither
`deno task`,
npm, nor Make documents a typed surface for a tool's flags; Zuke ships one per
tool, so `--allow-all` and `--coverage` are methods that either exist or fail to
compile.

**Where they are ahead of Zuke.** `deno task` is already installed with Deno and
costs nothing to learn, and since Deno 2.9 it has genuine opt-in incremental
caching: declare a `files` glob and Deno fingerprints the command, the matched
file contents, listed env values, dependency fingerprints and the host
OS/arch/Deno version, restoring declared `output` on a hit. That covers the
common "don't rebuild if nothing changed" case without a build system at all
(local only — there is no shared cache). npm scripts need no learning curve for
anyone already in the JS ecosystem and are backstopped by a large third-party
layer (`npm-run-all`, `concurrently`, and Nx or Turborepo above them). Make is
35+ years old, present on virtually every Unix box, and its timestamp-driven
rebuild model is its native purpose rather than a bolt-on. None of the three
documents cross-process suspend/resume, cancellation compensations, or an MCP
server — but for a project that needs none of those, "already installed" is a
strong argument.

## Nx and Turborepo

**Where Zuke differs most: there is no config file describing the pipeline.**
Nx declares wiring in JSON — `nx.json` for workspace-wide `targetDefaults`,
`project.json` (or an `nx` key in `package.json`) per project — with conventions
like `^build` meaning "this target in upstream dependencies first", and infers
project-to-project edges from source imports. Turborepo puts everything in
`turbo.json`, where a task is the *name* of a script that already exists in some
`package.json`; `turbo.json` declares scheduling and caching metadata around
that name and never touches the command. In Zuke the pipeline is the program:
dependencies are field references checked by the compiler, and the body is a
typed call rather than a script name resolved later.

That difference shows up in three places worth stating precisely:

- **When a bad reference is caught.** Both tools do catch one. Turborepo fails
  the whole run up front — `error preparing engine: Could not find the following
  tasks in project: [...]` — before any task executes, which is genuinely
  fail-fast. Nx raises `Cannot find configuration for task <project>:<target>`
  while constructing the task graph, and reports `task graph has a circular
  dependency` on a cycle; that happens before the task's process is spawned, but
  neither tool documents a static, type-level check of the reference, and
  Turborepo's task body is an arbitrary shell string in `package.json` that
  nothing checks at all. Zuke's equivalent errors are `deno check` failures in
  your editor.
- **What runs the tool.** Nx executors take an options object validated against
  each executor's `schema.json` at run time, and expose structured options
  (`tsConfig`, `outputPath`) rather than a raw command — real validation, but of
  configuration, not of a CLI's flags at compile time. How a given executor
  invokes its underlying tool is that plugin's implementation detail; Nx's docs
  state no tool-wide argv-versus-shell contract, so there is nothing to compare
  against Zuke's argv guarantee either way. Turborepo makes no claim here: the
  command is the shell string you wrote.
- **What happens when a pipeline has to wait.** Nx has continuous tasks
  (`continuous: true`, Nx 21+) and a documented recipe for starting a dependent
  once a long-running dependency prints output; Turborepo has `persistent` tasks,
  a `with` key to co-start them, and `turbo watch`. Both are same-invocation
  orchestration. Neither documents suspending a run to durable state and resuming
  it in a later process, nor cancellation that runs compensating actions. Zuke's
  [waits and resume](./orchestration.md) suspend the run to a state store, exit
  0, and resume — days later, in another process — with a compare-and-swap so
  concurrent resumers race and all but one get `AlreadyResumedError`. How far
  that guarantee reaches depends on the store: the default
  [`FileSystemStateStore`](./state.md#backends) is an atomic
  write-temp-then-rename guarded by an `O_EXCL` lock file, which makes it
  exactly-once **between processes on one host** — for exactly-once across
  machines you run the `HttpStateStore` service yourself, where ETags carry the
  compare-and-swap. Cancellation is
  [`.onCancel()`](./orchestration.md#cancellation--compensation--oncancel), which
  unwinds succeeded targets in reverse order.

**Where they are ahead of Zuke.** Considerably, on several axes:

- **Hosted caching and distribution.** Nx Cloud is a real hosted remote cache
  and distributed-execution product with a free tier; Vercel's Remote Cache is
  free on all plans, including for repos not deployed to Vercel, and Turborepo's
  remote caching is a capability of the open-source CLI itself. Neither charges
  for self-hosting either: Nx deprecated its four pre-built cache adapters
  (`@nx/s3-cache` and siblings) over the CREEP vulnerability
  ([CVE-2025-36852](https://www.cve.org/CVERecord?id=CVE-2025-36852)), a design
  flaw it says cannot be patched — not to move self-hosting behind a paywall —
  and its documented replacement is to implement the published **Nx remote cache
  OpenAPI specification** yourself, which costs nothing but hands you the whole
  threat model. So the difference here is not price. It is that Zuke's
  [remote cache](./caching.md#remote-build-cache) is **built into the build
  system** — an `HttpCacheStore` or a directory, chosen in typed code or by
  `ZUKE_REMOTE_CACHE_*`, with no separate product to adopt and no adapter to
  write — while Nx's answer is either a service you sign up for or a server you
  implement. Two qualifiers on Zuke's, though: it applies only to targets that
  declare **both `.inputs()` and `.outputs()`** — the inputs give the key, the
  outputs are what gets archived — so it does nothing for a target missing either;
  and like every Zuke cache it is **best-effort**, so an unreachable store logs a
  warning and the build silently falls back to building locally rather than
  failing. What Zuke does not have is a zero-setup option or an operated service
  behind it.
- **What the cache hash covers — and the trap that follows.** Nx and
  Turborepo hash a task's project files, its configuration and the command
  itself, so changing any of them is a miss. Zuke's fingerprint is narrower by
  design: it is the declared `.inputs()` plus any `.cacheKey()` values, and
  nothing else (see [Caching](./caching.md#what-unchanged-means)). Two
  consequences follow, and both are worth stating plainly. A target that declares
  neither inputs nor a
  cache key is **never cached** and always runs. And for one that does, editing
  the **target's own body**, or `zuke.ts` itself, does **not** invalidate a hit —
  Zuke will happily report `cached` for code you just changed unless you folded
  something that moves into a `.cacheKey()`. Nx and Turborepo do not have that
  hazard, because the command and config are in the hash. The upside of the narrow
  fingerprint is that it is explicit and deterministic across machines; the cost
  is that correctness is the author's to declare.
- **Affected-graph maturity, and a different kind of affected.** Both tools'
  hashing and affected computations are proven across very large monorepos; Nx's
  enterprise page claims Nx Enterprise is trusted by 70%+ of the Fortune 500.
  Zuke's `--affected` is not the same shape of feature: Nx and Turborepo derive
  the graph from **source imports**, so a change is traced to the projects that
  actually depend on the file without anyone declaring it. Zuke prunes purely on
  hand-declared `.inputs()`, and a target declaring none cannot be proven
  unaffected, so it always runs (see
  [`--affected`](./cli.md#affected-targets)) — on a build that declares no inputs
  anywhere, `--affected` prunes nothing at all. That is a real difference, and on
  this axis it is not in Zuke's favour: you get exactly the pruning you wrote
  down.
- **Agent integration is not a Zuke exclusive.** Nx ships an official, documented
  MCP server (`nx-mcp`) with tools for docs, workspace graph visualisation,
  project details, generator schemas, and CI data pulled from Nx Cloud, bundled
  with the Nx Console editor extension. It is shipped, not planned. Zuke's
  [`zuke mcp`](./mcp.md) exposes your build's own targets and graph as typed
  tools over stdio or streamable HTTP with no extra service, which is a different
  surface — not a larger one. Turborepo is the one gap here: an MCP server for it
  is an open discussion on its repo, not a feature.
- **Ecosystem and delivery.** Nx has polyglot plugins, code-mod generators, and
  editor integration built over years; Turborepo ships a precompiled Rust binary
  through platform-specific optional npm dependencies, so installing it pulls a
  native binary rather than a dependency tree.

Zuke is not trying to replace either inside a monorepo that is happy: it ships
[`@zuke/nx`](https://jsr.io/@zuke/nx) and
[`@zuke/turbo`](https://jsr.io/@zuke/turbo) wrappers for calling *into* them from
a target.

## Dagger

**Where Zuke differs most: the execution model, and what the graph is made of.**
A Dagger pipeline is a set of functions in a real language (Go, Python,
TypeScript, PHP, Java, .NET, Elixir, Rust) that execute as containers inside a
BuildKit-based engine; ordering is *inferred* from data flow between function and
container operations rather than declared, and cross-module dependencies are
installed with `dagger install` into `dagger.json`. A Zuke target declares its
dependencies explicitly and runs in-process — a `Deno.Command` subprocess when it
shells out — with no container runtime involved.

On the axes this page compares, the two are closer than the rest of the field.
Dagger's generated bindings mean a call to a function that does not exist is a
compile error in the host language, exactly like `this.lint`; and its
`Container.withExec(args)` takes a plain argv array, with the docs explicitly
warning that `["sh","-c","…"]` reintroduces shell interpretation and injection.
Zuke and Dagger are level here, and it is worth being exact about that rather
than claiming an edge: both keep the command an argv array so no shell parses it,
and neither validates argument injection for you — a value beginning with `-`
reaches the invoked tool as a flag in either system. Two real differences remain. First, Dagger has no per-tool typed flag surface:
you write the argv yourself, and the modules in its public registry that wrap
specific tools are user-contributed rather than a built-in guarantee — where Zuke
ships a maintained wrapper per tool whose settings mirror the actual CLI flags.
Second, nothing in Dagger's documentation describes checkpointing a run to
durable state and resuming it in a later process, waiting on an arbitrary
external event mid-pipeline, or running compensating actions on cancel;
cancellation appears in Dagger Cloud's trace UI as a state, not as a rollback
mechanism. Dagger also has no affected-projects selection at all — its caching
works at the level of individual container and filesystem operations.

**Where it is ahead of Zuke.** Dagger's container-per-step model gives every step
a hermetic environment, so "works on my machine" and "works in CI" are the same
run — Zuke has no isolation story and leaves reproducibility to you (pin your
tools, don't rely on host state). Its BuildKit engine caches operations
automatically rather than only where you declared `.inputs()`. It has eight
first-class SDKs to Zuke's one language, a public module registry for reusing
other people's pipeline logic, genuine LLM support (an `LLM` type that
auto-discovers Dagger Functions as callable tools, plus `LLM.withMCPServer` for
attaching external servers), and a funded company with a hosted product behind
it. The cost is a container runtime as a hard dependency and container startup on
every step; the benefit is isolation Zuke does not attempt.

## NUKE

[NUKE](https://github.com/nuke-build/nuke) is the direct precedent for Zuke's
design and gets credited as such in the
[acknowledgements](../README.md#acknowledgements): a build is a class, targets are
strongly-typed members, `DependsOn` takes a real member so a typo does not
compile, and external CLIs are driven through generated typed wrappers rather
than hand-written strings. Anyone who knows NUKE already knows Zuke's model.

**Where Zuke differs most: the ecosystem it runs in, and what the graph does
after it is built.** NUKE is .NET — installed as a tool from NuGet, needing the
.NET SDK, at home next to MSBuild and Rider. Zuke is the same architecture
targeting Deno: `jsr:`/`https:` specifiers with no separate package manager, the
`deno` CLI for test/format/lint/coverage, JSR for distribution. Beyond the
runtime, the difference is in the capabilities layered on top of the graph. Zuke
has an [incremental cache](./caching.md), a
[remote cache](./caching.md#remote-build-cache), and
[`--affected`](./cli.md#affected-targets), along with suspend/resume,
cancellation compensations, and an MCP server, none of which turned up in NUKE's
available documentation. Treat that as weak evidence rather than a gap, for one
specific reason: NUKE's request for target input/output specifications
([issue 209](https://github.com/nuke-build/nuke/issues/209), opened 2018) was
**closed as completed on 2019-11-19**, and with `nuke.build` unreachable during
this check there was no way to establish what shipped from it or what the
incremental-skip position is today. So this page does not claim NUKE lacks
target-level incremental skip — the row is `unknown`. Check NUKE's own docs
before assuming either way.

**Where it is ahead of Zuke.** Years, and everything years buy: a component
plugin ecosystem for shareable build logic, CI generation across multiple
providers with community conventions behind it, JetBrains-adjacent visibility,
and roughly 3.7k stars' worth of accumulated real-world usage in the .NET world.
It proves this architecture at a scale Zuke has not reached. Note that NUKE's own
documentation site did not resolve during the research behind this page, so its
entries here are corroborated from its GitHub repository and issues rather than
`nuke.build` directly — check its docs before treating any NUKE line above as
current.

## Choose something else when…

- **Your build is a handful of independent commands.** `lint`, `test`, `build`,
  no real graph between them, and nobody minds a `deno.json` `tasks` block —
  use `deno task`. Its 2.9 opt-in `files` caching even covers simple
  skip-if-unchanged. Do not adopt a build system to run three commands.
- **You have a large JS/TS monorepo already on Nx or Turborepo, with hosted
  caching working.** The overlap with Zuke is real but partial, and you would be
  trading a proven affected-graph, a zero-setup remote cache, generators and
  editor integration for a self-hosted cache and a younger tool. Stay, and call
  into your existing setup from Zuke only if you want the typed layer.
- **You need every step hermetic and portable across CI providers.** That is
  Dagger's core design — containerised steps, an engine you can run anywhere,
  operation-level caching — and Zuke does not attempt it.
- **Your pipeline is polyglot beyond TypeScript, or the team is not on Deno.**
  Dagger has eight SDKs; Zuke has one language and a Deno runtime requirement.
- **You are building .NET.** Use NUKE. It is the mature, native choice for that
  ecosystem, has the same model Zuke borrowed, and its plugin and CI-generation
  ecosystem is years ahead.
- **Your build really is file-to-file transformations on a Unix box.** Make has
  done exactly that correctly since before most of this list existed.
- **You need vendor support, a funded roadmap, or a hosted cache you don't
  operate.** Zuke has one maintainer and no service. That is the honest ceiling,
  and [Versioning & compatibility](./versioning.md) explains the stability
  promise each package makes within it.

---

**Checked:** competitor claims on this page were verified against official
documentation and public repositories on **2026-07-28**, against `@zuke/core`
1.32 and `@zuke/cli` 0.8.1. Version-specific facts as of that date: `deno task`
file-fingerprint caching from **Deno 2.9**; Nx continuous tasks from **Nx 21**,
with `nx-mcp` shipped; Turborepo remote caching in the OSS CLI with no MCP
server; Dagger Cloud as the paid tier for cross-machine caching.

Two rows were corrected against their primary sources on that date and are worth
citing precisely:

- **Nx self-hosted caching is not a paid feature.** Nx's deprecation notice for
  `@nx/s3-cache`, `@nx/gcs-cache`, `@nx/azure-cache` and `@nx/shared-fs-cache`
  ([nx.dev/docs/reference/deprecated/self-hosted-cache-packages](https://nx.dev/docs/reference/deprecated/self-hosted-cache-packages),
  deprecated 2026-05-21) gives the reason as the CREEP vulnerability
  ([CVE-2025-36852](https://www.cve.org/CVERecord?id=CVE-2025-36852)) — "The flaw
  is in their design and cannot be patched" — and its documented path for
  on-premises storage is to implement the Nx remote cache OpenAPI specification
  ([nx.dev/docs/kb/self-hosted-caching](https://nx.dev/docs/kb/self-hosted-caching)),
  where "Implementation is up to you" and no licence or subscription is required.
  Nx Cloud has a free tier. An earlier draft of this page described self-hosting
  as paid; it is not.
- **NUKE issue 209 is closed.**
  [nuke-build/nuke#209](https://github.com/nuke-build/nuke/issues/209) ("Input and
  output specifications for targets") was opened 2018-12-10 and closed as
  *completed* on **2019-11-19** — confirmed via the GitHub API, which reports
  `state: closed`, `state_reason: completed`. An earlier draft cited it as open
  since 2018 to support a claim that NUKE has no target-level incremental skip;
  that claim has been withdrawn and the row marked `unknown`.

Repository signals recorded on the same date: `nrwl/nx` 29.1k stars,
`vercel/turborepo` 30.8k, `dagger/dagger` 16.1k, `nuke-build/nuke` ~3.7k. NUKE
entries are corroborated from its GitHub repository and issues because
`nuke.build` still did not resolve at the time of checking, so nothing here rests
on NUKE's own documentation site. All of these move — re-check before relying on
a row.

# How Zuke compares

An honest comparison, including where Zuke is the wrong choice. Zuke is a
young, single-maintainer project (see the maturity note in
[Versioning & compatibility](./versioning.md)) — it does not have the
Cloud/plugin ecosystem of the more established tools below, and that's a real
tradeoff, not marketing copy.

## `deno task` (or `npm`/`package.json` scripts)

**When plain tasks are enough:** your project is a handful of independent
commands (`lint`, `test`, `build`) with no real dependency graph between them,
you don't need incremental skipping, and everyone on the team is comfortable
reading a `deno.json` `tasks` block. Don't reach for a build system to run
three commands — `deno task` (or the npm-script equivalent) is simpler,
has zero learning curve, and is already there.

**What typed dependencies, caching, and resume add once tasks stop being
independent:** a `tasks` block is a flat list of shell strings — it can chain
commands with `&&`, but it has no concept of *this target depends on that one*,
so ordering and skip-if-unchanged logic live in your head or in ad hoc shell
conditionals. Zuke gives you:

- **A real dependency graph.** `dependsOn(this.build)` is a compile-time
  reference; Zuke topologically sorts and only runs what's reachable.
- **Incremental skipping and `--affected`.** Declare `.inputs()`/`.outputs()`
  and Zuke skips a target whose inputs haven't changed, locally or via the
  [remote cache](./caching.md#remote-build-cache); `--affected=origin/main`
  narrows a run to what a diff can reach.
- **Resume and durable state.** A long-running or suspended build
  (`.waitsFor()`, a crashed CI runner) can be resumed rather than restarted
  from `deno task`'s stateless, one-shot-per-invocation model.

If you don't need any of that, a `tasks` block is the correct tool.

## Nx / Turborepo

Nx and Turborepo are mature monorepo orchestrators with **affected-graph
builds and remote caching** as their core value proposition — the same shape
of feature Zuke's `--affected` and remote cache provide, so there's real
overlap for a JS/TS monorepo already on one of them.

**Where they're more mature:** Nx Cloud (hosted remote cache and CI
distribution at scale), a large plugin ecosystem (generators, migrations,
editor/IDE integration), and years of production hardening across huge
monorepos. If you're already invested in an Nx or Turbo monorepo and it's
working, that investment is not a reason to switch.

**Where Zuke differs, not necessarily improves:**

- **No config DSL.** A Nx/Turbo pipeline is JSON (`nx.json`/`turbo.json`)
  describing task graphs by convention (`dependsOn: ["^build"]`); a Zuke build
  is a TypeScript class where dependencies are `this.<field>` references, so
  a typo or a stale rename is a compile error, not a graph that silently
  drops an edge.
- **Typed argv end to end.** Zuke's tool wrappers (`DenoTasks`, `DockerTasks`,
  …) build a real argv array with typed settings; Nx/Turbo mostly shell out to
  whatever script string you wrote, so the tool's actual flags aren't checked
  until the command runs.
- **Deno-native, not JS-tool-specific.** Nx and Turbo are built around a
  JS/TS package graph (workspaces, `package.json`); Zuke has no notion of a
  package graph at all — a target is just code, so it fits equally well
  driving Docker, Terraform, or a Python script as it does a `deno` build.
  (Zuke even ships [`@zuke/nx`](https://jsr.io/@zuke/nx) and
  [`@zuke/turbo`](https://jsr.io/@zuke/turbo) wrappers, for calling *into*
  Nx or Turbo from a Zuke target rather than replacing them.)

**When NOT to use Zuke instead of Nx/Turbo:** a large existing JS/TS monorepo
with Nx or Turbo already wired to CI, using Nx Cloud/Turbo remote cache at
scale, and leaning on generators or editor plugins for day-to-day dev — Zuke
has no equivalent ecosystem today.

## Dagger

Dagger runs your pipeline as a graph of **containerized** steps, portable
across CI providers because each step is a container with cached layers —
the pipeline itself becomes a portable, containerized artifact.

**The real difference is the execution model, not the language:** Dagger
steps run in containers by design, giving you strong isolation and
byte-for-byte reproducibility (and layer caching) at the cost of container
startup overhead and a container runtime as a hard dependency. A Zuke target
runs **in-process** (a `Deno.Command` subprocess when it shells out) — faster
to iterate on locally, no container runtime required, but you own
reproducibility yourself (pin your tool versions, don't rely on host state).

**When NOT to use Zuke instead of Dagger:** you need the pipeline itself to be
portable across CI providers as a single artifact, or you specifically want
every step sandboxed in its own container — that's Dagger's core design, not
a Zuke feature.

## NUKE

[NUKE](https://nuke.build/) is Zuke's direct inspiration and closest relative
in *shape*: a build is a C# class, targets are members, dependencies are
typed. If you already know NUKE, Zuke will feel immediately familiar.

**The difference is the ecosystem it lives in:** NUKE is .NET — MSBuild-aware,
NuGet-native, with mature IDE tooling (Rider/Visual Studio) built up over
years. Zuke is the same idea ported to Deno/TypeScript — Deno-native module
resolution (`jsr:`/`https:` specifiers, no separate package manager), the
Deno toolchain for everything (test runner, formatter, linter, coverage), and
JSR for distribution instead of NuGet.

**When NOT to use Zuke instead of NUKE:** you're building a .NET project.
Use NUKE — it's the mature, native choice for that ecosystem, and the reason
this project credits it as [an inspiration](../README.md#acknowledgements)
rather than a competitor.

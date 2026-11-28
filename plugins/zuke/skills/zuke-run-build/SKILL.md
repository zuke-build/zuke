---
name: zuke-run-build
description: Run, inspect and troubleshoot an existing Zuke build — the code-first build system for TypeScript, on Node or Deno. Use when running targets or the default build, previewing a plan, listing targets, reading run records, resuming or cancelling a run, serving the build to an AI client over MCP, or diagnosing a failed or misbehaving build. To add or change targets use zuke-write-build; to scaffold Zuke into a project use zuke-setup.
---

# Run, inspect and troubleshoot a Zuke build

> Every command and flag below is in `zuke --help` and `zuke <command> --help`;
> they are the source of truth for the version the project runs.

## Running the build

Run the build with the global `zuke` command, from any directory inside the
project. If `zuke` is not on `PATH`, install it first with `npm install -g
@zuke-build/cli`, or run the project's `./zuke` launcher instead.

```sh
zuke                      # run the default target
zuke <target>             # run a specific target
zuke --list               # list every target
zuke --list --json        # the whole build surface (commands, flags, targets) as JSON
zuke <target> --dry-run   # print the plan without executing
zuke <target> --no-banner # no opening banner (also ZUKE_NO_BANNER)
zuke <target> --plain     # plain: no banner or colour (also ZUKE_PLAIN)
```

Every run opens with a banner: the Zuke wordmark, then `zuke <version> ·
<runtime> <version> · <platform>` and `run <id> · <cwd>`. On CI the wordmark is
dropped — the identifying lines are what a runner log wants, six lines of ASCII
are not — and the detected host is appended to the first line. `--no-banner` or
`ZUKE_NO_BANNER` turns it off entirely. On an interactive terminal `--version`,
`--help`, `--list` and `graph` print a rich, coloured form; `--plain` or
`ZUKE_PLAIN=1` asks for plain output everywhere (no banner or colour,
undecorated informational commands), and output is plain automatically on CI and
through a pipe, so `zuke -- --version | …` is always the bare version of Zuke
the build runs on (`zuke --version` alone also reports the CLI's).

The bare `zuke` works from anywhere inside the project: `zuke <target>`, `zuke
--list`, `zuke graph`, `zuke mcp`, bare `zuke` for the default target — every
command that is not the CLI's own (`setup`, `import`, `doc`) is forwarded to the
nearest `build.ts`. `--help` and `--version` show both surfaces, the CLI's and
then the build's, each labelled; `zuke -- --help` is the build's own usage
alone, and `zuke -- <target>` reaches a target that shares one of those names.
It walks up to the `zuke.json` that marks the repository root and runs the
executable `./zuke <args>` launcher there, so a project's customised launcher
(pinned Deno, exported env, a lock outside the repo) applies to `zuke` too. With
no executable launcher (and on Windows) it runs `node build.ts <args>` for a
Node project, and `deno run -A build.ts <args>` for a Deno one, with `--frozen`
once a `deno.lock` exists. Outside a project, `zuke <target>` reports the
unknown command and the missing `zuke.json`, and a bare `zuke` prints the usage.
The forwarding refuses a project whose root directory is owned by another user
or is world-writable, and one where an ancestor `deno.json`, `deno.jsonc` or
`package.json` Deno would read is owned by another user (the `safe.directory`
rule git applies, since discovery runs code the caller never named); the error
names what was refused and the fix — run that project's own `./zuke` there, or
fix the ownership. On Windows the gate is inert.

The CLI is self-describing: `zuke --help` prints the usage grammar plus the
build's live targets and parameters, so an agent discovers the real command
surface instead of guessing. For an AI client to operate the build through typed
calls, `zuke mcp` runs a Model Context Protocol server over it (register with
`claude mcp add zuke -- node build.ts mcp`, or `-- deno run -A build.ts mcp` on
Deno; add `--allow-run` to let the agent execute targets, not just inspect
them).

A Deno project's scaffolded `deno.json` also carries a `zuke` task (`deno task
zuke <target>`), but it is not quite equivalent: it deliberately omits
`--frozen`, so it may heal a stale lockfile where `zuke` would fail on it.
Prefer `zuke`.

On a machine without the CLI — a CI runner — the committed `./zuke` launcher
(`zuke.ps1` on Windows) installs Node (or Deno) and runs the build, which is why
generated CI workflows call `./zuke <target>`.

## Commands

```sh
zuke --list                   # all targets
zuke --list --json            # whole surface (commands, flags, targets) as JSON
zuke <target> --dry-run       # preview the plan, run nothing
zuke <target>                 # run it
zuke <target> --parallel[=N]  # run independent targets concurrently (N caps in-flight)
zuke <target> --affected[=<base>]
                              # only targets changed since a git base (default HEAD)
zuke <target> --skip <dep>    # run it but skip a named dependency (repeatable)
zuke <target> --no-cache      # ignore the incremental cache
zuke <target> --no-banner     # no opening banner (also ZUKE_NO_BANNER)
zuke <target> --plain         # plain: no banner or colour (also ZUKE_PLAIN)
zuke <target> --state         # persist run state to .zuke/runs (durable state)
zuke <target> --actor <who>   # attribute the run in its state record
zuke runs list [--status s]   # list persisted runs (also --target, --since, --limit, --counts, --json)
zuke runs show <id>           # one run's full per-target status (+ --json)
zuke runs prune --keep 90d --keep-last 50
                              # delete old terminal runs (--dry-run to preview)
zuke graph [--output=html] [--no-open]
                              # print the dependency graph, or render it interactively
zuke generate-ci [--check]    # write the declared CI workflow files (--check verifies instead)
zuke completions install bash
                              # wire target/flag completion into your shell (or `print`)
zuke resume <id> --signal <name> [--data <json>]
                              # continue a suspended run
zuke resume --check           # reap abandoned runs, then re-check suspended ones (cron entry point)
zuke resume <id> --resume-degraded
                              # continue past a degraded record (a state write was lost)
zuke cancel <id>              # cancel a run and run its .onCancel() compensations
zuke mcp [--allow-run]        # serve the build over MCP for an AI client (stdio)
zuke mcp --http 7777          # ...or over HTTP (loopback; token off-loopback; Origin-guarded)
zuke mcp --http 7777 --allowed-origin https://app.example
                              # permit an extra browser Origin
zuke mcp --allow-run=deploy,checks* --protect deploy --confirm-destructive
                              # authz tiers: allow-list, operator token, confirm
zuke runs show mcp-audit      # the MCP tool-call audit trail (host only, not served over MCP)
zuke register [--json]        # record this build in the build registry (idempotent)
zuke doc deno                 # print a package's API (deno doc, so Deno) from an isolated empty dir
                              # A bare name takes the @zuke scope, @scope/pkg takes
                              # the scheme, a path (./m.ts, src/m.ts, m.ts) is resolved
                              # against your cwd, and jsr:/npm:/https: pass through.
zuke --version                # the CLI's version, then the build's Zuke version, labelled
zuke -- --version             # only the Zuke version this build runs on, bare
zuke <command> --help         # a command's own usage, detail and flags
                              # (--help alone lists what exists, one line each)
zuke outdated [--exit-code]   # jsr packages the lock resolves behind their latest (network)
zuke outdated --update        # ...and move them up; name packages to narrow it.
zuke outdated --min-dep-age 0
                              # count releases Deno's 24h age guard would refuse (also passed to --update)
zuke outdated --update --entrypoint other/build.ts
                              # re-resolve another graph sharing the lock too
                              # Touches the lock only: a package its specifier
                              # pins is reported as held, never rewritten.
                              # --exit-code exits 1 when behind OR uncheckable.
                              # Wire it as a SCHEDULED pipeline, never in the ci
                              # gate: it needs the network, and a dependency's
                              # release would redden unrelated PRs.
zuke mcp --registry --allow-run
                              # serve the registry: registered builds as tools, spawned
zuke mcp --registry --max-concurrent-runs 4
                              # cap concurrent run-tool spawns (default 4)
```

**Forcing a target**
([`docs/state.md`](https://github.com/zuke-build/zuke/blob/master/docs/state.md)):
`zuke force <run-id> <target> --outcome skipped|succeeded [--reason "…"]`
settles one target of a live run **without running its body** — ahead of its
`onlyWhen` conditions and its cache — and records who decided and why under
`record.overrides`. A forced `succeeded` is compensated by a later cancel (its
effects were asserted to exist); a forced `skipped` is not. Refused for a target
that already settled, a terminal run, or one the build protects with `override
unforceable() { return [this.applyProduction]; }` — target **references**, so a
rename cannot silently empty the list. The MCP equivalent is the `force_target`
tool.

**Caching:** a target with `.inputs(...)`/`.outputs(...)` is incremental
(skipped and reported `cached` when inputs are unchanged and outputs exist). Add
a **remote store** to share results across machines — a fresh CI checkout or a
teammate's clone restores outputs instead of rebuilding; `--no-remote-cache`
uses the local cache only. Declare one with `override remoteCache()` on the
`Build` (returning `FileSystemCacheStore`, `HttpCacheStore` — bearer token or
any headers, an Azure SAS URL works as is — `S3CacheStore` for any S3-compatible
bucket, or `GitHubActionsCacheStore`), or leave it and the executor falls back
to the `ZUKE_REMOTE_CACHE_*` environment variables (`ZUKE_REMOTE_CACHE_S3_URL`
plus the `AWS_*` variables for a bucket) — or, on GitHub Actions, to the job's
own cache service once `cicd({ pipeline: { bootstrap: { actionsCache: true } }
})` (the action's `actions-cache` input) exports its credentials to the job; it
applies only to targets declaring **both** `inputs` and `outputs`. A remote
store is best-effort — an unreachable one never fails the build. A **restore is
confined to the target's declared `.outputs(...)`**, and refuses an absolute or
`..` path, a directory entry, a symlink whose target leaves its output, and
anything under `.git`/`.zuke` (except `.zuke/tools`, the toolchain's install
root). A relative link inside an output (`node_modules/.bin/*`) round-trips as a
link, so `.outputs("node_modules")` caches; a refused archive is a cache miss
(rebuild + warning), never a build failure, so whoever can write the store can
neither plant files nor halt the build. `--affected` limits a run to targets
touched since a git base (great for CI job fan-out).

## When something fails

Start with `zuke --list` and `zuke <target> --dry-run`; with durable state on,
`zuke runs show <id>` shows each target's status. Then read
[`references/troubleshooting.md`](references/troubleshooting.md), which goes
from an error message or symptom to its cause and fix.

## Serving the build to an AI client

`zuke mcp` and the build registry are in
[`references/mcp.md`](references/mcp.md): the authorization tiers, roles,
authentication, and the registry's launch rules. Read it before exposing a build
over MCP.

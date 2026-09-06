# CLI reference

"zuke" names **two different programs**, and this reference is split to match:

- **The global `zuke` CLI** (`jsr:@zuke/cli`, installed once with
  `deno install -A -g -n zuke jsr:@zuke/cli`) only scaffolds and inspects
  projects — `setup`, `import`, `doc`, `--help`, `--version`. It never runs a
  target.
- **Your build's own CLI** — reached via the `./zuke` launcher (or
  `deno run -A zuke.ts`) that `zuke setup`/`zuke import` drop into your repo —
  is what runs targets and everything else: `graph`, `--list`, `generate-ci`,
  `completions`, `mcp`, `resume`, `runs`, `cancel`, `register`, its own `doc`.

If a command isn't in the first table, it belongs to the second one — run it
with `./zuke <command>`, not the bare `zuke` you installed globally.

## The global `zuke` CLI (`jsr:@zuke/cli`)

| Command                    | Behaviour                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| `zuke setup [options]`      | Scaffold a starter `zuke.ts`, the `./zuke`/`zuke.ps1` launchers, `deno.json`, and `zuke.json` into a directory. See [Getting started](./getting-started.md#scaffold-a-project-with-zuke-setup). |
| `zuke import [options]`     | Generate a `zuke.ts` with one target per `package.json` script or Makefile target, plus the same scaffolding as `setup`. See [Getting started](./getting-started.md#migrate-an-existing-project-with-zuke-import). |
| `zuke doc <package>`        | Print a `@zuke/*` package's API (`zuke doc core`, `zuke doc @scope/pkg`, or a `jsr:`/`npm:`/`https:` spec as-is) via an isolated `deno doc`. |
| `zuke --help` / `-h`        | Usage.                                                                                                    |
| `zuke --version` / `-V`     | Print the installed `@zuke/cli` version.                                                                 |

`setup` and `import` share `--dir <path>`, `--name <Class>`, `--force`/`-f` and
`--yes`/`-y`. `--launcher-name <name>` (for when a `zuke/` directory already
occupies the launcher's name) applies to `setup` only; `import` additionally takes
`--from <package.json|makefile>` to pin the source instead of auto-detecting
it. Both finish by scaffolding the launchers and `deno.json`, so the very next
command you run is your build's own CLI, `./zuke`.

## Your build's CLI (`./zuke` / `deno run -A zuke.ts`)

Everything below runs *your build* — the `zuke.ts` in your project, driven
through the `./zuke` (or `.\zuke.ps1`) launcher or directly with
`deno run -A zuke.ts`. Shell completions (see [`./zuke completions`](#zuke-completions)
below) attach to whichever launcher word you install them for.

| Command                                                                 | Behaviour                                                                                                   |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `./zuke <target>`                                                       | Run the target and all its transitive dependencies, in order.                                               |
| `./zuke <target> --skip <dep>`                                          | Run the target but skip the named dependency (repeatable).                                                  |
| `./zuke <target> --parallel`                                            | Run independent targets concurrently (`--parallel=N` caps it).                                              |
| `./zuke <target> --no-cache`                                            | Ignore the incremental cache; re-run every target.                                                          |
| `./zuke <target> --affected[=<base>]`                                   | Run only targets affected by files changed since a git base.                                                |
| `./zuke <target> --dry-run`                                             | Print the plan without executing any target body.                                                           |
| `./zuke <target> --state`                                               | Persist [durable run state](./state.md) under `.zuke/runs`.                                                 |
| `./zuke <target> --actor <name>`                                        | Attribute the run to `<name>` in its state record.                                                          |
| `./zuke --list` / `-l`                                                  | List all targets with descriptions and dependencies.                                                        |
| `./zuke --list --json`                                                  | Print the whole build surface (commands, flags, targets, parameters) as JSON.                               |
| `./zuke graph`                                                          | Print the dependency graph (`target → deps`).                                                               |
| `./zuke graph --output=html [--no-open]`                                | Render an interactive HTML graph into `.zuke/` and open it (`--no-open` writes it without launching a browser). |
| `./zuke completions print <shell>`                                      | Print a shell-completion script (`bash`, `zsh`, or `fish`).                                                 |
| `./zuke completions install <shell>`                                    | Write the script and wire it into the shell's startup.                                                      |
| `./zuke generate-ci [--check]`                                          | Write the declared CI workflow files (`--check` verifies they are up to date instead of writing).           |
| `./zuke mcp [--allow-run[=<globs>]] [--http <host:port>]`               | Run an MCP server over the build for AI agents, on stdio or HTTP ([details](./mcp.md)).                     |
| `./zuke mcp --registry [--max-concurrent-runs <n>]`                     | Serve the [build registry](./registry.md) instead of this build — every registered pipeline as a tool.       |
| `./zuke mcp --http <host:port> --allowed-origin <origin>`               | Permit one extra browser `Origin` on the HTTP transport (loopback is always allowed).                        |
| `./zuke resume <id> [--signal <n>] [--data <json>]`                     | Resume a suspended run, optionally delivering a signal ([details](./orchestration.md)).                     |
| `./zuke resume --check [<id>]`                                          | Reap abandoned runs, finish stranded cancellations, then re-check suspended runs (predicate waits, timeouts). |
| `./zuke resume <id> --resume-degraded`                                  | Continue a resume whose record is degraded (a state write was permanently lost).                            |
| `./zuke runs list [--status] [--target] [--since] [--limit] [--counts] [--json]` | List persisted run records (or `--counts` for a status tally), newest first ([details](./state.md)).        |
| `./zuke runs show <id> [--json]`                                        | Show one run's full per-target status and metadata.                                                         |
| `./zuke runs prune [--keep <age>] [--keep-last <n>] [--dry-run]`        | Delete old terminal run records; never touches non-terminal runs.                                           |
| `./zuke cancel <id> [--actor <name>]`                                   | Cancel a run and run its compensations ([details](./orchestration.md#cancellation--compensation--oncancel)). |
| `./zuke register [--actor <name>] [--json]`                             | Register this build in the build registry (`--json` prints the written descriptor).                         |
| `./zuke doc <spec>`                                                     | Print a package's API docs (`deno doc <spec>`) from an isolated empty directory.                            |
| `./zuke outdated [--exit-code]`                                         | Report the JSR packages the lock resolves behind their latest release (needs the network).                  |
| `./zuke --help` / `-h`                                                  | Usage.                                                                                                      |
| `./zuke` (no target)                                                    | Run the `default` target if defined, else print `--list`.                                                   |

An unrecognised `--flag` is a **hard error**: Zuke names it, suggests the nearest
known flag when one is within two edits (`--dry-rn` → `--dry-run`), and exits `1`
without running anything. A typo used to be silently ignored, which meant
`--dry-rn` ran the build for real. The same applies to an unknown target name.
`--help` still wins when it appears alongside a bad flag, a bare `--` separator is
skipped, and a built-in given an inline value it does not accept (`--skip=lint`)
is told to pass the value as the next argument instead.

## `zuke graph`

Shows the build's dependency graph. By default it prints the terminal adjacency
listing (`target → deps`). With `--output=html` it renders the graph as an
interactive [Cytoscape](https://js.cytoscape.org/) diagram inside a
self-contained HTML page, writes it to `<repo root>/.zuke/graph.html`, and opens
it in your default browser. The repo root is located via the
[`zuke.json`](./paths.md#repo-root-reporoot) config file (falling back to the
current directory). Nodes are colour-coded by dependency depth (roots through
leaves) on a dark, glow-accented canvas. The page is interactive: pan and zoom
freely, **click a target** to highlight everything it connects to — its
transitive dependencies and dependents — and click the background (or **Reset**)
to clear the selection. Cytoscape loads from a pinned CDN, so the first view
needs internet access.

Targets in a [`group()`](./authoring.md#group-and-partof) are drawn inside a
labelled box (a Cytoscape compound node); the text listing tags them
`[group: name]`.

| Option          | Behaviour                                                  |
| --------------- | ---------------------------------------------------------- |
| `--output=html` | Render the interactive HTML page instead of terminal text. |
| `--no-open`     | With `--output=html`, write the file without opening it.   |

`graph` is a reserved command name: a target called `graph` can't be run by
name.

**Output:** each target prints `▶ name` on start, then `✔ name (1.2s)` or
`✘ name (0.4s)`. A failure prints the error, aborts the remaining targets, and
exits `1`. A final summary lists every target's status and duration plus the
total. Under GitHub Actions, targets become collapsible log groups, failures
emit `::error::` annotations, and the summary is written to the job summary.

## `zuke completions`

`./zuke completions` takes an explicit sub-action — `print` or `install` —
then a shell (`bash`, `zsh`, or `fish`). `print` writes the completion script
to stdout; the script completes the build's target names, the reserved
commands (`graph`, `generate-ci`, `completions`, `mcp`, `resume`, `runs`,
`cancel`, `register`, `doc`), the built-in option flags, and any declared
[parameters](./parameters.md) as `--flag` candidates. Unlisted targets
(`.unlisted()`) stay hidden, just as they are in `--list`.

Source the printed script for the current shell:

```sh
# bash — current shell, or append to ~/.bashrc
source <(./zuke completions print bash)

# zsh — current shell, or write to a file named _zuke on your $fpath
source <(./zuke completions print zsh)

# fish — current shell, or save to ~/.config/fish/completions/zuke.fish
./zuke completions print fish | source
```

The script is a static snapshot of the build it was generated from, so
regenerate and re-source it when you add, rename, or remove targets — the same
model as `deno completions`. A missing or unknown sub-action or shell prints a
usage line and exits `1`. `completions` is a reserved command name: a target
called `completions` can't be run by name. The printed script registers the
completion against the words `zuke` and `./zuke`, so both of those forms
complete. `deno task zuke <target>` does not: a shell picks the completion from
the first word of the line, which is `deno` there — invoke the launcher
directly when you want completion.

### Installing

`./zuke completions install <shell>` does the wiring for you: it writes the
script to a file under your config directory and makes the shell load it on
the next start — no manual `source` step.

- **bash** → writes `~/.config/zuke/completions/zuke.bash` and appends a
  `source` line to `~/.bashrc`.
- **zsh** → writes `~/.config/zuke/completions/zuke.zsh` and appends a `source`
  line to `~/.zshrc`.
- **fish** → writes `~/.config/fish/completions/zuke.fish`, which fish loads
  automatically (no rc edit).

The config directory honours `$XDG_CONFIG_HOME`. Installing is idempotent: if
the rc file already sources the script, it is left untouched. The reserved
commands and option flags offered by completion come from a single registry
shared with the parser and `--help`, so they never drift out of sync.

## `zuke mcp`

Runs a [Model Context Protocol](https://modelcontextprotocol.io) server over the
build on stdio, so an AI agent can operate the pipeline through typed tool calls
instead of guessing shell commands. It exposes read tools (`list_targets`,
`describe_build`, `graph`, plus `list_runs`/`show_run` when a state store
resolves) and — only with `--allow-run` — one `run:<target>` tool per target
(plus `signal_run`, `resume_check` and `cancel_run`). Authorization tiers layer
on: `--allow-run=<globs>` limits which targets may be **invoked**, `--protect
<globs>` requires a `ZUKE_OPERATOR_TOKEN` for any run whose **plan** touches a
matching target, and `--confirm-destructive` makes a destructive run return its
plan until called with `confirm:true`. Every mutating or denied call is written
to an audit trail, readable on the host with `./zuke runs show mcp-audit` and
deliberately not served over MCP.

`--http <host:port>` serves the streamable-HTTP transport instead of stdio
(loopback by default; a non-loopback bind must authenticate its callers — a
`ZUKE_MCP_TOKEN` bearer token, or an authenticator declared with
[`mcpAuth()`](./mcp.md)), and `--allowed-origin <origin>` permits one extra
browser origin.
`--registry` serves the [build registry](./registry.md) instead of this build —
every registered pipeline becomes a `run:<buildId>:<target>` tool, spawned in
its own process, with `--max-concurrent-runs <n>` capping how many run at once
(default 4). `mcp` is a reserved command name. See the full guide:
[MCP server](./mcp.md).

## `zuke doc` (the build's own)

`./zuke doc <spec>` prints a package's API by running `deno doc <spec>` (e.g.
`./zuke doc jsr:@zuke/deno`) — but from a fresh empty directory instead of the
current one. Run inside a Node repository, a bare `deno doc jsr:@zuke/...`
resolves the repo's `node_modules/@types/*` and buries the API under dozens of
`Failed resolving types …` warnings; the isolated empty working directory has
nothing to resolve, so the output is just the API. Any relative file path
(`./zuke doc ./mod.ts` or `./zuke doc mod.ts`) is resolved against the real
working directory before the isolated `deno doc` runs; `jsr:`/`npm:`/`https:`
specifiers and absolute paths are passed through unchanged. `doc` is a
reserved command name. (This complements the generated
[`llms-full.txt`](../llms-full.txt) and each package's README `## API` block.)

This is a different command from the global `zuke doc` above: the global one
takes a bare package name (`zuke doc core`) and resolves it to `jsr:@zuke/core`
for you; the build's own `./zuke doc` needs the full spec (or a relative
path), since it is just another reserved command on your build's CLI.

## `zuke outdated`

`./zuke outdated` compares the versions your `deno.lock` resolves for every
`jsr:` specifier against the latest each package publishes, and prints the ones
that are behind:

```text
@zuke/git     1.5.0  →  1.11.0
@zuke/gcloud  1.1.0  →  1.3.0

2 packages are behind. Refresh the lock with a plain `deno cache --reload` …
```

It exists for the case nothing else covers. A build whose specifiers are
written inline — `jsr:@zuke/git@^1` in `zuke.ts` and its helper modules, rather
than in a `deno.json` imports map — gets no signal from `deno outdated`, which
reads manifests. The lock keeps resolving the versions recorded when the build
was written, and `--frozen` is content with that, because a stale-but-valid
lock is exactly what `--frozen` is for. A build can therefore sit several minor
versions behind a wrapper for months, still hand-rolling a command the package
has since typed.

The **lock** is what it reads, not the import map: the lock records what a run
actually resolves, which is the number a stale pin hides.

A package the registry cannot answer for — a private scope, a rename, an
offline runner — does not fail the whole report, but it *is* named in it:

```text
1 package could not be checked:
  @private/thing (1.0.0) — error sending request
```

That distinction is the point. A run behind a proxy that reached nothing at all
would otherwise print "every package is at its latest release", which is the
confident wrong answer this command exists to prevent. A missing lock file is
an outright error, for the same reason.

`--exit-code` makes it exit `1` when anything is behind **or** could not be
checked — a gate asking "are we current?" has not been told yes by a run that
never got an answer. Without the flag the command is a report and always exits
`0`.

It needs the network, which is why it is a command you run rather than a line in
`--list` or the run summary: those stay offline and instant. `outdated` is a
reserved command name.

Two things about refreshing the lock afterwards, because the obvious move is
wrong. In a repo that also has a `package.json`, `deno cache` resolves the whole
npm tree and writes an `npm` section a jsr-only lock never had. And
`--reload=jsr:` re-resolves from cached registry metadata, handing back the same
stale versions — only a bare `--reload` actually re-resolves.

## Parallel execution

By default targets run one at a time in a deterministic order. `--parallel` runs
independent targets concurrently while still completing every dependency before
its dependents; `--parallel=N` caps the number in flight (the default is the
host's CPU count). Each target's banner block is buffered and flushed as a unit,
so concurrent runs don't interleave their headers (a target's own subprocess
output may still interleave, as with `make -j`). The first failure stops new
launches; targets already running finish, and the rest are reported as skipped.
The build summary stays in declaration order regardless.

Programmatic callers get the same behaviour via
`execute(build, target, { parallel: true })` (or a number) — see the
[programmatic API](./programmatic-api.md).

For parallelism scoped to specific targets rather than the whole build, put them
in a [`group()`](./authoring.md#group-and-partof) with `.partOf(...)` — the
group's members run concurrently even without `--parallel`.

## Incremental builds

Targets that declare
[`.inputs()`](./authoring.md#incremental-caching--inputs--outputs) are cached:
Zuke skips one (showing it `cached` in the summary) when its inputs are
unchanged since the last successful run and its outputs still exist.
Fingerprints live in `.zuke/cache.json`. `--no-cache` ignores the cache and
re-runs everything.

## Remote cache

The incremental cache is local. A **remote cache** shares a target's built
[`.outputs()`](./authoring.md#incremental-caching--inputs--outputs) across
machines: on a local miss, Zuke **restores** the outputs from the store instead
of rebuilding them; after a successful run it **uploads** them for the next
machine. It applies to targets that declare both `inputs` and `outputs`, and is
keyed by the same input fingerprint the local cache uses. A store outage is
never fatal — Zuke logs a warning and falls back to a local rebuild.

Two dependency-free backends ship, behind one `RemoteCacheStore` interface:

- **`FileSystemCacheStore`** — a shared or mounted directory (an NFS mount, a CI
  volume). Archives are `<dir>/<key>.tar.gz`.
- **`HttpCacheStore`** — `GET`/`PUT <url>/<key>` with an optional bearer token.
  Works with any object store or cache server behind a URL (an S3/GCS/R2 bucket,
  or a self-hosted endpoint).

Declare one in code with a typed `remoteCache()` override:

```ts
import { Build, HttpCacheStore, parameter, target } from "jsr:@zuke/core";

class CI extends Build {
  cacheToken = parameter("Cache auth token").secret().env("CACHE_TOKEN");
  override remoteCache() {
    return new HttpCacheStore({
      url: "https://cache.example.com",
      token: this.cacheToken.value,
    });
  }
  build = target().inputs("src").outputs("dist").executes(/* … */);
}
```

Or configure it from the environment (no build-file change) — handy for CI:

```sh
ZUKE_REMOTE_CACHE_URL=https://cache.example.com ZUKE_REMOTE_CACHE_TOKEN=… ./zuke ci
ZUKE_REMOTE_CACHE_DIR=/mnt/zuke-cache ./zuke ci     # filesystem backend
```

Precedence is: an explicit `execute({ remoteCache })` option, then the build's
`remoteCache()` override, then the `ZUKE_REMOTE_CACHE_*` environment variables.
`--no-remote-cache` uses the local cache only for a run; `--no-cache` disables
both.

> **Note:** archive entry names use the POSIX `ustar` format (a 100-byte path
> limit), so extremely deep output paths are rejected with a clear error.

**Security.** The store URL and token are trusted configuration — outputs are
uploaded there and archives are extracted from it — so point them only at a
cache you control (a secret parameter or env var, not a hard-coded value), and
on CI restrict egress to the cache host so an overridden URL can't exfiltrate
artifacts. Restore is hardened against a poisoned store: an archive entry with
an absolute path or one containing `..` is rejected before any file is written,
so nothing lands outside the workspace.

## Affected targets

`--affected` restricts a run to the targets that a set of file changes can reach
— the monorepo-scale complement to the incremental cache. Zuke asks git for the
files changed since a base revision and keeps only the **affected** targets; the
rest are skipped (their prior outputs are assumed current, so a skipped
dependency still unblocks its dependents).

```sh
./zuke ci --affected                 # vs HEAD (uncommitted changes)
./zuke ci --affected=origin/main     # vs a base branch — the usual CI form
```

A target is affected when a changed file falls inside one of its declared
[`.inputs()`](./authoring.md#incremental-caching--inputs--outputs), **or** when
any of its dependencies is affected (affectedness flows downstream along
`dependsOn` and `triggers`). A target that declares **no** inputs can't be
proven unaffected, so it is always run — declare `inputs` on the targets you
want `--affected` to be able to skip. The base defaults to `HEAD`; pass
`--affected=<ref>` for any git revision (e.g. `origin/main`, a tag, or `main...`
for a merge-base comparison). Programmatic callers pass `{ affected: { base } }`
to `execute`, optionally with a `changedFiles` seam in place of git.

## Dry runs

`--dry-run` resolves the plan and reports every target that **would** run —
honouring `--skip` and each target's `onlyWhen` condition — without executing
any body or reading/writing the cache. Each planned target prints a
`(dry run — not executed)` line, and the summary reflects what would have run.
Programmatic callers pass `{ dryRun: true }` to `execute`.

## Durable run state

`--state` persists a versioned record of the run — its status, the graph it ran,
resolved non-secret parameters, and per-target progress — under `.zuke/runs`, so
it can be reconstructed after the process exits. `--actor <name>` labels who ran
it (else `ZUKE_ACTOR`, the CI actor, or `"anonymous"`). Both are no-ops if a
store is already configured via `ZUKE_STATE_URL` / `ZUKE_STATE_DIR` or the
build's `stateStore()` override. A plain run with none of these writes nothing.
See [Durable run state](./state.md) for the record shape, `ctx.state`, the
pluggable backends, and the [HTTP API](./state-api.md) for hosting a production
store.

## Resuming suspended runs

A run parked at a [`.waitsFor()`](./orchestration.md) gate is continued with
`./zuke resume`. `--signal <name>` delivers a named external signal (with an
optional `--data <json>` payload); `--check [<run-id>]` is the cron/webhook entry
point and makes three passes — it **reaps abandoned runs** (a `running` record
whose [lease](./locks.md) can be acquired belongs to a dead process, so it is
returned to `suspended` and resumed in the same sweep, or settled `failed` with
its compensations if it is past the build's [`deadline()`](./state.md)), then
finishes runs left `cancelling` by a dead settler, then re-checks predicate waits
and enforces timeouts across suspended runs. Resumption is **exactly-once** — concurrent resumers race a
compare-and-swap and all but one get `AlreadyResumedError` — and re-runs only
the targets that hadn't yet succeeded. `--force-graph` continues even if the
build graph changed since the run was suspended. See
[Orchestration](./orchestration.md).

A resume **refuses** a run whose record is
[degraded](./state.md#degraded-records) — a state write was permanently lost
while it ran, so a target that actually succeeded may still be recorded `running`
or `pending`. A resume re-runs every target the record does not show as
`succeeded`, so continuing would run that target a **second time**.
`--resume-degraded` accepts that risk and continues; use it once you know those
targets are safe to repeat. `resume --check` counts a degraded run as failed on
every sweep — it cannot make that call for you — and prints the refusal so the
cause is visible; pass `--resume-degraded` to the sweep to let it through.

**What the sweep's failure count does _not_ include.** A run another process is
already driving, one it finished between the listing and the resume, and one
belonging to [another build](./orchestration.md#whose-run-is-it) are all
**skipped**, not counted — losing a race is not a fault, and a cron watching the
exit code needs it to mean something. Each is reported through the reporter, so a
sweep that advanced nothing still says why.

## Cancelling runs

`./zuke cancel <run-id>` cancels a run and runs its
[compensations](./orchestration.md#cancellation--compensation--oncancel): every
target that had **succeeded** and declared `.onCancel(...)` is unwound in
reverse order, then the record settles `cancelled`. On a
[degraded record](./state.md#degraded-records) it also unwinds every target whose
success the record cannot rule out — anything not recorded `failed` or `skipped`
— and says so per compensation, because a lost write can hide a deploy that
really happened. `--actor <name>` attributes
the cancellation in the audit trail. Cancelling a run another process is
executing stops it (a live run aborts on its next state write); cancelling an
already-finished run is a friendly no-op. `Ctrl-C` (or `SIGTERM`) cancels the
run in the current process the same way — a second `Ctrl-C` forces an immediate
exit.

## Inspecting runs

`./zuke runs` reads persisted [run records](./state.md) back from the store, so
a run's full status survives the process that produced it.

- `./zuke runs list` prints one row per run — id, status, root target, actor,
  and creation time — newest first. Narrow it with `--status <s>` (one of
  `running`, `suspended`, `cancelling`, `succeeded`, `failed`, `cancelled`),
  `--target <t>` (only runs whose graph contains that target), `--since <iso>`
  (only runs created at or after an ISO-8601 timestamp), and `--limit <n>` (at
  most the newest N). The filters compose. Add `--counts` to print aggregate
  counts (a total and one line per status) instead of rows — with `--json` it
  emits `{ total, byStatus }` (status keys sorted for stable output),
  honouring the same filters.
- `./zuke runs show <run-id>` reconstructs one run in full: the header,
  resolved (non-secret) parameters, each target's status with its duration,
  error, or pending wait, and any external signals received.
- `./zuke runs prune` deletes old records. `--keep <age>` (e.g. `90d`) keeps
  runs newer than that; `--keep-last <n>` always keeps the newest N; a run is
  deleted only when it is **terminal** and matches neither. **Non-terminal**
  runs (`suspended`, `running`, `cancelling`) are never pruned. At least one
  rule is required, and `--dry-run` reports what would go without deleting.
  See [retention](./state.md#retention) for who owns it on each backend.

Both accept `--json` — `list` emits the summary array, `show` emits the whole
record — for tools and agents. The store is resolved exactly as a run resolves
it (`ZUKE_STATE_URL` / `ZUKE_STATE_DIR`, the build's `stateStore()` override, or
the default `.zuke/runs`); with no store configured, both report a friendly
error. The MCP server's `list_runs`/`show_run` tools (see [`./zuke mcp`](#zuke-mcp)
above) read the same store.

# CLI reference

| Command                                                 | Behaviour                                                                               |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `zuke <target>`                                         | Run the target and all its transitive dependencies, in order.                           |
| `zuke <target> --skip <dep>`                            | Run the target but skip the named dependency (repeatable).                              |
| `zuke <target> --parallel`                              | Run independent targets concurrently (`--parallel=N` caps it).                          |
| `zuke <target> --no-cache`                              | Ignore the incremental cache; re-run every target.                                      |
| `zuke <target> --affected[=<base>]`                     | Run only targets affected by files changed since a git base.                            |
| `zuke <target> --dry-run`                               | Print the plan without executing any target body.                                       |
| `zuke <target> --state`                                 | Persist [durable run state](./state.md) under `.zuke/runs`.                             |
| `zuke <target> --actor <name>`                          | Attribute the run to `<name>` in its state record.                                      |
| `zuke --list` / `-l`                                    | List all targets with descriptions and dependencies.                                    |
| `zuke graph`                                            | Print the dependency graph (`target → deps`).                                           |
| `zuke graph --output=html`                              | Render an interactive HTML graph into `.zuke/` and open it.                             |
| `zuke completions print <shell>`                        | Print a shell-completion script (`bash`, `zsh`, or `fish`).                             |
| `zuke completions install <shell>`                      | Write the script and wire it into the shell's startup.                                  |
| `zuke mcp [--allow-run[=<globs>]] [--http <host:port>]` | Run an MCP server over the build for AI agents, on stdio or HTTP ([details](./mcp.md)). |
| `zuke resume <id> [--signal <n>] [--data <json>]`       | Resume a suspended run, optionally delivering a signal ([details](./orchestration.md)). |
| `zuke resume --check [<id>]`                            | Re-check suspended runs (predicate waits, timeouts).                                    |
| `zuke runs list [--status/-target/-since] [--json]`     | List persisted run records, newest first ([details](./state.md)).                       |
| `zuke runs show <id> [--json]`                          | Show one run's full per-target status and metadata.                                     |
| `zuke cancel <id> [--actor <name>]`                     | Cancel a run and run its compensations ([details](./orchestration.md#cancellation--compensation-oncancel)). |
| `zuke --help` / `-h`                                    | Usage.                                                                                  |
| `zuke` (no target)                                      | Run the `default` target if defined, else print `--list`.                               |

(Read `zuke` as `deno run -A zuke.ts` until the launcher binary ships.)

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

`zuke completions` takes an explicit sub-action — `print` or `install` — then a
shell (`bash`, `zsh`, or `fish`). `print` writes the completion script to
stdout; the script completes the build's target names, the reserved commands
(`graph`, `generate-ci`, `completions`, `mcp`), the built-in option flags, and
any declared [parameters](./parameters.md) as `--flag` candidates. Unlisted
targets (`.unlisted()`) stay hidden, just as they are in `--list`.

Source the printed script for the current shell:

```sh
# bash — current shell, or append to ~/.bashrc
source <(zuke completions print bash)

# zsh — current shell, or write to a file named _zuke on your $fpath
source <(zuke completions print zsh)

# fish — current shell, or save to ~/.config/fish/completions/zuke.fish
zuke completions print fish | source
```

The script is a static snapshot of the build it was generated from, so
regenerate and re-source it when you add, rename, or remove targets — the same
model as `deno completions`. A missing or unknown sub-action or shell prints a
usage line and exits `1`. `completions` is a reserved command name: a target
called `completions` can't be run by name.

### Installing

`zuke completions install <shell>` does the wiring for you: it writes the script
to a file under your config directory and makes the shell load it on the next
start — no manual `source` step.

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
(plus `signal_run`/`resume_check`). Authorization tiers layer on:
`--allow-run=<globs>` limits which targets are runnable, `--protect <globs>`
requires a `ZUKE_OPERATOR_TOKEN` operator token, and `--confirm-destructive`
makes a destructive run return its plan until called with `confirm:true`. Every
mutating or denied call is written to an audit trail
(`zuke runs show mcp-audit`). `--http <host:port>` serves the streamable-HTTP
transport instead of stdio (loopback by default; a non-loopback bind requires a
`ZUKE_MCP_TOKEN` bearer token). `mcp` is a reserved command name. See the full
guide: [MCP server](./mcp.md).

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
[`.inputs()`](./authoring.md#incremental-caching-inputs--outputs) are cached:
Zuke skips one (showing it `cached` in the summary) when its inputs are
unchanged since the last successful run and its outputs still exist.
Fingerprints live in `.zuke/cache.json`. `--no-cache` ignores the cache and
re-runs everything.

## Remote cache

The incremental cache is local. A **remote cache** shares a target's built
[`.outputs()`](./authoring.md#incremental-caching-inputs--outputs) across
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
zuke ci --affected                 # vs HEAD (uncommitted changes)
zuke ci --affected=origin/main     # vs a base branch — the usual CI form
```

A target is affected when a changed file falls inside one of its declared
[`.inputs()`](./authoring.md#incremental-caching-inputs--outputs), **or** when
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
`zuke resume`. `--signal <name>` delivers a named external signal (with an
optional `--data <json>` payload); `--check [<run-id>]` re-checks predicate
waits and enforces timeouts across suspended runs (the cron/webhook entry
point). Resumption is **exactly-once** — concurrent resumers race a
compare-and-swap and all but one get `AlreadyResumedError` — and re-runs only
the targets that hadn't yet succeeded. `--force-graph` continues even if the
build graph changed since the run was suspended. See
[Orchestration](./orchestration.md).

## Cancelling runs

`zuke cancel <run-id>` cancels a run and runs its
[compensations](./orchestration.md#cancellation--compensation-oncancel): every
target that had **succeeded** and declared `.onCancel(...)` is unwound in reverse
order, then the record settles `cancelled`. `--actor <name>` attributes the
cancellation in the audit trail. Cancelling a run another process is executing
stops it (a live run aborts on its next state write); cancelling an
already-finished run is a friendly no-op. `Ctrl-C` (or `SIGTERM`) cancels the run
in the current process the same way — a second `Ctrl-C` forces an immediate exit.

## Inspecting runs

`zuke runs` reads persisted [run records](./state.md) back from the store, so a
run's full status survives the process that produced it.

- `zuke runs list` prints one row per run — id, status, root target, actor, and
  creation time — newest first. Narrow it with `--status <s>` (one of `running`,
  `suspended`, `cancelling`, `succeeded`, `failed`, `cancelled`), `--target <t>` (only runs
  whose graph contains that target), and `--since <iso>` (only runs created at
  or after an ISO-8601 timestamp). The filters compose.
- `zuke runs show <run-id>` reconstructs one run in full: the header, resolved
  (non-secret) parameters, each target's status with its duration, error, or
  pending wait, and any external signals received.

Both accept `--json` — `list` emits the summary array, `show` emits the whole
record — for tools and agents. The store is resolved exactly as a run resolves
it (`ZUKE_STATE_URL` / `ZUKE_STATE_DIR`, the build's `stateStore()` override, or
the default `.zuke/runs`); with no store configured, both report a friendly
error. (MCP `list_runs` / `show_run` tools arrive in a later milestone.)

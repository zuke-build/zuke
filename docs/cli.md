# CLI reference

| Command                      | Behaviour                                                     |
| ---------------------------- | ------------------------------------------------------------- |
| `zuke <target>`              | Run the target and all its transitive dependencies, in order. |
| `zuke <target> --skip <dep>` | Run the target but skip the named dependency (repeatable).    |
| `zuke <target> --parallel`   | Run independent targets concurrently (`--parallel=N` caps it). |
| `zuke <target> --no-cache`   | Ignore the incremental cache; re-run every target.            |
| `zuke <target> --dry-run`    | Print the plan without executing any target body.             |
| `zuke --list` / `-l`         | List all targets with descriptions and dependencies.          |
| `zuke graph`                 | Print the dependency graph (`target → deps`).                 |
| `zuke graph --output=html`   | Render an interactive HTML graph into `.zuke/` and open it.   |
| `zuke --help` / `-h`         | Usage.                                                        |
| `zuke` (no target)           | Run the `default` target if defined, else print `--list`.     |

(Read `zuke` as `deno run -A zuke.ts` until the launcher binary ships.)

## `zuke graph`

Shows the build's dependency graph. By default it prints the terminal adjacency
listing (`target → deps`). With `--output=html` it renders the graph as an
interactive [Cytoscape](https://js.cytoscape.org/) diagram inside a
self-contained HTML page, writes it to `<repo root>/.zuke/graph.html`, and opens
it in your default browser. The repo root is located via the
[`zuke.json`](./paths.md#repo-root-reporoot) config file (falling back to the
current directory). The page is interactive: pan and zoom freely, **click a
target** to highlight everything it connects to — its transitive dependencies
and dependents — and click the background (or **Reset**) to clear the selection.
Cytoscape loads from a pinned CDN, so the first view needs internet access.

Targets in a [`group()`](./authoring.md#group-and-partof) are drawn inside a
labelled box (a Cytoscape compound node); the text listing tags them
`[group: name]`.

| Option          | Behaviour                                                   |
| --------------- | ----------------------------------------------------------- |
| `--output=html` | Render the interactive HTML page instead of terminal text.  |
| `--no-open`     | With `--output=html`, write the file without opening it.    |

`graph` is a reserved command name: a target called `graph` can't be run by
name.

**Output:** each target prints `▶ name` on start, then `✔ name (1.2s)` or
`✘ name (0.4s)`. A failure prints the error, aborts the remaining targets, and
exits `1`. A final summary lists every target's status and duration plus the
total. Under GitHub Actions, targets become collapsible log groups, failures
emit `::error::` annotations, and the summary is written to the job summary.

## Parallel execution

By default targets run one at a time in a deterministic order. `--parallel`
runs independent targets concurrently while still completing every dependency
before its dependents; `--parallel=N` caps the number in flight (the default is
the host's CPU count). Each target's banner block is buffered and flushed as a
unit, so concurrent runs don't interleave their headers (a target's own
subprocess output may still interleave, as with `make -j`). The first failure
stops new launches; targets already running finish, and the rest are reported
as skipped. The build summary stays in declaration order regardless.

Programmatic callers get the same behaviour via `execute(build, target, { parallel: true })`
(or a number) — see the [programmatic API](./programmatic-api.md).

For parallelism scoped to specific targets rather than the whole build, put
them in a [`group()`](./authoring.md#group-and-partof) with `.partOf(...)` — the
group's members run concurrently even without `--parallel`.

## Incremental builds

Targets that declare [`.inputs()`](./authoring.md#incremental-caching-inputs--outputs)
are cached: Zuke skips one (showing it `cached` in the summary) when its inputs
are unchanged since the last successful run and its outputs still exist.
Fingerprints live in `.zuke/cache.json`. `--no-cache` ignores the cache and
re-runs everything.

## Dry runs

`--dry-run` resolves the plan and reports every target that **would** run —
honouring `--skip` and each target's `onlyWhen` condition — without executing
any body or reading/writing the cache. Each planned target prints a
`(dry run — not executed)` line, and the summary reflects what would have run.
Programmatic callers pass `{ dryRun: true }` to `execute`.

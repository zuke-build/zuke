# CLI reference

| Command                      | Behaviour                                                     |
| ---------------------------- | ------------------------------------------------------------- |
| `zuke <target>`              | Run the target and all its transitive dependencies, in order. |
| `zuke <target> --skip <dep>` | Run the target but skip the named dependency (repeatable).    |
| `zuke --list` / `-l`         | List all targets with descriptions and dependencies.          |
| `zuke --graph`               | Print the dependency graph (`target → deps`).                 |
| `zuke graph`                 | Render an interactive HTML graph into `.zuke/` and open it.   |
| `zuke --help` / `-h`         | Usage.                                                        |
| `zuke` (no target)           | Run the `default` target if defined, else print `--list`.     |

(Read `zuke` as `deno run -A zuke.ts` until the launcher binary ships.)

## `zuke graph`

Renders the dependency graph as a [Mermaid](https://mermaid.js.org/) flowchart
inside a self-contained HTML page, writes it to `<repo root>/.zuke/graph.html`,
and opens it in your default browser. The repo root is located via the
[`zuke.json`](./paths.md#repo-root-reporoot) config file (falling back to the
current directory). The page is interactive: **click a target** to highlight
everything it connects to — its transitive dependencies and dependents — and
click the background (or **Reset**) to clear the selection. Mermaid loads from a
pinned CDN, so the first view needs internet access.

| Option         | Behaviour                                                  |
| -------------- | ---------------------------------------------------------- |
| `--out <path>` | Write the HTML somewhere other than `.zuke/graph.html`.    |
| `--no-open`    | Generate the file without launching a browser (CI-safe).   |

`graph` is a reserved command name: a target called `graph` can't be run by
name (use `--graph` for the text adjacency listing instead).

**Output:** each target prints `▶ name` on start, then `✔ name (1.2s)` or
`✘ name (0.4s)`. A failure prints the error, aborts the remaining targets, and
exits `1`. A final summary lists every target's status and duration plus the
total. Under GitHub Actions, targets become collapsible log groups, failures
emit `::error::` annotations, and the summary is written to the job summary.

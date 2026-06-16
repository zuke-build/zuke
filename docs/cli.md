# CLI reference

| Command                      | Behaviour                                                     |
| ---------------------------- | ------------------------------------------------------------- |
| `zuke <target>`              | Run the target and all its transitive dependencies, in order. |
| `zuke <target> --skip <dep>` | Run the target but skip the named dependency (repeatable).    |
| `zuke --list` / `-l`         | List all targets with descriptions and dependencies.          |
| `zuke --graph`               | Print the dependency graph (`target → deps`).                 |
| `zuke --help` / `-h`         | Usage.                                                        |
| `zuke` (no target)           | Run the `default` target if defined, else print `--list`.     |

(Read `zuke` as `deno run -A zuke.ts` until the launcher binary ships.)

**Output:** each target prints `▶ name` on start, then `✔ name (1.2s)` or
`✘ name (0.4s)`. A failure prints the error, aborts the remaining targets, and
exits `1`. A final summary lists every target's status and duration plus the
total. Under GitHub Actions, targets become collapsible log groups, failures
emit `::error::` annotations, and the summary is written to the job summary.

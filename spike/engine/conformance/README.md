# Engine conformance cases

Each `*.json` file is one case an SDK's worker must satisfy and the engine must
drive the same way. `tests/integration/engine_conformance_test.ts` replays every
case through the CLI `main()` against the scripted fake worker.

| Field       | Meaning                                                                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `manifest`  | The `build.describe` answer, plus the fake worker's per-target script keys (`fail`, `failTimes`, `condition_answer`, `cacheKey_answer`, `failHook`).                                                   |
| `list`      | The `targets` and `parameters` that `--list --json` must print for it.                                                                                                                                 |
| `argv`      | The command line of the run.                                                                                                                                                                           |
| `code`      | The exit code of the run.                                                                                                                                                                              |
| `calls`     | The engine-to-worker calls the run makes after `build.describe`, in order, as `method [target]`.                                                                                                       |
| `answers`   | Optional: the answers the engine gives the worker's own `calls` script, in order, as `method json`.                                                                                                    |
| `then`      | Optional: further runs in the same state directory, each a fresh worker, with `argv`, `code`, `calls`, `configure`, optional `answers` and `manifest`; `$RUN_ID` in an argv is the persisted run's id. |
| `configure` | The `parameters` every run's `build.configure` call carries.                                                                                                                                           |

Cases keep their targets sequentially ordered so the transcript is
deterministic; concurrency is proved by the integration tests instead.

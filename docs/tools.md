# Tools

Typed tool wrappers in a settings-lambda style: configure a fluent settings
object in a lambda and the task function builds the argv and runs it. Arguments
stay a discrete array end-to-end — never a shell string — so command
construction is injection-free.

```ts
import { DenoTasks } from "jsr:@zuke/deno";
import { NpmTasks } from "jsr:@zuke/npm";
import { CmdTasks } from "jsr:@zuke/cmd";

await DenoTasks.test((s) => s.allowAll().coverage("cov_profile"));
await NpmTasks.run((s) => s.script("build").workspace("app"));

// Fallback for tools without a dedicated wrapper:
await CmdTasks.exec("git", (s) => s.args("rev-parse", "HEAD"));
```

Every settings object also supports `.env()`, `.cwd()`, `.noThrow()`,
`.quiet()`, `.toolPath()` (binary override) and `.args()` (escape hatch for
flags without a typed option). Awaiting a task resolves to the same
`CommandOutput` the shell `$` produces. If a binary is missing, Zuke retries
through `cmd /c` on Windows (npm ships as a `.cmd` shim there) and otherwise
raises a `ToolNotFoundError` that names the tool and the fix.

| Package                | Tasks                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `@zuke/deno`           | `run`, `test`, `check`, `fmt`, `lint`, `cache`, `coverage`, `task`                                                   |
| `@zuke/npm`            | `install`, `ci`, `run`, `exec`, `publish`, `version`                                                                 |
| `@zuke/bun`            | `install`, `add`, `remove`, `run`, `x`, `test`                                                                       |
| `@zuke/pnpm`           | `install`, `add`, `remove`, `run`, `dlx`, `publish`                                                                  |
| `@zuke/yarn`           | `install`, `add`, `remove`, `run`, `dlx`                                                                             |
| `@zuke/docker`         | `build`, `run`, `exec`, `push`, `pull`, `tag`, `login`, `images`, `ps`, `stop`, `start`, `rm`, `rmi`, `save`, `load` |
| `@zuke/docker-compose` | `up`, `down`, `build`, `pull`, `push`, `run`, `exec`, `logs`, `ps`, `config`, `start`, `stop`, `restart`, `rm`       |
| `@zuke/kubectl`        | `apply`, `create`, `delete`, `get`, `describe`, `logs`, `exec`, `rollout`, `scale`, `setImage`, `patch`, `portForward`, `wait`, `top` |
| `@zuke/oxlint`         | `lint`                                                                                                               |
| `@zuke/eslint`         | `lint`                                                                                                               |
| `@zuke/cspell`         | `lint`                                                                                                               |
| `@zuke/jest`           | `run`                                                                                                                |
| `@zuke/vitest`         | `run`                                                                                                                |
| `@zuke/playwright`     | `test`, `install`, `showReport`, `codegen`                                                                           |
| `@zuke/tsx`            | `tsx`, `watch`                                                                                                       |
| `@zuke/tsgo`           | `tsgo`                                                                                                               |
| `@zuke/dprint`         | `fmt`, `check`                                                                                                      |
| `@zuke/gcloud`         | `run` (any command)                                                                                                 |
| `@zuke/git`            | `init`, `clone`, `add`, `commit`, `status`, `checkout`, `branch`, `tag`, `push`, `pull`, `fetch`, `run`             |
| `@zuke/gh`             | `run` (any command)                                                                                                 |
| `@zuke/terraform`      | `init`, `validate`, `plan`, `apply`, `destroy`, `fmt`, `output`                                                      |
| `@zuke/tofu`           | `init`, `validate`, `plan`, `apply`, `destroy`, `fmt`, `output`                                                      |
| `@zuke/security`       | `zizmor`, `actionlint`, `gitleaks`, `osvScanner`, `semgrep`, `trivyFs`, `trivyConfig`                                |
| `@zuke/cmd`            | `exec` (any tool)                                                                                                    |

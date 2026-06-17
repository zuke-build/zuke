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
| `@zuke/helm`           | `install`, `upgrade`, `uninstall`, `template`, `lint`, `dependencyUpdate`, `repoAdd`, `package`                      |
| `@zuke/kustomize`      | `build`, `editSetImage`                                                                                              |
| `@zuke/oxlint`         | `lint`                                                                                                               |
| `@zuke/eslint`         | `lint`                                                                                                               |
| `@zuke/biome`          | `check`, `format`, `lint`, `ci`                                                                                      |
| `@zuke/knip`           | `run`                                                                                                                |
| `@zuke/cspell`         | `lint`                                                                                                               |
| `@zuke/jest`           | `run`                                                                                                                |
| `@zuke/vitest`         | `run`                                                                                                                |
| `@zuke/playwright`     | `test`, `install`, `showReport`, `codegen`                                                                           |
| `@zuke/cypress`        | `run`, `open`, `install`, `verify`, `info`                                                                           |
| `@zuke/vite`           | `dev`, `build`, `preview`                                                                                            |
| `@zuke/tsup`           | `build`                                                                                                              |
| `@zuke/turbo`          | `run`, `prune`                                                                                                       |
| `@zuke/nx`             | `run`, `runMany`, `affected`                                                                                         |
| `@zuke/jsr`            | `publish`, `add`, `remove`                                                                                           |
| `@zuke/tsx`            | `tsx`, `watch`                                                                                                       |
| `@zuke/tsgo`           | `tsgo`                                                                                                               |
| `@zuke/dprint`         | `fmt`, `check`                                                                                                      |
| `@zuke/gcloud`         | `run` (any command)                                                                                                 |
| `@zuke/git`            | `init`, `clone`, `add`, `commit`, `status`, `checkout`, `branch`, `tag`, `push`, `pull`, `fetch`, `run` (+ `gitInfo()` helper) |
| `@zuke/gh`             | `run` (any command)                                                                                                 |
| `@zuke/terraform`      | `init`, `validate`, `plan`, `apply`, `destroy`, `fmt`, `output`                                                      |
| `@zuke/tofu`           | `init`, `validate`, `plan`, `apply`, `destroy`, `fmt`, `output`                                                      |
| `@zuke/security`       | `zizmor`, `actionlint`, `gitleaks`, `osvScanner`, `semgrep`, `trivyFs`, `trivyConfig`                                |
| `@zuke/cmd`            | `exec` (any tool)                                                                                                    |

## Define your own tool

For a CLI without a dedicated package, `defineTool` (from `@zuke/core/tooling`)
gives you a typed, fluent task in the same style — no class needed. Build the
argv with `arg` / `flag` / `option` (in call order), and the shared chainers
(`cwd`, `env`, `noThrow`, `quiet`, `toolPath`, `args`) all apply. An optional
`subcommand` is prepended to every invocation.

```ts
import { defineTool } from "jsr:@zuke/core/tooling";

const terraform = defineTool("terraform");
await terraform((s) => s.arg("plan").option("out", "plan.tfplan"));
// → terraform plan --out plan.tfplan

const helmUpgrade = defineTool("helm", { subcommand: "upgrade" });
await helmUpgrade((s) => s.arg("api", "./chart").flag("install").cwd("infra"));
// → helm upgrade api ./chart --install   (run in ./infra)
```

`flag`/`option` add a `--` prefix unless the name already starts with a dash
(so `flag("-v")` stays `-v`). Argv is a discrete array end-to-end, so a
`defineTool` command is just as injection-free as the built-in wrappers.

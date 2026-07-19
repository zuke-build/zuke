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
`CommandOutput` the shell `$` produces.

Need the binary itself? A build can fetch a pinned, checksum-verified CLI and
hand its path to `.toolPath(...)` — see
[Installing tools](./installing-tools.md). If a binary is missing, Zuke retries
through `cmd /c` on Windows (npm ships as a `.cmd` shim there) and otherwise
raises a `ToolNotFoundError` that names the tool and the fix.

## Resolving from `node_modules/.bin`

By default a wrapper spawns the bare tool name and lets the OS find it on
`PATH`. In a Node monorepo the tools are usually installed locally and hoisted
to the repo root instead, so Zuke can resolve them npx-style — walking up from
the working directory for `node_modules/.bin/<tool>` (the `.cmd`/`.bat` shims,
launched through `cmd /c`, on Windows) and falling back to `PATH` on a miss. There are three ways to
turn it on, most specific first:

- **Per call:** `.fromNodeModules()` (or `.fromPath()` to force `PATH`) on any
  settings object — `OxlintTasks.lint((s) => s.fromNodeModules())`.
- **Per wrapper:** the JS-ecosystem wrappers default to `node_modules`-first, so
  in a workspace package whose binaries are hoisted you write no `.toolPath()`
  and no `.fromNodeModules()` at all.
- **Repo-wide:** `ZUKE_TOOL_RESOLUTION=node_modules` (or `path`) flips every
  wrapper without touching call sites. A per-call `.fromNodeModules()`/
  `.fromPath()` still wins over the ambient value.

An explicit `.toolPath(...)` always wins over resolution — pins from
`toolchain()` stay hermetic. When resolution walks past a `node_modules`
directory that lacks the tool, `ToolNotFoundError` adds a hint to run `npm ci`
or provision it via `toolchain()`. `resolvedArgv()` reports the argv a run will
actually spawn (the resolved shim or the bare fallback) for diagnostics.

| Package                | Tasks                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `@zuke/deno`           | `run`, `test`, `check`, `fmt`, `lint`, `cache`, `coverage`, `task`                                                                    |
| `@zuke/npm`            | `install`, `ci`, `run`, `exec`, `publish`, `version`                                                                                  |
| `@zuke/npx`            | `npx`                                                                                                                                  |
| `@zuke/bun`            | `install`, `add`, `remove`, `run`, `x`, `test`                                                                                        |
| `@zuke/pnpm`           | `install`, `add`, `remove`, `run`, `dlx`, `publish`                                                                                   |
| `@zuke/yarn`           | `install`, `add`, `remove`, `run`, `dlx`                                                                                              |
| `@zuke/docker`         | `build`, `run`, `exec`, `push`, `pull`, `tag`, `login`, `images`, `ps`, `stop`, `start`, `rm`, `rmi`, `save`, `load`                  |
| `@zuke/docker-compose` | `up`, `down`, `build`, `pull`, `push`, `run`, `exec`, `logs`, `ps`, `config`, `start`, `stop`, `restart`, `rm`                        |
| `@zuke/kubectl`        | `apply`, `create`, `delete`, `get`, `describe`, `logs`, `exec`, `rollout`, `scale`, `setImage`, `patch`, `portForward`, `wait`, `top`, `annotate`, `label` |
| `@zuke/helm`           | `install`, `upgrade`, `uninstall`, `template`, `lint`, `dependencyUpdate`, `repoAdd`, `package`                                       |
| `@zuke/kustomize`      | `build`, `editSetImage`                                                                                                               |
| `@zuke/oxlint`         | `lint`                                                                                                                                |
| `@zuke/eslint`         | `lint`                                                                                                                                |
| `@zuke/biome`          | `check`, `format`, `lint`, `ci`                                                                                                       |
| `@zuke/knip`           | `run`                                                                                                                                 |
| `@zuke/dpdm`           | `analyze`                                                                                                                             |
| `@zuke/cspell`         | `lint`                                                                                                                                |
| `@zuke/jest`           | `run`                                                                                                                                 |
| `@zuke/vitest`         | `run`                                                                                                                                 |
| `@zuke/playwright`     | `test`, `install`, `showReport`, `codegen`                                                                                            |
| `@zuke/cypress`        | `run`, `open`, `install`, `verify`, `info`                                                                                            |
| `@zuke/vite`           | `dev`, `build`, `preview`                                                                                                             |
| `@zuke/tsup`           | `build`                                                                                                                               |
| `@zuke/turbo`          | `run`, `prune`                                                                                                                        |
| `@zuke/nx`             | `run`, `runMany`, `affected`                                                                                                          |
| `@zuke/jsr`            | `publish`, `add`, `remove`                                                                                                            |
| `@zuke/tsx`            | `tsx`, `watch`                                                                                                                        |
| `@zuke/tsgo`           | `tsgo`                                                                                                                                |
| `@zuke/tsc`            | `tsc`, `build`                                                                                                                        |
| `@zuke/tsc-alias`      | `run`                                                                                                                                 |
| `@zuke/tsdown`         | `build`, `migrate`                                                                                                                    |
| `@zuke/nest`           | `new`, `generate`, `build`, `start`, `info`                                                                                           |
| `@zuke/openapi-ts`     | `generate`                                                                                                                            |
| `@zuke/orval`          | `generate`                                                                                                                            |
| `@zuke/husky`          | `init`, `install`                                                                                                                     |
| `@zuke/node`           | `run`, `eval`, `test`                                                                                                                 |
| `@zuke/dprint`         | `fmt`, `check`                                                                                                                        |
| `@zuke/gcloud`         | `run` (any command; typed `containerImagesAddTag` / `sqlInstancesDescribe` / `sqlOperationsWait`), plus `GcsTasks` and `SecretManagerTasks` REST groups |
| `@zuke/git`            | `init`, `clone`, `add`, `commit`, `status`, `checkout`, `branch`, `tag`, `push`, `pull`, `fetch`, `run` (+ `gitInfo()` helper)        |
| `@zuke/gh`             | `run` (any command)                                                                                                                   |
| `@zuke/codecov`        | `upload` (`codecovcli upload-process`)                                                                                                |
| `@zuke/claude`         | `run` (headless prompt), `mcp`, `config`, `update`                                                                                    |
| `@zuke/codex`          | `exec` (headless prompt), `mcp`                                                                                                       |
| `@zuke/gemini`         | `run` (headless prompt), `mcp`, `extensions`                                                                                          |
| `@zuke/terraform`      | `init`, `validate`, `plan`, `apply`, `destroy`, `fmt`, `output`                                                                       |
| `@zuke/tofu`           | `init`, `validate`, `plan`, `apply`, `destroy`, `fmt`, `output`                                                                       |
| `@zuke/security`       | `zizmor`, `actionlint`, `gitleaks`, `osvScanner`, `semgrep`, `trivyFs`, `trivyConfig`                                                 |
| `@zuke/cmd`            | `exec` (any tool)                                                                                                                     |

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

`flag`/`option` add a `--` prefix unless the name already starts with a dash (so
`flag("-v")` stays `-v`). Argv is a discrete array end-to-end, so a `defineTool`
command is just as injection-free as the built-in wrappers.

## Reading a wrapper's API — `zuke doc`

`deno doc jsr:@zuke/deno` run inside a Node repo drowns the output in
`@types/node` resolution warnings, because Deno discovers the surrounding
project's `deno.json` / `node_modules`. `zuke doc <package>` runs `deno doc` from
an **isolated throwaway directory**, so type resolution starts clean and the API
prints readably in place:

```sh
zuke doc core            # jsr:@zuke/core
zuke doc @scope/pkg      # a scoped package
zuke doc deno --filter DenoTasks   # extra flags pass through to deno doc
```

A bare name resolves to `jsr:@zuke/<name>`; an explicit `jsr:`/`npm:`/`https:`
specifier or a file path is used as-is.

`NpmTasks.run` covers workspaces both ways: `.workspace("app")` for one, and
`.workspaces()` for every workspace (compose with `.ifPresent()` to skip those
missing the script) — the two are mutually exclusive.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/zuke-build/zuke/raw/master/assets/logo-white.png" />
  <img width="400px" alt="Zuke" src="https://github.com/zuke-build/zuke/raw/master/assets/logo.png" />
</picture>

> A code-first, strongly-typed build automation system for Deno & TypeScript.

<p align="center">
  <a href="https://github.com/zuke-build/zuke/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/zuke-build/zuke/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/zuke-build/zuke/actions/workflows/release.yml"><img alt="Release" src="https://github.com/zuke-build/zuke/actions/workflows/release.yml/badge.svg" /></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/zuke-build/zuke"><img alt="OpenSSF Scorecard" src="https://api.scorecard.dev/projects/github.com/zuke-build/zuke/badge" /></a>
  <a href="https://jsr.io/@zuke/core"><img alt="JSR" src="https://jsr.io/badges/@zuke/core" /></a>
  <a href="https://jsr.io/@zuke/core"><img alt="JSR score" src="https://jsr.io/badges/@zuke/core/score" /></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-yellow.svg" /></a>
  <a href="https://deno.com/"><img alt="Built for Deno" src="https://img.shields.io/badge/Deno-2.x-000?logo=deno&logoColor=white" /></a>
  <a href="./CONTRIBUTING.md"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" /></a>
</p>

<p align="center">
  <img src="https://github.com/zuke-build/zuke/raw/master/assets/demo.svg" alt="Zuke in action: scaffold a build, list targets, run the gate" width="760" />
</p>

> [!NOTE]
> **Built with AI.** Much of Zuke — code, tests, and docs — was written with AI
> assistance, then reviewed, type-checked, and tested in CI. Sharing how it was
> made so you know what you're getting.

Zuke lets you define builds as a **TypeScript class**. Each target is a class
field declared with a fluent API; targets reference each other by `this.x` (not
strings), forming a dependency graph that Zuke resolves and runs in topological
order. Inspired by [NUKE](https://nuke.build/) for .NET.

- **Runtime:** Deno
- **Packages:** `jsr:@zuke/core` plus 30+ typed tool wrappers and a generic
  `jsr:@zuke/cmd` fallback (raw shell via `jsr:@zuke/core/shell`) — see
  [Packages](#packages) for the full matrix with published versions
- **Build file:** `zuke.ts` in your project root
- **Zero runtime dependencies**

```ts
class MyBuild extends Build {
  compile = target()
    .dependsOn(this.clean, this.restore)
    .executes(async () => {
      await DenoTasks.check((s) => s.paths("mod.ts"));
    });
}
```

## Why Zuke

- **Typed, refactor-safe dependencies.** You wire targets together with
  `this.clean`, not `"clean"`. Rename a target and every reference moves with
  it; a typo is a compile error, not a runtime surprise.
- **Just TypeScript.** Your build logic is ordinary async functions with full
  editor support — no YAML, no bespoke DSL.
- **Ergonomic shell.** The `$` tagged template runs processes with sane defaults
  (throw on failure, capture output) and is injection-safe.
- **Small and explicit.** A tiny core: discover targets, build a graph, sort,
  run. No magic, no plugins to learn (yet).
- **Code-first CI.** Declare your pipeline in the build with
  `cicd({ provider: "github" })` — the provider is the only required field — and
  Zuke generates GitHub Actions, GitLab CI, or Azure Pipelines YAML,
  regenerating it whenever the build runs (and verifying it on CI).

## Install

You need [Deno](https://deno.com/) installed. The fastest start is the
`@zuke/cli` tool — install it once, then scaffold a starter `zuke.ts`, the
`./zuke` launchers, and a `deno.json` task into any directory:

```sh
deno install -A -g -n zuke jsr:@zuke/cli   # once
zuke setup                                  # in your project
./zuke                                      # run the build
```

See **[Getting started](./docs/getting-started.md)** for the full walkthrough
(scaffolding, the `./zuke` launcher, a first build, and GitHub Actions output).

> [!NOTE]
> All packages publish to [JSR](https://jsr.io/@zuke) from CI via release-please
> and OIDC (see [`RELEASING.md`](./RELEASING.md)). The npm scope `@zuke` is not
> controlled by this project — install from JSR, not npm.

## Packages

Zuke ships as a JSR workspace: a tiny core plus a typed wrapper per tool. Every
package is versioned and published independently — the badges below track the
latest release on JSR.

> **Looking for the exact API (humans and agents)?** Don't guess and don't shell
> out — every tool is a typed wrapper. The complete, typed surface of every
> package is in [`llms-full.txt`](./llms-full.txt) (one file), summarised in
> [`llms.txt`](./llms.txt); for a single package run
> `deno doc jsr:@zuke/<package>`. See also [`AGENTS.md`](./AGENTS.md).

| Package                                           | Version                                                                                                                                                                 |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@zuke/core`](https://jsr.io/@zuke/core)         | [![JSR](https://jsr.io/badges/@zuke/core)](https://jsr.io/@zuke/core) [![JSR score](https://jsr.io/badges/@zuke/core/score)](https://jsr.io/@zuke/core)                 |
| [`@zuke/cli`](https://jsr.io/@zuke/cli)           | [![JSR](https://jsr.io/badges/@zuke/cli)](https://jsr.io/@zuke/cli) [![JSR score](https://jsr.io/badges/@zuke/cli/score)](https://jsr.io/@zuke/cli)                     |
| [`@zuke/cmd`](https://jsr.io/@zuke/cmd)           | [![JSR](https://jsr.io/badges/@zuke/cmd)](https://jsr.io/@zuke/cmd) [![JSR score](https://jsr.io/badges/@zuke/cmd/score)](https://jsr.io/@zuke/cmd)                     |
| [`@zuke/deno`](https://jsr.io/@zuke/deno)         | [![JSR](https://jsr.io/badges/@zuke/deno)](https://jsr.io/@zuke/deno) [![JSR score](https://jsr.io/badges/@zuke/deno/score)](https://jsr.io/@zuke/deno)                 |
| [`@zuke/docs`](https://jsr.io/@zuke/docs)         | [![JSR](https://jsr.io/badges/@zuke/docs)](https://jsr.io/@zuke/docs) [![JSR score](https://jsr.io/badges/@zuke/docs/score)](https://jsr.io/@zuke/docs)                 |
| [`@zuke/npm`](https://jsr.io/@zuke/npm)           | [![JSR](https://jsr.io/badges/@zuke/npm)](https://jsr.io/@zuke/npm) [![JSR score](https://jsr.io/badges/@zuke/npm/score)](https://jsr.io/@zuke/npm)                     |
| [`@zuke/security`](https://jsr.io/@zuke/security) | [![JSR](https://jsr.io/badges/@zuke/security)](https://jsr.io/@zuke/security) [![JSR score](https://jsr.io/badges/@zuke/security/score)](https://jsr.io/@zuke/security) |

<details>
<summary><strong>All tool wrappers</strong> (30+ packages)</summary>

| Package                                                       | Version                                                                                                                                                                                         |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@zuke/biome`](https://jsr.io/@zuke/biome)                   | [![JSR](https://jsr.io/badges/@zuke/biome)](https://jsr.io/@zuke/biome) [![JSR score](https://jsr.io/badges/@zuke/biome/score)](https://jsr.io/@zuke/biome)                                     |
| [`@zuke/bun`](https://jsr.io/@zuke/bun)                       | [![JSR](https://jsr.io/badges/@zuke/bun)](https://jsr.io/@zuke/bun) [![JSR score](https://jsr.io/badges/@zuke/bun/score)](https://jsr.io/@zuke/bun)                                             |
| [`@zuke/cypress`](https://jsr.io/@zuke/cypress)               | [![JSR](https://jsr.io/badges/@zuke/cypress)](https://jsr.io/@zuke/cypress) [![JSR score](https://jsr.io/badges/@zuke/cypress/score)](https://jsr.io/@zuke/cypress)                             |
| [`@zuke/cspell`](https://jsr.io/@zuke/cspell)                 | [![JSR](https://jsr.io/badges/@zuke/cspell)](https://jsr.io/@zuke/cspell) [![JSR score](https://jsr.io/badges/@zuke/cspell/score)](https://jsr.io/@zuke/cspell)                                 |
| [`@zuke/docker`](https://jsr.io/@zuke/docker)                 | [![JSR](https://jsr.io/badges/@zuke/docker)](https://jsr.io/@zuke/docker) [![JSR score](https://jsr.io/badges/@zuke/docker/score)](https://jsr.io/@zuke/docker)                                 |
| [`@zuke/docker-compose`](https://jsr.io/@zuke/docker-compose) | [![JSR](https://jsr.io/badges/@zuke/docker-compose)](https://jsr.io/@zuke/docker-compose) [![JSR score](https://jsr.io/badges/@zuke/docker-compose/score)](https://jsr.io/@zuke/docker-compose) |
| [`@zuke/dpdm`](https://jsr.io/@zuke/dpdm)                     | [![JSR](https://jsr.io/badges/@zuke/dpdm)](https://jsr.io/@zuke/dpdm) [![JSR score](https://jsr.io/badges/@zuke/dpdm/score)](https://jsr.io/@zuke/dpdm)                                         |
| [`@zuke/dprint`](https://jsr.io/@zuke/dprint)                 | [![JSR](https://jsr.io/badges/@zuke/dprint)](https://jsr.io/@zuke/dprint) [![JSR score](https://jsr.io/badges/@zuke/dprint/score)](https://jsr.io/@zuke/dprint)                                 |
| [`@zuke/eslint`](https://jsr.io/@zuke/eslint)                 | [![JSR](https://jsr.io/badges/@zuke/eslint)](https://jsr.io/@zuke/eslint) [![JSR score](https://jsr.io/badges/@zuke/eslint/score)](https://jsr.io/@zuke/eslint)                                 |
| [`@zuke/gcloud`](https://jsr.io/@zuke/gcloud)                 | [![JSR](https://jsr.io/badges/@zuke/gcloud)](https://jsr.io/@zuke/gcloud) [![JSR score](https://jsr.io/badges/@zuke/gcloud/score)](https://jsr.io/@zuke/gcloud)                                 |
| [`@zuke/gh`](https://jsr.io/@zuke/gh)                         | [![JSR](https://jsr.io/badges/@zuke/gh)](https://jsr.io/@zuke/gh) [![JSR score](https://jsr.io/badges/@zuke/gh/score)](https://jsr.io/@zuke/gh)                                                 |
| [`@zuke/claude`](https://jsr.io/@zuke/claude)                 | [![JSR](https://jsr.io/badges/@zuke/claude)](https://jsr.io/@zuke/claude) [![JSR score](https://jsr.io/badges/@zuke/claude/score)](https://jsr.io/@zuke/claude)                                 |
| [`@zuke/codex`](https://jsr.io/@zuke/codex)                   | [![JSR](https://jsr.io/badges/@zuke/codex)](https://jsr.io/@zuke/codex) [![JSR score](https://jsr.io/badges/@zuke/codex/score)](https://jsr.io/@zuke/codex)                                     |
| [`@zuke/gemini`](https://jsr.io/@zuke/gemini)                 | [![JSR](https://jsr.io/badges/@zuke/gemini)](https://jsr.io/@zuke/gemini) [![JSR score](https://jsr.io/badges/@zuke/gemini/score)](https://jsr.io/@zuke/gemini)                                 |
| [`@zuke/git`](https://jsr.io/@zuke/git)                       | [![JSR](https://jsr.io/badges/@zuke/git)](https://jsr.io/@zuke/git) [![JSR score](https://jsr.io/badges/@zuke/git/score)](https://jsr.io/@zuke/git)                                             |
| [`@zuke/helm`](https://jsr.io/@zuke/helm)                     | [![JSR](https://jsr.io/badges/@zuke/helm)](https://jsr.io/@zuke/helm) [![JSR score](https://jsr.io/badges/@zuke/helm/score)](https://jsr.io/@zuke/helm)                                         |
| [`@zuke/husky`](https://jsr.io/@zuke/husky)                   | [![JSR](https://jsr.io/badges/@zuke/husky)](https://jsr.io/@zuke/husky) [![JSR score](https://jsr.io/badges/@zuke/husky/score)](https://jsr.io/@zuke/husky)                                     |
| [`@zuke/jest`](https://jsr.io/@zuke/jest)                     | [![JSR](https://jsr.io/badges/@zuke/jest)](https://jsr.io/@zuke/jest) [![JSR score](https://jsr.io/badges/@zuke/jest/score)](https://jsr.io/@zuke/jest)                                         |
| [`@zuke/jsr`](https://jsr.io/@zuke/jsr)                       | [![JSR](https://jsr.io/badges/@zuke/jsr)](https://jsr.io/@zuke/jsr) [![JSR score](https://jsr.io/badges/@zuke/jsr/score)](https://jsr.io/@zuke/jsr)                                             |
| [`@zuke/knip`](https://jsr.io/@zuke/knip)                     | [![JSR](https://jsr.io/badges/@zuke/knip)](https://jsr.io/@zuke/knip) [![JSR score](https://jsr.io/badges/@zuke/knip/score)](https://jsr.io/@zuke/knip)                                         |
| [`@zuke/kubectl`](https://jsr.io/@zuke/kubectl)               | [![JSR](https://jsr.io/badges/@zuke/kubectl)](https://jsr.io/@zuke/kubectl) [![JSR score](https://jsr.io/badges/@zuke/kubectl/score)](https://jsr.io/@zuke/kubectl)                             |
| [`@zuke/kustomize`](https://jsr.io/@zuke/kustomize)           | [![JSR](https://jsr.io/badges/@zuke/kustomize)](https://jsr.io/@zuke/kustomize) [![JSR score](https://jsr.io/badges/@zuke/kustomize/score)](https://jsr.io/@zuke/kustomize)                     |
| [`@zuke/nest`](https://jsr.io/@zuke/nest)                     | [![JSR](https://jsr.io/badges/@zuke/nest)](https://jsr.io/@zuke/nest) [![JSR score](https://jsr.io/badges/@zuke/nest/score)](https://jsr.io/@zuke/nest)                                         |
| [`@zuke/node`](https://jsr.io/@zuke/node)                     | [![JSR](https://jsr.io/badges/@zuke/node)](https://jsr.io/@zuke/node) [![JSR score](https://jsr.io/badges/@zuke/node/score)](https://jsr.io/@zuke/node)                                         |
| [`@zuke/nx`](https://jsr.io/@zuke/nx)                         | [![JSR](https://jsr.io/badges/@zuke/nx)](https://jsr.io/@zuke/nx) [![JSR score](https://jsr.io/badges/@zuke/nx/score)](https://jsr.io/@zuke/nx)                                                 |
| [`@zuke/openapi-ts`](https://jsr.io/@zuke/openapi-ts)         | [![JSR](https://jsr.io/badges/@zuke/openapi-ts)](https://jsr.io/@zuke/openapi-ts) [![JSR score](https://jsr.io/badges/@zuke/openapi-ts/score)](https://jsr.io/@zuke/openapi-ts)                 |
| [`@zuke/orval`](https://jsr.io/@zuke/orval)                   | [![JSR](https://jsr.io/badges/@zuke/orval)](https://jsr.io/@zuke/orval) [![JSR score](https://jsr.io/badges/@zuke/orval/score)](https://jsr.io/@zuke/orval)                                     |
| [`@zuke/oxlint`](https://jsr.io/@zuke/oxlint)                 | [![JSR](https://jsr.io/badges/@zuke/oxlint)](https://jsr.io/@zuke/oxlint) [![JSR score](https://jsr.io/badges/@zuke/oxlint/score)](https://jsr.io/@zuke/oxlint)                                 |
| [`@zuke/playwright`](https://jsr.io/@zuke/playwright)         | [![JSR](https://jsr.io/badges/@zuke/playwright)](https://jsr.io/@zuke/playwright) [![JSR score](https://jsr.io/badges/@zuke/playwright/score)](https://jsr.io/@zuke/playwright)                 |
| [`@zuke/pnpm`](https://jsr.io/@zuke/pnpm)                     | [![JSR](https://jsr.io/badges/@zuke/pnpm)](https://jsr.io/@zuke/pnpm) [![JSR score](https://jsr.io/badges/@zuke/pnpm/score)](https://jsr.io/@zuke/pnpm)                                         |
| [`@zuke/terraform`](https://jsr.io/@zuke/terraform)           | [![JSR](https://jsr.io/badges/@zuke/terraform)](https://jsr.io/@zuke/terraform) [![JSR score](https://jsr.io/badges/@zuke/terraform/score)](https://jsr.io/@zuke/terraform)                     |
| [`@zuke/tofu`](https://jsr.io/@zuke/tofu)                     | [![JSR](https://jsr.io/badges/@zuke/tofu)](https://jsr.io/@zuke/tofu) [![JSR score](https://jsr.io/badges/@zuke/tofu/score)](https://jsr.io/@zuke/tofu)                                         |
| [`@zuke/tsc`](https://jsr.io/@zuke/tsc)                       | [![JSR](https://jsr.io/badges/@zuke/tsc)](https://jsr.io/@zuke/tsc) [![JSR score](https://jsr.io/badges/@zuke/tsc/score)](https://jsr.io/@zuke/tsc)                                             |
| [`@zuke/tsc-alias`](https://jsr.io/@zuke/tsc-alias)           | [![JSR](https://jsr.io/badges/@zuke/tsc-alias)](https://jsr.io/@zuke/tsc-alias) [![JSR score](https://jsr.io/badges/@zuke/tsc-alias/score)](https://jsr.io/@zuke/tsc-alias)                     |
| [`@zuke/tsdown`](https://jsr.io/@zuke/tsdown)                 | [![JSR](https://jsr.io/badges/@zuke/tsdown)](https://jsr.io/@zuke/tsdown) [![JSR score](https://jsr.io/badges/@zuke/tsdown/score)](https://jsr.io/@zuke/tsdown)                                 |
| [`@zuke/tsgo`](https://jsr.io/@zuke/tsgo)                     | [![JSR](https://jsr.io/badges/@zuke/tsgo)](https://jsr.io/@zuke/tsgo) [![JSR score](https://jsr.io/badges/@zuke/tsgo/score)](https://jsr.io/@zuke/tsgo)                                         |
| [`@zuke/tsup`](https://jsr.io/@zuke/tsup)                     | [![JSR](https://jsr.io/badges/@zuke/tsup)](https://jsr.io/@zuke/tsup) [![JSR score](https://jsr.io/badges/@zuke/tsup/score)](https://jsr.io/@zuke/tsup)                                         |
| [`@zuke/tsx`](https://jsr.io/@zuke/tsx)                       | [![JSR](https://jsr.io/badges/@zuke/tsx)](https://jsr.io/@zuke/tsx) [![JSR score](https://jsr.io/badges/@zuke/tsx/score)](https://jsr.io/@zuke/tsx)                                             |
| [`@zuke/turbo`](https://jsr.io/@zuke/turbo)                   | [![JSR](https://jsr.io/badges/@zuke/turbo)](https://jsr.io/@zuke/turbo) [![JSR score](https://jsr.io/badges/@zuke/turbo/score)](https://jsr.io/@zuke/turbo)                                     |
| [`@zuke/vite`](https://jsr.io/@zuke/vite)                     | [![JSR](https://jsr.io/badges/@zuke/vite)](https://jsr.io/@zuke/vite) [![JSR score](https://jsr.io/badges/@zuke/vite/score)](https://jsr.io/@zuke/vite)                                         |
| [`@zuke/vitest`](https://jsr.io/@zuke/vitest)                 | [![JSR](https://jsr.io/badges/@zuke/vitest)](https://jsr.io/@zuke/vitest) [![JSR score](https://jsr.io/badges/@zuke/vitest/score)](https://jsr.io/@zuke/vitest)                                 |
| [`@zuke/yarn`](https://jsr.io/@zuke/yarn)                     | [![JSR](https://jsr.io/badges/@zuke/yarn)](https://jsr.io/@zuke/yarn) [![JSR score](https://jsr.io/badges/@zuke/yarn/score)](https://jsr.io/@zuke/yarn)                                         |

</details>

## AI in your pipeline

Zuke ships typed wrappers for the major AI coding CLIs, so you can fold a model
into a build the same way you'd run a linter or a test — as a typed target with
refactor-safe dependencies.

| Package                                       | CLI                                                                   | Flagship task               |
| --------------------------------------------- | --------------------------------------------------------------------- | --------------------------- |
| [`@zuke/claude`](https://jsr.io/@zuke/claude) | [Claude Code](https://docs.claude.com/en/docs/claude-code) (`claude`) | `run` (headless `--print`)  |
| [`@zuke/codex`](https://jsr.io/@zuke/codex)   | [OpenAI Codex](https://developers.openai.com/codex/cli) (`codex`)     | `exec` (headless)           |
| [`@zuke/gemini`](https://jsr.io/@zuke/gemini) | [Gemini CLI](https://github.com/google-gemini/gemini-cli) (`gemini`)  | `run` (headless `--prompt`) |

Each runs the CLI **non-interactively** so it fits CI: drive a prompt, pick a
model, constrain the tool set, and capture the response (request JSON for
machine-readable output). Arguments stay a discrete argv array end-to-end —
never a concatenated shell string — so command construction is injection-free,
and API keys ride through the shared `.env(...)` chainer, backed by a
`parameter().secret()` build input that Zuke masks in CI output.

```ts
import { Build, parameter, target } from "jsr:@zuke/core";
import { ClaudeTasks } from "jsr:@zuke/claude";

class MyBuild extends Build {
  apiKey = parameter("Anthropic API key").secret();

  review = target()
    .dependsOn(this.test)
    .executes(async () => {
      const out = await ClaudeTasks.run((s) =>
        s.prompt("Review the staged diff for bugs in one paragraph")
          .model("sonnet")
          .allowedTools("Read", "Grep")
          .outputFormat("json")
          .env({ ANTHROPIC_API_KEY: this.apiKey.value })
      );
      console.log(out.stdout);
    });
}
```

The `mcp` (and `config`/`extensions`) tasks are flexible command builders for
each CLI's matching subcommand group — handy for provisioning MCP servers in CI.
See [Tools](./docs/tools.md) for the full task matrix.

### AI review and self-healing (`@zuke/ai`)

Beyond driving the coding CLIs, [`@zuke/ai`](https://jsr.io/@zuke/ai) makes a
model a first-class citizen of the build graph, two ways:

- **AI code review** — a reviewer reads the diff, returns a _structured_
  assessment (score, severity, findings), writes it to the job summary and the
  pull request, and **breaks the build** when the risk crosses a threshold you
  choose. The output is a typed verdict, not a blob of prose.
- **Self-healing builds** — attach a fixer to any target with
  `.recoverWith(...)`. When the target fails, `aiFixer` diagnoses it from the
  error output and the diff and (diagnose-only default) posts a **committable,
  Copilot-style inline suggestion** to the PR. Opt into `.autoApply()` /
  `.commitFixes()` and it fixes the working tree, commits, and **re-runs the
  real command to verify** — a fix only counts when the build actually goes
  green — posting an overview of what it changed instead of a suggestion.
- **Agent delegation** — for open-ended fixes, `agentFixer` hands the failure to
  a coding agent you inject (Claude Code, Codex, Gemini CLI) which edits files
  itself; one generic fixer, agent chosen at the call site.
- **Cost controls** — a shared `budget(...)` caps spend across every reviewer and
  fixer by an exact **token** count (no stale price tables; a USD cap is opt-in
  with your own rates), `aiCache(...)` reuses a prior response for an identical
  call, and `suppressions(...)` lets you dismiss a false positive by its stable
  ID so it never fails the build again.

```ts
test = target()
  .executes(() => DenoTasks.test((s) => s.allowAll()))
  // On failure: diagnose, post a committable suggestion, optionally heal.
  .recoverWith(aiFixer((f) => f.provider("openai").apiKey(this.key)));
```

Apply a fixer to **every** target by overriding `recoverWith()` on the build.
Safe by default (provider + key only): the fixer writes no files and just
diagnoses. Edits are gated behind a path allowlist, a file cap, and local-only
defaults, and nothing is committed unless you ask. See
[AI code review](./docs/ai-review.md) and
[Self-healing builds](./docs/self-healing.md).

## Agent skills

Zuke ships **agent skills** so AI coding assistants set up and author builds the
right way — using the typed `*Tasks` wrappers instead of guessing the API or
shelling out. Two skills, authored once as portable
[`SKILL.md`](https://agentskills.io) folders under [`skills/`](./skills):

| Skill              | Use it to                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `zuke-setup`       | Scaffold Zuke into a project (`zuke setup`, the `./zuke` launcher, a first build).           |
| `zuke-write-build` | Write or edit a `zuke.ts` — add targets, wire dependencies, call tool wrappers, generate CI. |

### Claude Code

The skills are packaged as a Claude Code plugin distributed from this repo's
marketplace. In Claude Code:

```text
/plugin marketplace add zuke-build/zuke
/plugin install zuke@zuke
```

That makes `zuke-setup` and `zuke-write-build` available — they trigger
automatically when you ask Claude to add Zuke to a project or write a build, and
can be invoked explicitly as `/zuke:zuke-setup` and `/zuke:zuke-write-build`.

> The `SKILL.md` content is harness-agnostic (the open
> [Agent Skills](https://agentskills.io) standard); the Claude marketplace is
> just one adapter over the shared `skills/` source. Installation for other
> harnesses (Codex, OpenCode, …) is coming later.

## Documentation

Full documentation lives in [`docs/`](./docs/):

- [Getting started](./docs/getting-started.md) — install, scaffold, the
  launcher, and a first build.
- [Core concepts](./docs/concepts.md) — the build/target/graph model and
  execution semantics.
- [Parameters](./docs/parameters.md) — typed build inputs from flags and env
  vars (`parameter()`, `this.x.value`).
- [Authoring API](./docs/authoring.md) — `target()`, `Build`, `run()`,
  code-first CI generation (`cicd()`), and gotchas.
- [Shell wrapper (`$`)](./docs/shell.md) — ergonomic, injection-safe process
  execution.
- [Paths (`absolutePath`)](./docs/paths.md) — the fluent path type.
- [Tools](./docs/tools.md) — the typed tool-wrapper packages and their tasks.
- [AI code review](./docs/ai-review.md) — gate the build on a structured LLM
  assessment of the diff (`@zuke/ai`).
- [Self-healing builds](./docs/self-healing.md) — diagnose and fix failing
  targets with `recoverWith` and `aiFixer`, including Copilot-style suggestions.
- [Extending Zuke](./docs/extending.md) — the plugin contract: lifecycle
  plugins, tool wrappers, and reusable target bundles.
- [Using Zuke in a Node/npm project](./docs/node-projects.md) — drive a Node
  build with Deno.
- [CLI reference](./docs/cli.md) — commands and flags.
- [Programmatic API](./docs/programmatic-api.md) — drive Zuke from your own
  code.

## Development

```sh
deno task test        # run the suite
deno task cov         # run with coverage + enforce the 95% gate
deno task cov:report  # print a per-file coverage table
deno task check       # type-check
deno task fmt         # format (fmt:check to verify only)
deno task lint        # lint
deno task spell       # spell-check (cspell)
deno task ci          # everything CI runs: fmt:check, lint, spell, check, cov
```

CI runs `deno task ci` on every push and pull request (see
[`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Contributing

Contributions are welcome! Start with [`CONTRIBUTING.md`](./CONTRIBUTING.md) for
the full workflow, and please be mindful of our
[`Code of Conduct`](./CODE_OF_CONDUCT.md).

- Read [`CLAUDE.md`](CLAUDE.md) for the coding standards (strict typing, no
  `any`/`as`, 95%+ coverage, hermetic tests).
- Run `deno task ci` before opening a PR — it must be green.
- Add tests in the same change as the code they cover.
- Keep commits small and descriptive; update docs when behaviour changes.

## Security

As a build tool that runs in other people's pipelines, Zuke treats supply-chain
integrity as a first-class concern: zero runtime dependencies, injection-free
`Deno.Command` execution, OIDC trusted publishing with provenance,
least-privilege and SHA-pinned CI, a frozen lockfile, and continuous scanning.
Scanning runs as a typed Zuke target — `deno task zuke
security` drives zizmor,
actionlint, and gitleaks through [`@zuke/security`](./packages/security) (which
also wraps osv-scanner, semgrep, and Trivy) — alongside CodeQL and OpenSSF
Scorecard for the Security tab.

See [`SECURITY.md`](./SECURITY.md) for the full posture and how to report a
vulnerability.

## License

MIT — see [`LICENSE`](LICENSE).

## Acknowledgements

Zuke stands on the shoulders of giants:

- **[NUKE](https://nuke.build/)** and its creator
  **[Matthias Koch](https://github.com/matkoch)** — the code-first,
  strongly-typed build model that inspired Zuke. If you build for .NET, use
  NUKE; Zuke is an homage to its ideas in the Deno/TypeScript world.
- **[Deno](https://deno.com/)** — the runtime and toolchain (test runner,
  formatter, linter, type-checker, coverage) that makes a zero-dependency,
  hermetic build tool possible.
- **[JSR](https://jsr.io/)** — modern, TypeScript-native package distribution.
- Every author of the tools Zuke wraps — Docker, Kubernetes, Terraform, Vite,
  Playwright, and the rest of the matrix above.

## Community & contact

Questions, ideas, or just want to say hi? Open an
[issue](https://github.com/zuke-build/zuke/issues), or reach out:

<p align="center">
  <a href="https://zuke.build"><img alt="Website" src="https://img.shields.io/badge/Website-zuke.build-000000?style=for-the-badge&logo=googlechrome&logoColor=white" /></a>
  <a href="mailto:contact@zuke.build"><img alt="Email" src="https://img.shields.io/badge/email-contact@zuke.build-8B89CC?style=for-the-badge&logo=protonmail&logoColor=white" /></a>
  <a href="https://todorov.bg"><img alt="Blog" src="https://img.shields.io/badge/Blog-todorov.bg-000000?style=for-the-badge&logo=rss&logoColor=white" /></a>
  <a href="https://twitter.com/totollygeek"><img alt="X" src="https://img.shields.io/badge/@totollygeek-000000?style=for-the-badge&logo=x&logoColor=white" /></a>
  <a href="https://www.linkedin.com/in/totollygeek"><img alt="LinkedIn" src="https://custom-icon-badges.demolab.com/badge/totollygeek-0A66C2?style=for-the-badge&logo=linkedin-white&logoColor=white" /></a>
  <a href="https://infosec.exchange/@totollygeek"><img alt="Mastodon" src="https://img.shields.io/badge/@totollygeek-6364FF?style=for-the-badge&logo=mastodon&logoColor=white" /></a>
  <a href="https://www.threads.net/@totollygeek"><img alt="Threads" src="https://img.shields.io/badge/@totollygeek-000000?style=for-the-badge&logo=threads&logoColor=white" /></a>
  <a href="https://bsky.app/profile/totollygeek.com"><img alt="Bluesky" src="https://img.shields.io/badge/totollygeek.com-0285FF?style=for-the-badge&logo=bluesky&logoColor=white" /></a>
  <a href="https://linktr.ee/totollygeek"><img alt="Linktree" src="https://img.shields.io/badge/totollygeek-39E09B?style=for-the-badge&logo=linktree&logoColor=white" /></a>
</p>

## Activity

[![Repobeats analytics](https://repobeats.axiom.co/api/embed/cfe0a93aaa851e719386dc9469ec91ee1b9cf0d0.svg "Repobeats analytics image")](https://github.com/zuke-build/zuke/pulse)

### Star history

[![RepoStars](https://repostars.dev/api/embed?repo=zuke-build%2Fzuke&theme=dark)](https://repostars.dev/?repos=zuke-build%2Fzuke&theme=dark)

If Zuke is useful to you, consider **starring the repo** — it helps others find
the project. ⭐

### Contributors

<a href="https://github.com/zuke-build/zuke/graphs/contributors">
  <img alt="Contributors" src="https://contrib.rocks/image?repo=zuke-build/zuke" />
</a>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/zuke-build/zuke/raw/master/assets/logo-white.png" />
  <img width="400px" alt="Zuke" src="https://github.com/zuke-build/zuke/raw/master/assets/logo.png" />
</picture>

> A code-first, strongly-typed build automation system for Deno & TypeScript.
> Your build and your CI are one typed file — and your agent can run it.

<p align="center">
  <a href="https://github.com/zuke-build/zuke/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/zuke-build/zuke/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/zuke-build/zuke/actions/workflows/release.yml"><img alt="Release" src="https://github.com/zuke-build/zuke/actions/workflows/release.yml/badge.svg" /></a>
  <a href="https://codecov.io/gh/zuke-build/zuke"><img alt="Coverage" src="https://codecov.io/gh/zuke-build/zuke/branch/master/graph/badge.svg" /></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/zuke-build/zuke"><img alt="OpenSSF Scorecard" src="https://api.scorecard.dev/projects/github.com/zuke-build/zuke/badge" /></a>
  <a href="https://www.bestpractices.dev/projects/14036"><img alt="OpenSSF Best Practices" src="https://www.bestpractices.dev/projects/14036/badge" /></a>
  <a href="https://github.com/marketplace/actions/zuke-build"><img alt="GitHub Marketplace" src="https://img.shields.io/github/v/release/zuke-build/zuke?filter=%21%2A-%2A&amp;label=Marketplace&amp;logo=github&amp;color=2ea44f" /></a>
  <a href="https://jsr.io/@zuke/core"><img alt="JSR" src="https://jsr.io/badges/@zuke/core" /></a>
  <a href="https://jsr.io/@zuke/core"><img alt="JSR score" src="https://jsr.io/badges/@zuke/core/score" /></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-yellow.svg" /></a>
  <a href="https://deno.com/"><img alt="Built for Deno" src="https://img.shields.io/badge/Deno-2.x-000?logo=deno&logoColor=white" /></a>
</p>

Zuke lets you define a build as a **TypeScript class**. Each target is a class
field; targets reference each other by `this.x`, not by string, so a rename is
a refactor and a typo is a compile error. From that one file Zuke resolves the
dependency graph, runs it in order, **generates your CI YAML**, and exposes the
whole thing to **AI agents** as typed tools. Inspired by
[NUKE](https://nuke.build/) for .NET. Zero runtime dependencies.

## Five minutes to a typed build

```sh
deno install -A -g -n zuke jsr:@zuke/cli   # 1. the CLI, once
zuke setup                                  # 2. scaffold zuke.ts + the ./zuke launcher
./zuke                                      # 3. run it
./zuke generate-ci                          # 4. write .github/workflows/ci.yml from the build
```

Step 4 needs one line in the build. Here is the whole file after you have
replaced the scaffolded sample target with real work:

<!-- check -->

```ts
import { Build, cicd, run, target } from "jsr:@zuke/core";
import { DenoTasks } from "jsr:@zuke/deno";

class MyBuild extends Build {
  ci = cicd({ provider: "github" }); // ← the pipeline, generated and verified

  lint = target().executes(() => DenoTasks.lint());

  test = target()
    .dependsOn(this.lint)
    .executes(() => DenoTasks.test((s) => s.allowAll().coverage("cov")));

  default = target().dependsOn(this.test).executes(() => {});
}

await run(MyBuild);
```

`./zuke test` runs `lint` then `test`. `./zuke --list` prints every target with
its description and dependencies. `./zuke graph --output=html` draws the graph.
And the workflow file is regenerated on every run and verified on CI, so the
YAML can never drift from the build.

<p align="center">
  <img src="https://github.com/zuke-build/zuke/raw/master/assets/demo.svg" alt="Zuke in action: scaffold a build, list targets, run the gate" width="760" />
</p>

Already have `package.json` scripts or a `Makefile`? `zuke import` turns them
into a `zuke.ts` with a target per script. Details, the launcher, and a longer
first build: **[Getting started](./docs/getting-started.md)**.

Prefer to poke at something real? [`examples/`](./examples) holds five
cloneable projects — a Deno library gate, a generated-CI-only project, a Node
app, a library release routine, and a shell script turned into targets — each
runnable from its own folder with `deno run -A zuke.ts`.

## Why Zuke

- **Typed, refactor-safe dependencies.** You wire targets together with
  `this.clean`, not `"clean"`. Rename a target and every reference moves with
  it; a typo is a compile error, not a runtime surprise.
- **Never write CI YAML again.** Declare the pipeline in the build with
  `cicd({ provider: "github" })` — the provider is the only required field —
  and Zuke generates GitHub Actions, GitLab CI, Azure Pipelines, or Bitbucket
  YAML. `fanOut: true` turns every target into its own job wired by `needs:`
  edges that mirror `dependsOn`. It is regenerated on every run, and
  `generate-ci --check` fails CI when the committed file has drifted. You run
  the exact same targets locally with `./zuke ci` before you push.
- **Let your agent run the build.** `./zuke mcp` serves the build over the
  [Model Context Protocol](./docs/mcp.md): an agent lists the targets, reads
  the graph, and runs one with typed parameters, instead of guessing
  `npm run what?`. `./zuke --list --json` and the generated
  [`llms.txt`](./llms.txt) are the static counterparts, and the
  [agent skills](./docs/agent-skills.md) teach Claude Code, Codex, and Gemini
  CLI to write a `zuke.ts` the right way.
- **Just TypeScript.** Build logic is ordinary async functions with full editor
  support — no bespoke DSL. The `$` tagged template from `@zuke/core/shell`
  runs processes with sane defaults and is injection-safe, so it also replaces
  the `scripts/*.sh` nobody dares touch.
- **A typed wrapper for every tool.** 58 packages: a tiny core, the CLI, and a
  `*Tasks` object per tool — Deno, npm, pnpm, Bun, Docker, Kubernetes,
  Terraform, Vite, Playwright, GitHub, Claude Code, and the rest — whose
  settings lambdas mirror the real flags. See [Packages](./docs/packages.md).
- **Small and explicit.** Discover targets, build a graph, sort, run. No magic,
  and no plugins to learn for a basic build — the
  [plugin contract](./docs/extending.md) is there once you want one.

See **[How Zuke compares](./docs/comparison.md)** for a capability matrix
against `deno task`, npm scripts, Make, Nx, Turborepo, and Dagger.

## Who's using Zuke

Teams running Zuke in production:

<a href="https://payhawk.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://github.com/zuke-build/zuke/raw/master/assets/users/payhawk-white.svg" />
    <img width="170px" alt="Payhawk" src="https://github.com/zuke-build/zuke/raw/master/assets/users/payhawk.svg" />
  </picture>
</a>

> Using Zuke at your company? We'd love to list you — open a pull request adding
> your logo to `assets/users/` and an entry to this section, or say hello in an
> [issue](https://github.com/zuke-build/zuke/issues) and we'll add it for you.

## Install

Zuke runs on [Deno](https://deno.com/) and is imported straight from
[JSR](https://jsr.io/@zuke) — there is nothing else to install. The scaffolded
`./zuke` launcher (and `zuke.ps1` on Windows) runs the build with the Deno on
your `PATH`; for a checkout that needs **nothing** installed up front, copy
Zuke's own [`zuke`](./zuke) / [`zuke.ps1`](./zuke.ps1), which bootstrap a
pinned, checksum-verified Deno on first use.

```sh
deno install -A -g -n zuke jsr:@zuke/cli   # the CLI: setup, import, doc
zuke setup                                  # or: deno run -A jsr:@zuke/cli setup
zuke import                                 # migrate package.json scripts / a Makefile instead
```

> [!NOTE]
> **Maturity.** Every one of the 58 packages is `1.x` and follows full semver —
> `@zuke/core`, the `@zuke/cli` command, and all the tool wrappers. A minor or
> patch release never breaks a public symbol; a breaking change bumps the major.
> See [Versioning & compatibility](./docs/versioning.md). The npm scope `@zuke`
> is not controlled by this project — install from JSR, not npm.

> [!NOTE]
> **Built with AI.** Much of Zuke — code, tests, and docs — was written with AI
> assistance, then reviewed, type-checked, and tested in CI. Sharing how it was
> made so you know what you're getting.

## GitHub Actions

The [**Zuke Build**](https://github.com/marketplace/actions/zuke-build) action
is the whole prelude a Zuke job needs — it hardens the runner, checks the
repository out, and runs a target, in one step:

```yaml
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: zuke-build/zuke@v1
        with:
          target: ci
```

Pin the full commit SHA rather than the moving `v1` tag when you commit it, as
you would any other action. Zuke's own six workflows all open with it,
generated from the build. Every input, the `egress-policy` default, and why
`ref` is refused on contributor-controlled events:
[the action section](./docs/getting-started.md#the-zuke-buildzuke-action).

## Packages

Zuke ships as a JSR workspace of 58 packages: [`@zuke/core`](https://jsr.io/@zuke/core)
(the engine, the `$` shell, and the tooling base classes), the
[`@zuke/cli`](https://jsr.io/@zuke/cli) command, a generic
[`@zuke/cmd`](https://jsr.io/@zuke/cmd) fallback, plugins such as
[`@zuke/ai`](https://jsr.io/@zuke/ai), [`@zuke/console`](https://jsr.io/@zuke/console)
and [`@zuke/otel`](https://jsr.io/@zuke/otel), and a typed wrapper per tool —
[`@zuke/deno`](https://jsr.io/@zuke/deno), [`@zuke/npm`](https://jsr.io/@zuke/npm),
[`@zuke/docker`](https://jsr.io/@zuke/docker), [`@zuke/gh`](https://jsr.io/@zuke/gh),
[`@zuke/git`](https://jsr.io/@zuke/git), [`@zuke/kubectl`](https://jsr.io/@zuke/kubectl),
[`@zuke/terraform`](https://jsr.io/@zuke/terraform), [`@zuke/vite`](https://jsr.io/@zuke/vite),
[`@zuke/playwright`](https://jsr.io/@zuke/playwright), and more.

The full matrix with live JSR badges is in **[Packages](./docs/packages.md)**.
The complete typed surface of every package is in
[`llms-full.txt`](./llms-full.txt) (one file), summarised in
[`llms.txt`](./llms.txt); for a single package run `deno doc jsr:@zuke/<package>`.

## AI in your pipeline

Three ways a model joins the build, each a typed target with refactor-safe
dependencies:

- **Drive the coding CLIs.** [`@zuke/claude`](https://jsr.io/@zuke/claude),
  [`@zuke/codex`](https://jsr.io/@zuke/codex) and
  [`@zuke/gemini`](https://jsr.io/@zuke/gemini) run Claude Code, OpenAI Codex
  and Gemini CLI **non-interactively** — a prompt, a model, a constrained tool
  set, JSON out — with the API key riding a `parameter().secret()` that Zuke
  masks in CI output. See [Tools](./docs/tools.md).
- **AI code review that breaks the build.** [`@zuke/ai`](https://jsr.io/@zuke/ai)
  reads the diff, returns a _structured_ assessment (score, severity, findings),
  posts it to the pull request, and fails the run when the risk crosses your
  threshold. See [AI code review](./docs/ai-review.md).
- **Self-healing targets.** Attach `.recoverWith(aiFixer(…))` to any target:
  on failure it diagnoses from the error and the diff and posts a committable
  suggestion — or, opted in, applies the fix, commits, and **re-runs the real
  command to verify**. `agentFixer` hands the failure to a coding agent
  instead. A shared `budget(…)` caps spend by token count. See
  [Self-healing builds](./docs/self-healing.md).

```ts
test = target()
  .executes(() => DenoTasks.test((s) => s.allowAll()))
  // On failure: diagnose, post a committable suggestion, optionally heal.
  .recoverWith(aiFixer((f) => f.provider("openai").apiKey(this.key)));
```

## Agent skills

Two skills — `zuke-setup` and `zuke-write-build` — teach an AI coding assistant
to scaffold Zuke and write a `zuke.ts` using the typed wrappers instead of
guessing the API. Authored once as portable [Agent Skills](https://agentskills.io)
under [`skills/`](./skills), and installable into every harness:

```text
/plugin marketplace add zuke-build/zuke && /plugin install zuke@zuke   # Claude Code
codex plugin marketplace add zuke-build/zuke && codex plugin add zuke@zuke
gemini extensions install https://github.com/zuke-build/zuke
```

Per-harness details: **[Agent skills](./docs/agent-skills.md)**.

## Documentation

Start here, then browse the full index in [`docs/`](./docs/README.md):

- [Getting started](./docs/getting-started.md) — install, scaffold, the
  launcher, `zuke import`, and a first build.
- [Core concepts](./docs/concepts.md) — the build/target/graph model and
  execution semantics.
- [Authoring API](./docs/authoring.md) — `target()`, `Build`, `run()`,
  code-first CI generation (`cicd()`), and gotchas.
- [Parameters](./docs/parameters.md) and [Secrets](./docs/secrets.md) — typed
  build inputs from flags and env vars, and secret values with guaranteed
  redaction.
- [Shell wrapper (`$`)](./docs/shell.md) — ergonomic, injection-safe process
  execution.
- [Packages](./docs/packages.md) and [Tools](./docs/tools.md) — the package
  matrix, and every wrapper's tasks.
- [Using Zuke in a Node/npm project](./docs/node-projects.md) — drive a Node
  build with Deno.
- [MCP server](./docs/mcp.md) and [Agent skills](./docs/agent-skills.md) —
  the build as typed tools for an agent, and the skills that teach one to
  write it.
- [Caching](./docs/caching.md), [Service targets](./docs/services.md),
  [Durable run state](./docs/state.md), [Cross-run locks](./docs/locks.md),
  [Orchestration: waits](./docs/orchestration.md) — the layer for real
  deployments.
- [CLI reference](./docs/cli.md), [Programmatic API](./docs/programmatic-api.md),
  [Versioning & compatibility](./docs/versioning.md),
  [How Zuke compares](./docs/comparison.md).

## Development

```sh
deno task test        # run the suite
deno task cov         # run with coverage + enforce the 95% gate
deno task check       # type-check
deno task fmt         # format (fmt:check to verify only)
deno task lint        # lint
deno task spell       # spell-check (cspell)
deno task ci          # the full gate — deno run -A --frozen zuke.ts ci
```

`deno task ci` **is** `./zuke ci`, the same gate the `ci` job in
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push and
pull request — see [`AGENTS.md`](./AGENTS.md#commands) for the full check list.

## Contributing

Contributions are welcome! Start with [`CONTRIBUTING.md`](./CONTRIBUTING.md) for
the full workflow, and please be mindful of our
[`Code of Conduct`](./CODE_OF_CONDUCT.md). [`AGENTS.md`](AGENTS.md) holds the
coding standards (strict typing, no `any`/`as`, 95%+ coverage, hermetic tests);
`CLAUDE.md` is a one-line pointer to it. Run `deno task ci` before opening a PR,
add tests in the same change as the code they cover, and update docs when
behaviour changes.

## Security

As a build tool that runs in other people's pipelines, Zuke treats supply-chain
integrity as a first-class concern: zero runtime dependencies, injection-free
`Deno.Command` execution, OIDC trusted publishing with provenance,
least-privilege and SHA-pinned CI, a frozen lockfile, and continuous scanning
(zizmor, actionlint, gitleaks, CodeQL, and OpenSSF Scorecard) driven by a typed
Zuke target through [`@zuke/security`](./packages/security). See
[`SECURITY.md`](./SECURITY.md) for the full posture and how to report a
vulnerability.

## License

MIT — see [`LICENSE`](LICENSE).

## Acknowledgements

Zuke stands on the shoulders of giants:

- **[NUKE](https://nuke.build/)** and its creator
  **[Matthias Koch](https://github.com/matkoch)** — the code-first,
  strongly-typed build model that inspired Zuke. If you build for .NET, use
  NUKE; Zuke is an homage to its ideas in the Deno/TypeScript world.
- **[Spectre.Console](https://spectreconsole.net/)** and its creator
  **[Patrik Svensson](https://github.com/patriksvensson)** — the .NET console
  library whose markup, themes, and rich widgets (rules, panels, tables)
  inspired the output model of `@zuke/console`.
- **[Deno](https://deno.com/)** — the runtime and toolchain (test runner,
  formatter, linter, type-checker, coverage) that makes a zero-dependency,
  hermetic build tool possible.
- **[JSR](https://jsr.io/)** — modern, TypeScript-native package distribution.
- Every author of the tools Zuke wraps — Docker, Kubernetes, Terraform, Vite,
  Playwright, and the rest of the matrix.

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

<details>
<summary><strong>Swag, activity &amp; contributors</strong></summary>

### Swag

Zuke has a swag shop! Grab some Zuke-branded apparel and accessories and wear
the build:

<p align="center">
  <a href="https://totollyshop.myspreadshop.net/"><img alt="Zuke swag shop" src="https://img.shields.io/badge/Swag_shop-totollyshop.myspreadshop.net-F5A623?style=for-the-badge" /></a>
</p>

👉 **<https://totollyshop.myspreadshop.net/>**

### Activity

[![Repobeats analytics](https://repobeats.axiom.co/api/embed/cfe0a93aaa851e719386dc9469ec91ee1b9cf0d0.svg "Repobeats analytics image")](https://github.com/zuke-build/zuke/pulse)

### Star history

[![RepoStars](https://repostars.dev/api/embed?repo=zuke-build%2Fzuke&theme=dark)](https://repostars.dev/?repos=zuke-build%2Fzuke&theme=dark)

If Zuke is useful to you, consider **starring the repo** — it helps others find
the project. ⭐

### Contributors

<a href="https://github.com/zuke-build/zuke/graphs/contributors">
  <img alt="Contributors" src="https://contrib.rocks/image?repo=zuke-build/zuke" />
</a>

</details>

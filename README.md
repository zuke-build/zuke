<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/zuke-build/zuke/raw/master/assets/logo-white.png" />
  <img width="400px" alt="Zuke" src="https://github.com/zuke-build/zuke/raw/master/assets/logo.png" />
</picture>

> A code-first, strongly-typed build automation system for Deno & TypeScript.

> [!WARNING]
> **Under heavy development — not production ready.** Zuke is pre-1.0 and
> evolving fast. APIs across all `@zuke/*` packages can change without notice
> within `0.x`. Pin exact versions and expect breakage until a `1.0` release.

> [!NOTE]
> **Largely AI-written.** Much of this project — code, tests, and docs — was
> generated with AI assistance. Take it with a grain of salt: review before you
> rely on it, and don't assume anything is battle-tested.

Zuke lets you define builds as a **TypeScript class**. Each target is a class
field declared with a fluent API; targets reference each other by `this.x` (not
strings), forming a dependency graph that Zuke resolves and runs in topological
order. Inspired by [NUKE](https://nuke.build/) for .NET.

- **Runtime:** Deno
- **Packages:** `jsr:@zuke/core` plus typed tool wrappers `jsr:@zuke/deno`,
  `jsr:@zuke/npm`, `jsr:@zuke/bun`, `jsr:@zuke/pnpm`, `jsr:@zuke/yarn`,
  `jsr:@zuke/docker`, `jsr:@zuke/docker-compose`, `jsr:@zuke/kubectl`,
  `jsr:@zuke/oxlint`, `jsr:@zuke/eslint`, `jsr:@zuke/biome`, `jsr:@zuke/knip`,
  `jsr:@zuke/cspell`, `jsr:@zuke/jest`, `jsr:@zuke/vitest`,
  `jsr:@zuke/playwright`, `jsr:@zuke/cypress`, `jsr:@zuke/vite`,
  `jsr:@zuke/tsup`, `jsr:@zuke/turbo`, `jsr:@zuke/nx`, `jsr:@zuke/jsr`,
  `jsr:@zuke/tsx`, `jsr:@zuke/tsgo`, `jsr:@zuke/dprint`,
  `jsr:@zuke/gcloud`, `jsr:@zuke/git`, `jsr:@zuke/gh`, `jsr:@zuke/terraform`,
  `jsr:@zuke/tofu`, `jsr:@zuke/security`, `jsr:@zuke/cmd` (raw shell via
  `jsr:@zuke/core/shell`)
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

## Documentation

Full documentation lives in [`docs/`](./docs/):

- [Getting started](./docs/getting-started.md) — install, scaffold, the
  launcher, and a first build.
- [Core concepts](./docs/concepts.md) — the build/target/graph model and
  execution semantics.
- [Parameters](./docs/parameters.md) — typed build inputs from flags and env
  vars (`parameter()`, `this.x.value`).
- [Authoring API](./docs/authoring.md) — `target()`, `Build`, `run()`, and
  gotchas.
- [Shell wrapper (`$`)](./docs/shell.md) — ergonomic, injection-safe process
  execution.
- [Paths (`absolutePath`)](./docs/paths.md) — the fluent path type.
- [Tools](./docs/tools.md) — the typed tool-wrapper packages and their tasks.
- [Using Zuke in a Node/npm project](./docs/node-projects.md) — drive a Node
  build with Deno.
- [CLI reference](./docs/cli.md) — commands and flags.
- [Programmatic API](./docs/programmatic-api.md) — drive Zuke from your own code.

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

- Read [`CLAUDE.md`](CLAUDE.md) for the coding standards (strict typing, no
  `any`/`as`, 95%+ coverage, hermetic tests).
- Run `deno task ci` before opening a PR — it must be green.
- Add tests in the same change as the code they cover.
- Keep commits small and descriptive; update docs when behaviour changes.

## Security

As a build tool that runs in other people's pipelines, Zuke treats
supply-chain integrity as a first-class concern: zero runtime dependencies,
injection-free `Deno.Command` execution, OIDC trusted publishing with
provenance, least-privilege and SHA-pinned CI, a frozen lockfile, and
continuous scanning. Scanning runs as a typed Zuke target — `deno task zuke
security` drives zizmor, actionlint, and gitleaks through
[`@zuke/security`](./packages/security) (which also wraps osv-scanner, semgrep,
and Trivy) — alongside CodeQL and OpenSSF Scorecard for the Security tab.

See [`SECURITY.md`](./SECURITY.md) for the full posture and how to report a
vulnerability.

## License

MIT — see [`LICENSE`](LICENSE).

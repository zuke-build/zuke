# Getting started

You need [Deno](https://deno.com/) installed. There's nothing else to install —
Zuke is imported straight from JSR.

> [!NOTE]
> All `@zuke/*` packages — the 72-package workspace: `@zuke/core`, the
> `@zuke/cli` command, a generic `@zuke/cmd` fallback, and 50+ typed tool
> wrappers and plugins (`@zuke/deno`, `@zuke/npm`, `@zuke/docker`, `@zuke/ai`,
> …) — publish to [JSR](https://jsr.io/@zuke) from CI via release-please and
> OIDC (see [`RELEASING.md`](../RELEASING.md)). The npm scope `@zuke` is not
> controlled by this project — install from JSR, not npm.

## Scaffold a project with `zuke setup`

The fastest start is the `@zuke/cli` tool. Install it once, then scaffold a
starter `build.ts`, the `./zuke` launchers, a `deno.json` task, and a
`zuke.json` config (which marks the repo root — see
[paths](./paths.md#repo-root-reporoot)) into any directory. The build file is
`build.ts` for a new project; the wizard asks, `--build-file <name>` answers up
front, and the name is recorded in `zuke.json`. A project that already has a
`zuke.ts` keeps it:

```sh
deno install -A -g -n zuke jsr:@zuke/cli   # once
zuke setup                                  # in your project
zuke                                        # run the build
```

On macOS or Linux without Deno, `brew install zuke-build/tap/zuke` installs the
same CLI as a signed standalone binary instead, and on Windows
`choco install zuke` installs it through Chocolatey (not Authenticode-signed
yet); the `./zuke` launcher that `zuke setup` writes then installs Deno the
first time `zuke` runs the build. Every route is covered, with how to verify a
download, in [installing](./install.md).

Without installing, the same wizard runs via `deno run -A jsr:@zuke/cli setup`
(flags: `--dir <path>`, `--name <Class>`, `--force`, `--yes`, `--mcp`,
`--bootstrap` / `--no-bootstrap`). Pass `--mcp` to also write a `.mcp.json` that
registers the build's [MCP server](./mcp.md), so Claude Code, Codex or any stdio
MCP client can list the targets and run one through typed calls from day one
(`--allow-run` lets the agent execute targets, not just inspect them). The
wizard asks which launchers you want: by default they bootstrap a pinned,
checksum-verified Deno when none is on `PATH` — the same scripts this repository
runs on — so a clone needs nothing installed first; `--no-bootstrap` writes
launchers that require Deno on `PATH` and fail closed without it. If a `zuke/`
directory already occupies the launcher's name, setup stops with an actionable
error — pass `--launcher-name <name>` to write the launcher (and its `.ps1`)
under a different name.

Already have a `@zuke/*` package's API in hand? `zuke doc <package>` prints it
(`zuke doc core`, `zuke doc @scope/pkg`), running `deno doc` in an isolated
directory so a surrounding Node project's `@types/node` resolution doesn't drown
the output.

## Scaffold a Python project with `zuke setup --sdk python`

A build can be written in Python with the
[`zuke` package](https://github.com/zuke-build/zuke-python) and run on
`@zuke/engine`, which hosts it as a worker. The same wizard scaffolds that
shape:

```sh
zuke setup --sdk python                     # in your project
zuke                                        # run the build
```

It writes a starter `build.py` (with inline script metadata, so
`uv run build.py` installs the SDK by itself), a `zuke.json` naming the worker
command and the exact `@zuke/engine` release to run it on, the launchers and a
`.gitignore`, and no `deno.json`. A Python project needs **no Deno, anywhere**:
only Python, uv and the standalone `zuke` binary, which carries the engine and
every tool wrapper.

The launchers pin one `zuke` release, by default the one that ran the setup
(`--zuke <version>` names another). `zuke.json` pins the engine inside it. On
first use a launcher downloads that release from GitHub, verifies it against the
SHA-256 it pins and keeps it in `~/.zuke`, so a clone, a CI job included, needs
nothing installed up front but uv. `--no-bootstrap` writes launchers that
require `zuke` on `PATH` instead. Move the project to a newer release later with
`zuke upgrade --engine [<version>]`, which rewrites the launchers and the pin.
The other `setup` flags apply as they do for a TypeScript build. `--mcp`
registers the build's MCP server as `zuke mcp`, which needs no Deno either.

With the `zuke` command installed, a Python build is driven exactly as a
TypeScript one, from anywhere inside the project and with no launcher:
`zuke <target>`, `zuke --list`, `zuke graph`, `zuke generate-ci`, `zuke mcp`,
and `zuke --version`, which names the `zuke.json` and the engine release it
runs. The launchers are for a machine without the CLI, such as a CI runner.
`zuke add`, `remove`, `cache` and `relock` work on a project's own Deno code, so
they refuse a Python build: its tool wrappers come with the SDK, as
`zuke.tools`.

## Migrate an existing project with `zuke import`

Already have `package.json` scripts or a `Makefile`? `zuke import` reads them
and generates a `build.ts` with a target per task — a working starting point you
then refine into typed wrappers, instead of a blank page:

```sh
zuke import                 # auto-detects package.json, then a Makefile, then pyproject.toml
zuke import --from makefile  # or pin the source
```

Each script/target becomes a `target()`; a command maps to `CmdTasks.exec(...)`,
an `&&` chain becomes sequential steps, a `package.json` `run` delegation (or a
Makefile prerequisite) becomes `.dependsOn(...)`, and a command too
shell-specific to translate (pipes, redirects, env assignments) is preserved
behind a `// TODO` so the file still compiles and the tricky bits are flagged.
It also scaffolds the launchers and `deno.json`, exactly like `zuke setup`.
Flags: `--from <package.json|makefile|pyproject>`, plus the same `--dir`,
`--name`, `--force`, `--yes`.

A Python project's `pyproject.toml` (poe, pdm, hatch, taskipy or rye tasks) is
read last, and becomes a `build.py` scaffolded as `zuke setup --sdk python`
does, each command run through `await ctx.sh(...)`; `--zuke <version>` pins the
`zuke` release its launchers run. See
[the CLI reference](./cli.md#the-global-zuke-cli-jsrzukecli).

## Run it yourself

Or write the build file by hand: put a `build.ts` in your project root beside a
`zuke.json` holding `{ "build": "build.ts" }` (the file marks the root — see
[paths](./paths.md#repo-root-reporoot) — and names the build file; with no
`build` field the build file is `zuke.ts`), and run it:

```sh
zuke <target>
```

With no launcher in the root, `zuke` runs the build as `deno run -A build.ts`:
the `-A` grants permissions (your targets typically run processes, read/write
files, etc.).

## `./zuke` launcher (no Deno required up front)

On a machine without the CLI — a CI runner — the committed launchers run the
build: [`zuke`](../zuke) (bash) and [`zuke.ps1`](../zuke.ps1) (PowerShell),
which `zuke setup` and `zuke import` write into your repo root. They locate the
project, **install Deno on first use if it's missing** (pinned by default, and
verified against a per-platform SHA-256; override with `DENO_VERSION` plus its
`DENO_SHA256`), then run `build.ts` — so a fresh checkout needs nothing but the
script:

```sh
./zuke ci          # full gate          (Windows: .\zuke.ps1 ci)
./zuke test        # type-check + tests  (Windows: .\zuke.ps1 test)
```

`--no-bootstrap` scaffolds launchers that use the Deno on `PATH` instead and
fail closed without it. If you already have Deno, `deno task zuke <target>` (via
the `zuke` task in `deno.json`) does the same thing.

Day to day you don't call the launcher yourself: `zuke <target>`, from anywhere
inside the project, forwards to it (the [CLI reference](./cli.md) has the
rules). Shell completions (`zuke completions install <shell>`) register the
words `zuke` and `./zuke`, so both forms complete targets;
`deno task zuke <target>` does not, because the shell matches the completion on
the first word of the line.

## Quick start

<!-- check -->

```ts
// build.ts
import { Build, run, target } from "@zuke/core";
import { DenoTasks } from "@zuke/deno";

class MyBuild extends Build {
  clean = target()
    .description("Remove build artifacts")
    .executes(async () => {
      await Deno.remove("dist", { recursive: true }).catch(() => {});
    });

  restore = target()
    .description("Cache dependencies")
    .executes(async () => {
      await DenoTasks.cache((s) => s.paths("mod.ts"));
    });

  compile = target()
    .description("Type-check and build")
    .dependsOn(this.clean, this.restore)
    .executes(async () => {
      await DenoTasks.check((s) => s.paths("mod.ts"));
    });

  test = target()
    .description("Run the test suite")
    .dependsOn(this.compile)
    .executes(async () => {
      await DenoTasks.test((s) => s.allowAll());
    });

  // Optional: runs when you invoke `./zuke` with no target.
  default = target().dependsOn(this.test).executes(() => {});
}

await run(MyBuild);
```

```sh
zuke test     # clean → restore → compile → test
zuke          # runs `default` (→ test)
zuke --list   # show all targets
```

Example output:

```
▶ clean
✔ clean (0.0s)
▶ restore
✔ restore (0.3s)
▶ compile
✔ compile (1.1s)
▶ test
✔ test (2.4s)

Build summary:
  ✔ clean    0.0s
  ✔ restore  0.3s
  ✔ compile  1.1s
  ✔ test     2.4s

✔ SUCCESS — 4/4 targets in 3.8s
```

Every run ends with a summary listing each target's status (`✔` passed, `✘`
failed, `⊘` skipped) and duration, plus the total.

In a terminal, consecutive targets are separated by a blank line and the output
is coloured (bold headers, green/red/dim status). Colour is used when stdout is
a TTY and `NO_COLOR` is unset; piped output stays plain.

## GitHub Actions

When Zuke detects it's running under GitHub Actions (`GITHUB_ACTIONS=true`), it
switches to that runner's log conventions automatically — no configuration:

- each target becomes a **collapsible log group**, so the workflow log is tidy
  and every target is easy to find;
- a failing target emits an **`::error::` annotation** (surfaced on the run and
  in the diff); and
- the per-target summary is also written to the **job summary** as a table.

### The `zuke-build/zuke` action

The steps every Zuke job starts with — harden the runner, check out, run a
target — are published as a composite action, so a workflow does not repeat
them:

```yaml
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: zuke-build/zuke@v1
        with:
          target: ci
```

It is the **first** step: a remote action is fetched by the runner, not from
your workspace, so it needs no checkout before it — which is the point, since
[`step-security/harden-runner`](https://github.com/step-security/harden-runner)
only governs what runs after it.

| Input                 | Default | What it does                                                                                                                    |
| --------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `target`              | `""`    | The Zuke target to run. Omit to harden and check out only.                                                                      |
| `egress-policy`       | `audit` | `audit` records outbound traffic; `block` enforces `allowed-endpoints`.                                                         |
| `allowed-endpoints`   | `""`    | Space-separated `host:port` list permitted under `block`.                                                                       |
| `persist-credentials` | `false` | Leave the token in git config, for a later push.                                                                                |
| `fetch-depth`         | `1`     | Commits to fetch. `0` is the full history, which a secret scan needs.                                                           |
| `ref`                 | `""`    | Branch, tag or SHA to check out. Empty follows the event — the base or default branch on a secret-bearing one. See below.       |
| `deno-version`        | `""`    | Install this Deno. Usually unnecessary — the `./zuke` launcher bootstraps its own.                                              |
| `actions-cache`       | `false` | Expose the Actions cache service to the build, so its [remote cache](./caching.md#on-github-actions) shares outputs through it. |

Running a target needs a committed `./zuke` launcher in the repository (that is
what `zuke setup` writes); the step fails with an annotation saying so if there
isn't one. A job that only wants the hardening and the checkout omits `target`
and gets neither requirement.

#### Pin it, as you would any other action

`@v1` is a tag that moves. Whoever can move it can run code in your job — and
because you have delegated your hardening to this step, a moved tag could simply
not harden. Pin the full commit SHA, with the version beside it, exactly as this
repository pins the actions it consumes and as
[its Scorecard](https://scorecard.dev/viewer/?uri=github.com/zuke-build/zuke)
grades it for:

```yaml
- uses: zuke-build/zuke@<40-character-sha> # v1.0.0
  with:
    target: ci
```

Dependabot bumps that line for you and writes the new version into the comment.
The `@v1` form above is the shorter thing to read in a snippet; it is not the
thing to commit.

#### `egress-policy` starts at `audit`, not `block`

Note the divergence: harden-runner's own default is `block`, and this action's
is `audit`. That is deliberate — `block` with an empty `allowed-endpoints` fails
a build on its first outbound request, which is a poor first run — but it means
the default configuration **records** egress rather than enforcing it. To
actually enforce, run once on `audit`, take the endpoint list from the run's
insights, and then set both:

```yaml
- uses: zuke-build/zuke@<40-character-sha> # v1.0.0
  with:
    target: ci
    egress-policy: block
    allowed-endpoints: "jsr.io:443 deno.land:443 dl.deno.land:443"
```

One caveat worth confirming before you rely on it: harden-runner's blocking
support has historically been Linux-only on GitHub-hosted runners, degrading to
audit on macOS and Windows rather than failing. A matrix job that sets `block`
may therefore be enforcing on one leg and recording on the others. Check
[harden-runner's own docs](https://github.com/step-security/harden-runner) for
the version you have pinned.

#### `ref` is refused on every secret-bearing event

`ref` checks out something other than what the event points at — the head branch
of a pull request, say, so a job can push a fix back to it. On `pull_request`
that is ordinary: the token is read-only and secrets are absent.

On **`pull_request_target`** it is not. That event runs with the base
repository's secrets and a writable token, so a `ref` aimed at a contributor's
head puts _their_ `build.ts` in the workspace — and the last step executes it.
No configuration makes that safe, so the action refuses it outright:

```
Error: Refusing to check out a custom ref on a pull_request_target event: it
runs with this repository's secrets and a writable token, so checking out a ref
a contributor controls hands them both. Use 'pull_request', or drop the 'ref'
input.
```

The guard is an **allow-list, not a deny-list for one event**. A custom `ref` is
permitted only on `pull_request`, `push`, `merge_group`, `workflow_dispatch`,
`schedule` and `release`; every other event — `issue_comment`, `workflow_run`,
and anything GitHub adds later — is refused. A deny-list of what is dangerous
today would be silently wrong the moment the list grew.

It is also **not keyed on `target`**: a `ref` checkout with no target is refused
just the same, because a caller who omits it and writes `run: ./zuke ci` in
their own next step reaches the identical outcome.

**Leaving `ref` empty is the safe default, on those events too**, and the guard
deliberately does not touch it. An empty `ref` is passed straight through to
`actions/checkout`, which then follows `GITHUB_REF`/`GITHUB_SHA` — and on
`pull_request_target` that pair is the **base** branch and its tip, not the
contributor's head; on `issue_comment` and `workflow_run` it is the default
branch. So the workspace holds code that is already trusted, which is what makes
the standard base-checkout pattern possible at all. Refusing an empty `ref`
would refuse every such job while protecting nothing: what a pwn-request needs
is a `ref` pointing at the head, and that is the case the guard rejects.

Zuke's own six workflows all start with the published action — the generated
YAML opens with `uses: zuke-build/zuke@<sha>`, so the repository dogfoods the
same entry point it ships.

---

Next: [Core concepts](./concepts.md) · [Authoring API](./authoring.md) ·
[Tools](./tools.md)

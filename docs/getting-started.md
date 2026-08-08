# Getting started

You need [Deno](https://deno.com/) installed. There's nothing else to install —
Zuke is imported straight from JSR.

> [!NOTE]
> All `@zuke/*` packages — the 54-package workspace: `@zuke/core`, the
> `@zuke/cli` command, a generic `@zuke/cmd` fallback, and 50+ typed tool
> wrappers and plugins (`@zuke/deno`, `@zuke/npm`, `@zuke/docker`, `@zuke/ai`,
> …) — publish to [JSR](https://jsr.io/@zuke) from CI via release-please and
> OIDC (see [`RELEASING.md`](../RELEASING.md)). The npm scope `@zuke` is not
> controlled by this project — install from JSR, not npm.

## Scaffold a project with `zuke setup`

The fastest start is the `@zuke/cli` tool. Install it once, then scaffold a
starter `zuke.ts`, the `./zuke` launchers, a `deno.json` task, and a `zuke.json`
config (which marks the repo root — see [paths](./paths.md#repo-root-reporoot))
into any directory:

```sh
deno install -A -g -n zuke jsr:@zuke/cli   # once
zuke setup                                  # in your project
./zuke                                      # run the build
```

Without installing, the same wizard runs via `deno run -A jsr:@zuke/cli setup`
(flags: `--dir <path>`, `--name <Class>`, `--force`, `--yes`). If a `zuke/`
directory already occupies the launcher's name, setup stops with an actionable
error — pass `--launcher-name <name>` to write the launcher (and its `.ps1`)
under a different name.

Already have a `@zuke/*` package's API in hand? `zuke doc <package>` prints it
(`zuke doc core`, `zuke doc @scope/pkg`), running `deno doc` in an isolated
directory so a surrounding Node project's `@types/node` resolution doesn't drown
the output.

## Migrate an existing project with `zuke import`

Already have `package.json` scripts or a `Makefile`? `zuke import` reads them
and generates a `zuke.ts` with a target per task — a working starting point you
then refine into typed wrappers, instead of a blank page:

```sh
zuke import                 # auto-detects package.json, then a Makefile
zuke import --from makefile  # or pin the source
```

Each script/target becomes a `target()`; a command maps to `CmdTasks.exec(...)`,
an `&&` chain becomes sequential steps, a `package.json` `run` delegation (or a
Makefile prerequisite) becomes `.dependsOn(...)`, and a command too
shell-specific to translate (pipes, redirects, env assignments) is preserved
behind a `// TODO` so the file still compiles and the tricky bits are flagged.
It also scaffolds the launchers and `deno.json`, exactly like `zuke setup`.
Flags: `--from
<package.json|makefile>`, plus the same `--dir`, `--name`,
`--force`, `--yes`.

## Run it yourself

Or just create a `zuke.ts` in your project root and run it with Deno:

```sh
deno run -A zuke.ts <target>
```

The `-A` grants permissions (your targets typically run processes, read/write
files, etc.).

## `./zuke` launcher (no Deno required up front)

For a one-command `./build.sh`-style experience, drop the bootstrap launchers
[`zuke`](../zuke) (bash) and [`zuke.ps1`](../zuke.ps1) (PowerShell) in your repo
root. They locate the project, **install Deno on first use if it's missing**
(pinned by default, and verified against a per-platform SHA-256; override with
`DENO_VERSION` plus its `DENO_SHA256`), then run `zuke.ts` — so a fresh checkout
needs nothing but the script:

```sh
./zuke ci          # full gate          (Windows: .\zuke.ps1 ci)
./zuke test        # type-check + tests  (Windows: .\zuke.ps1 test)
./zuke --list      # list every target
```

The launchers `zuke setup` scaffolds are simpler: they run `zuke.ts` with the
Deno on `PATH` and point at Deno's install docs when it is missing, since a
generated launcher has no pinned checksum to verify a download against. Copy the
two launchers above into your repo when you want the verified bootstrap too.

If you already have Deno, `deno task zuke <target>` (via the `zuke` task in
`deno.json`) does the same thing.

`zuke setup`/`zuke import` scaffold this launcher for you, so once it's in place
run every target with `./zuke <target>` — the bare `zuke` you installed globally
only knows `setup`/`import`/`doc` (see the [CLI reference](./cli.md) for the
full split). Shell completions (`./zuke completions install <shell>`) register
the words `zuke` and `./zuke`, so those two forms complete targets;
`deno task zuke <target>` does not, because the shell matches the completion on
the first word of the line.

## Quick start

```ts
// zuke.ts
import { Build, run, target } from "jsr:@zuke/core";
import { DenoTasks } from "jsr:@zuke/deno";

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
deno run -A zuke.ts test     # clean → restore → compile → test
deno run -A zuke.ts          # runs `default` (→ test)
deno run -A zuke.ts --list   # show all targets
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

| Input                 | Default | What it does                                                                       |
| --------------------- | ------- | ---------------------------------------------------------------------------------- |
| `target`              | `""`    | The Zuke target to run. Omit to harden and check out only.                         |
| `egress-policy`       | `audit` | `audit` records outbound traffic; `block` enforces `allowed-endpoints`.            |
| `allowed-endpoints`   | `""`    | Space-separated `host:port` list permitted under `block`.                          |
| `persist-credentials` | `false` | Leave the token in git config, for a later push.                                   |
| `fetch-depth`         | `1`     | Commits to fetch. `0` is the full history, which a secret scan needs.              |
| `ref`                 | `""`    | Branch, tag or SHA to check out. Empty follows the event. See the warning below.   |
| `deno-version`        | `""`    | Install this Deno. Usually unnecessary — the `./zuke` launcher bootstraps its own. |

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

#### `ref` on `pull_request_target` is refused

`ref` checks out something other than what the event points at — the head
branch of a pull request, say, so a job can push a fix back to it. On
`pull_request` that is ordinary: the token is read-only and secrets are absent.

On **`pull_request_target`** it is not. That event runs with the base
repository's secrets and a writable token, so a `ref` aimed at a contributor's
head puts *their* `zuke.ts` in the workspace — and the last step executes it.
No configuration makes that safe, so the action refuses the combination
outright rather than warning about it:

```
Error: Refusing to check out a custom ref and run a Zuke target on a
pull_request_target event: that executes the checked-out repository's build
file with this repository's secrets.
```

Checking a ref out *without* running a target is not that bug, and neither is
any of it on `pull_request`. Both keep working.

Zuke's own workflows do **not** use it yet — `uses: ./` resolves inside the
workspace, so it would need the very checkout it exists to precede. They inline
the same steps, generated from the pins in `action.yml` itself.

---

Next: [Core concepts](./concepts.md) · [Authoring API](./authoring.md) ·
[Tools](./tools.md)

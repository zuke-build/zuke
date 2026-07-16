# Getting started

You need [Deno](https://deno.com/) installed. There's nothing else to install —
Zuke is imported straight from JSR.

> [!NOTE]
> All packages — `@zuke/core`, `@zuke/deno`, `@zuke/npm`, `@zuke/docker`,
> `@zuke/docker-compose`, `@zuke/oxlint`, `@zuke/eslint`, `@zuke/cspell`,
> `@zuke/jest`, `@zuke/vitest`, `@zuke/security`, `@zuke/cmd`, and the
> `@zuke/cli` command — publish to [JSR](https://jsr.io/@zuke) from CI via
> release-please and OIDC (see [`RELEASING.md`](../RELEASING.md)). The npm scope
> `@zuke` is not controlled by this project — install from JSR, not npm.

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
(flags: `--dir <path>`, `--name <Class>`, `--force`, `--yes`).

## Migrate an existing project with `zuke import`

Already have `package.json` scripts or a `Makefile`? `zuke import` reads them and
generates a `zuke.ts` with a target per task — a working starting point you then
refine into typed wrappers, instead of a blank page:

```sh
zuke import                 # auto-detects package.json, then a Makefile
zuke import --from makefile  # or pin the source
```

Each script/target becomes a `target()`; a command maps to `CmdTasks.exec(...)`,
an `&&` chain becomes sequential steps, a `package.json` `run` delegation (or a
Makefile prerequisite) becomes `.dependsOn(...)`, and a command too shell-specific
to translate (pipes, redirects, env assignments) is preserved behind a `// TODO`
so the file still compiles and the tricky bits are flagged. It also scaffolds the
launchers and `deno.json`, exactly like `zuke setup`. Flags: `--from
<package.json|makefile>`, plus the same `--dir`, `--name`, `--force`, `--yes`.

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
(pinned by default; override with `DENO_VERSION`), then run `zuke.ts` — so a
fresh checkout needs nothing but the script:

```sh
./zuke ci          # full gate          (Windows: .\zuke.ps1 ci)
./zuke test        # type-check + tests  (Windows: .\zuke.ps1 test)
./zuke --list      # list every target
```

If you already have Deno, `deno task zuke <target>` (via the `zuke` task in
`deno.json`) does the same thing.

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

  // Optional: runs when you invoke `zuke` with no target.
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

---

Next: [Core concepts](./concepts.md) · [Authoring API](./authoring.md) ·
[Tools](./tools.md)

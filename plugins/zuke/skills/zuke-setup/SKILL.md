---
name: zuke-setup
description: Set up Zuke — a code-first, strongly-typed build automation system for TypeScript, on Node or Deno — in a project. Use when the user wants to add Zuke to a repo, scaffold a build.ts build file, install the Zuke CLI, or bootstrap the ./zuke launcher. After scaffolding, switch to the zuke-write-build skill to author targets.
---

# Set up Zuke in a project

Zuke defines builds as a TypeScript class run on **Node** or **Deno**. Each
target is a class field; targets reference each other by `this.<field>` (never
strings). Packages come from npm in a Node project (`npm:@zuke-build/...`,
aliased as `@zuke/...`) and from **JSR** (`jsr:@zuke/...`) in a Deno one.

## The fast path: `zuke setup`

The `@zuke/cli` tool scaffolds everything. Install it once, then run `setup` in
the target project:

```sh
npm install -g @zuke-build/cli             # once, globally (Node 24.12 or newer)
zuke setup                                 # in the project root: a Node project
zuke                                       # run the build
zuke add docker                            # add a wrapper: @zuke/docker into package.json
zuke relock --min-dep-age 0                # regenerate the lock (e.g. to move core forward)
```

Update an npm install with `npm install -g @zuke-build/cli@latest`. On Deno, the
CLI installs with `deno install -A -g -n zuke jsr:@zuke/cli` and updates with
`zuke upgrade`; builds on Deno are supported until October 2027, so scaffold a
new project on Node unless the user asks for Deno.

No global install? The same wizard runs directly (install the CLI afterwards to
run the build with `zuke`):

```sh
npx @zuke-build/cli setup
```

No Node at all, on macOS or Linux? `brew install zuke-build/tap/zuke` installs
the same CLI as a signed standalone binary; `zuke setup` then works at once, and
the `./zuke` launcher it writes installs Node when the build first runs. Update
that install with `brew upgrade zuke`, not `zuke upgrade` (which refuses it). On
Windows, `choco install zuke` installs the same binary through Chocolatey (not
Authenticode-signed yet, so SmartScreen may warn); update it with `choco upgrade
zuke`. `zuke --version` on a terminal shows which install answered.

`setup` flags: `--dir <path>`, `--name <ClassName>`, `--force` (overwrite
existing files), `--yes` (non-interactive), `--bootstrap` / `--no-bootstrap`
(which launchers to write — see below; the wizard asks when interactive, and
`--yes` takes the default, bootstrap; `--bootstrap-deno` / `--no-bootstrap-deno`
are the older spellings), `--mcp` (also write `.mcp.json` registering the
build's MCP server, so this agent — and any other stdio MCP client — can list
and run the targets through typed calls; `--allow-run` registers it with
execution enabled and implies `--mcp`), `--launcher-name <name>` (write the
launcher under a different name when a `zuke/` directory already occupies it — a
directory collision now fails with an actionable error instead of silently
skipping the launcher), `--sdk python` (scaffold a Python build instead — see
below) and `--zuke <version>` (the `zuke` release that build's launchers run;
the running `zuke`'s own when omitted). With `--mcp`, an MCP client lists and
runs the targets through typed calls; without it, the build is still
discoverable through `zuke --list --json`.

Running as an agent, always pass `--yes`: it skips every interactive question,
including the closing "star the Zuke repository?" prompt — that question is for
a human at a terminal, and an agent must never answer it (or star anything) on
the user's behalf.

To read a `@zuke/*` package's API in a Node project, read its
`node_modules/@zuke/<package>/README.md` (the `## API` section) once the
dependencies are installed. With Deno at hand, `zuke doc <package>` (e.g. `zuke
doc core`) runs `deno doc` in an isolated directory.

### A Node project: `zuke setup --runtime node`

A new project's build runs on Node 26: `--runtime node` is the default for one,
and an existing project keeps its own runtime (`--runtime deno` scaffolds a Deno
project; neither combines with `--sdk`). Setup writes `build.ts`, a
`package.json` (created, or merged without overwriting: `"type": "module"` and
the `@zuke/core` dependency `npm:@zuke-build/core@^1` are added when absent), a
`zuke.json` with `"runtime": "node"`, Node launchers that bootstrap a pinned,
checksum-verified Node, and a `.gitignore` entry for `node_modules/`. **A Node
project needs no Deno** — never tell its user to install it. With `--mcp`,
`.mcp.json` registers `node <build file> mcp`, which works on every platform
once Node 26 or newer is on `PATH` and a first `./zuke` run has installed the
dependencies.

`zuke add docker` then installs `@zuke/docker` from npm (as the alias for
`npm:@zuke-build/docker`), and `zuke remove`, `zuke cache` and `zuke relock` run
npm too: the `npm` on `PATH`, or else the one beside the Node `./zuke`
downloaded.

`zuke setup --runtime node` in an existing Deno project converts it in place,
`--force` or not: `zuke.json` gains `"runtime": "node"`, the launchers are
rewritten for Node, and `package.json` declares every `@zuke/*` package
`deno.json` imports. The build file and `deno.json` are kept; if the build file
imports a `jsr:` specifier, switch it to the bare `@zuke/…` form, which setup
asks for as a manual step. Setup never moves a Node project back to Deno.

### A Python project: `zuke setup --sdk python`

A build can be written in Python with the `zuke` package from PyPI and run on
`@zuke/engine`, which hosts it as a worker. **A Python project needs no Deno,
anywhere** — never tell its user to install Deno, and never reach for a Deno
command in it. Each SDK runs on its own stack only. `zuke setup --sdk python
--yes` writes a starter `build.py` in place of `build.ts`, a `zuke.json` with
the worker command (`uv run build.py`) and the exact engine release, the
launchers and `.gitignore`, and no `deno.json`. The launchers run the standalone
`zuke` binary, which carries the engine and every wrapper: they pin one `zuke`
release (the running one's, or `--zuke <version>`) with each platform's SHA-256,
and on first use download it from the GitHub release, verify it and keep it in
`~/.zuke`, so a clone or a CI job needs only uv. `zuke.json` pins the engine
inside that release. The `build.py` opens with inline script metadata naming
`zuke` as its dependency, so `uv run` provides the SDK without a project file; a
project that already manages its environment can drop that block and add `zuke`
to its dev dependencies instead. Every other `setup` flag applies; `--mcp`
registers the build's MCP server as `zuke mcp`. Later, `zuke upgrade --engine
[<version>]` moves the project to the latest (or given) `zuke` release,
rewriting the launchers and the pin, with `--dry-run`. With the CLI installed,
run the build exactly as a TypeScript one, no launcher needed: `zuke <target>`,
`zuke --list`, `zuke generate-ci`, `zuke mcp`; the launchers are for CI runners
without the CLI. `zuke add`, `remove`, `cache` and `relock` refuse a Python
build, whose wrappers come with the SDK as `zuke.tools`. Author the targets with
the Python SDK's own documentation; the TypeScript authoring skill does not
apply to a `build.py`.

### Migrating an existing project: `zuke import`

If the project already has `package.json` scripts or a `Makefile`, prefer `zuke
import` over `setup` — it reads them and generates a `build.ts` with a target
per task, a working starting point instead of a blank build:

```sh
zuke import                  # auto-detects package.json, then a Makefile, then pyproject.toml
zuke import --from makefile   # or pin the source (package.json | makefile | pyproject)
```

Each script/target becomes a `target()`; a command maps to `CmdTasks.exec(...)`
— a **placeholder**, not the destination: before accepting it, check the package
catalogue (`llms.txt`'s `## Packages` list, or the table in
[`zuke-write-build`'s cheatsheet](../zuke-write-build/references/cheatsheet.md))
for a `@zuke/<tool>` wrapper matching that command and replace the placeholder
with it — leaving `CmdTasks.exec` in place for a tool that has a typed wrapper
is a bug, not a shortcut. An `&&` chain becomes sequential steps, a
`run`/prerequisite delegation becomes `.dependsOn(...)`, and anything too
shell-specific to translate (pipes, redirects, env assignments) is preserved
behind a `// TODO` so the file still compiles. It scaffolds the rest exactly
like `setup`, on the same runtime — Node, with `package.json`, for a new
project, or the project's own — and takes the same `--dir`, `--name`, `--force`,
`--yes`, `--runtime`, `--bootstrap` / `--no-bootstrap`, `--mcp` and
`--allow-run` flags. Afterwards, use the **zuke-write-build** skill to finish
replacing any remaining generated `CmdTasks.exec` calls with typed `*Tasks`
wrappers.

A Python project's `pyproject.toml` imports too: the first task table it carries
(`[tool.poe.tasks]`, `[tool.pdm.scripts]`, `[tool.hatch.envs.default.scripts]`,
`[tool.taskipy.tasks]` or `[tool.rye.scripts]`) becomes a **Python** build — the
project `zuke setup --sdk python` makes, with a generated `build.py` whose
targets run each command through `await ctx.sh("prog", "arg", …)` and whose
leading sequence steps naming another task become `.depends_on(...)` (one after
a command stays a `# TODO` in place, since a dependency runs first). Python
`call`/`script` entries, `expr`, `{args}` placeholders and shell-specific
commands are kept as `# TODO` comments. `--zuke <version>` pins the `zuke`
release its launchers run, as for `setup --sdk python`; there is no `deno.json`,
no `CmdTasks` and no Deno.

### What `zuke setup --runtime deno` writes

The files of a Deno project, which builds on Deno are supported until
October 2027. A Node project's are in the Node section above; a Python project's
in the Python section.

- **`build.ts`** — a starter build class with a sample target and a `default`. A
  new project gets `build.ts`: the wizard asks the name, `--build-file <name>`
  answers up front. A project that already has a `zuke.ts` keeps it.
- **`./zuke`** + **`./zuke.ps1`** — launchers that locate the project and run
  the build file. (A Python project's launchers run the pinned `zuke` binary
  instead, as described above.) By default (`--bootstrap`) they use the Deno on
  `PATH` and, when there is none, download the pinned release Zuke itself runs
  on, verify it against a per-platform SHA-256, and install it under `~/.deno` —
  never an install script, never an unverified binary — so a clone needs nothing
  installed first. With `--no-bootstrap` they require Deno on `PATH` and exit
  with the install docs URL when it is missing, for a project that must never
  download a tool from its build entry point. Both pass `--frozen` once a
  `deno.lock` exists, so the first run writes the lockfile and every run after
  verifies it.
- **`deno.json`** — merged to add an `imports` entry for `@zuke/core` (`zuke
  import` adds `@zuke/cmd` too when it generates one), a `zuke` task, and
  `fmt`/`lint`/`test` if absent. The scaffolded build imports by **bare
  specifier** (`from "@zuke/core"`), not an inline `jsr:@zuke/core@^1` — Deno's
  default lint set rejects an inline specifier under `no-import-prefix`, so an
  inlined one would fail the project's own `deno task lint` on its only source
  file. The caret major is pinned in the import map instead. Merging is additive
  per key: a task or import the file already declares is kept exactly as it is
  (so a deliberate version pin survives), only what is missing is added. A file
  that has the `zuke` task but not the imports is still completed — skipping it
  would leave the `build.ts` written in the same run with nothing to resolve.
  Two shapes cannot be completed automatically, and setup reports them as steps
  for you and **exits 1** rather than printing `Next: zuke` over a build that
  cannot start: a `deno.json` that is JSONC (Deno accepts `//` comments and
  trailing commas that a JSON parser does not, and rewriting the file would
  discard them), and one that delegates via `importMap` to a separate file (Deno
  ignores that field the moment `imports` appears beside it, so the entry
  belongs in the other file — setup reads that file and stays quiet once it
  declares the entry, so a correctly configured project still exits 0). Both are
  left byte-for-byte untouched. A mapping that already points somewhere other
  than the JSR package is kept — that is how a pin or a local checkout survives
  — with a note saying so. `--mcp` that cannot register into an unparseable
  `.mcp.json` is reported the same way, as a note.
- **`zuke.json`** — `{ "name": "...", "build": "build.ts" }`, which marks the
  repo root and names the build file; the `zuke` command and a re-run of `zuke
  setup` follow it. A `zuke.json` with no `build` field means `zuke.ts`. With
  `--sdk python` it carries `sdk.command` and `engine` instead, and `build.py`
  is the build file while `deno.json` is not written.
- **`.gitignore`** — created or appended so `.zuke/` is ignored (the cache and
  durable run state live there); untouched if it already covers it.
- **`.mcp.json`** (with `--mcp`) — `mcpServers.zuke` launching `deno run -A
  build.ts mcp` (plus `--allow-run` when asked). Merged around any other servers
  already in the file; an existing `zuke` entry is kept unless `--force` is set.

## Running the build

Run the build with the global `zuke` command, from any directory inside the
project. If `zuke` is not on `PATH`, install it first with `npm install -g
@zuke-build/cli`, or run the project's `./zuke` launcher instead.

```sh
zuke                      # run the default target
zuke <target>             # run a specific target
zuke --list               # list every target
zuke --list --json        # the whole build surface (commands, flags, targets) as JSON
zuke <target> --dry-run   # print the plan without executing
zuke <target> --no-banner # no opening banner (also ZUKE_NO_BANNER)
zuke <target> --plain     # plain: no banner or colour (also ZUKE_PLAIN)
```

Every run opens with a banner: the Zuke wordmark, then `zuke <version> ·
<runtime> <version> · <platform>` and `run <id> · <cwd>`. On CI the wordmark is
dropped — the identifying lines are what a runner log wants, six lines of ASCII
are not — and the detected host is appended to the first line. `--no-banner` or
`ZUKE_NO_BANNER` turns it off entirely. On an interactive terminal `--version`,
`--help`, `--list` and `graph` print a rich, coloured form; `--plain` or
`ZUKE_PLAIN=1` asks for plain output everywhere (no banner or colour,
undecorated informational commands), and output is plain automatically on CI and
through a pipe, so `zuke -- --version | …` is always the bare version of Zuke
the build runs on (`zuke --version` alone also reports the CLI's).

The bare `zuke` works from anywhere inside the project: `zuke <target>`, `zuke
--list`, `zuke graph`, `zuke mcp`, bare `zuke` for the default target — every
command that is not the CLI's own (`setup`, `import`, `doc`) is forwarded to the
nearest `build.ts`. `--help` and `--version` show both surfaces, the CLI's and
then the build's, each labelled; `zuke -- --help` is the build's own usage
alone, and `zuke -- <target>` reaches a target that shares one of those names.
It walks up to the `zuke.json` that marks the repository root and runs the
executable `./zuke <args>` launcher there, so a project's customised launcher
(pinned Deno, exported env, a lock outside the repo) applies to `zuke` too. With
no executable launcher (and on Windows) it runs `node build.ts <args>` for a
Node project, and `deno run -A build.ts <args>` for a Deno one, with `--frozen`
once a `deno.lock` exists. Outside a project, `zuke <target>` reports the
unknown command and the missing `zuke.json`, and a bare `zuke` prints the usage.
The forwarding refuses a project whose root directory is owned by another user
or is world-writable, and one where an ancestor `deno.json`, `deno.jsonc` or
`package.json` Deno would read is owned by another user (the `safe.directory`
rule git applies, since discovery runs code the caller never named); the error
names what was refused and the fix — run that project's own `./zuke` there, or
fix the ownership. On Windows the gate is inert.

The CLI is self-describing: `zuke --help` prints the usage grammar plus the
build's live targets and parameters, so an agent discovers the real command
surface instead of guessing. For an AI client to operate the build through typed
calls, `zuke mcp` runs a Model Context Protocol server over it (register with
`claude mcp add zuke -- node build.ts mcp`, or `-- deno run -A build.ts mcp` on
Deno; add `--allow-run` to let the agent execute targets, not just inspect
them).

A Deno project's scaffolded `deno.json` also carries a `zuke` task (`deno task
zuke <target>`), but it is not quite equivalent: it deliberately omits
`--frozen`, so it may heal a stale lockfile where `zuke` would fail on it.
Prefer `zuke`.

On a machine without the CLI — a CI runner — the committed `./zuke` launcher
(`zuke.ps1` on Windows) installs Node (or Deno) and runs the build, which is why
generated CI workflows call `./zuke <target>`.

## Manual setup (without `zuke setup`)

On Node, declare the packages in `package.json`, under their npm aliases, with
`"type": "module"`:

```json
{
  "type": "module",
  "dependencies": {
    "@zuke/core": "npm:@zuke-build/core@^1",
    "@zuke/npm": "npm:@zuke-build/npm@^1"
  }
}
```

On Deno, declare them in `deno.json` — bare specifier to `jsr:` dependency,
caret major — so the build can import them by bare specifier. An inline
`jsr:@zuke/core@^1` in the import statement fails `deno lint` under its default
`no-import-prefix` rule:

```json
{
  "imports": {
    "@zuke/core": "jsr:@zuke/core@^1",
    "@zuke/deno": "jsr:@zuke/deno@^1",
    "@zuke/npm": "jsr:@zuke/npm@^1"
  }
}
```

Then create `build.ts` in the project root, extend `Build`, declare targets with
`target()`, and call `await run(MyBuild)` at the bottom. The imports read the
same on both runtimes:

<!-- check -->

```ts
import { Build, run, target } from "@zuke/core";
import { NpmTasks } from "@zuke/npm";

class CI extends Build {
  install = target().executes(() => NpmTasks.ci());
  test = target().dependsOn(this.install).executes(() => NpmTasks.test());
  default = target().dependsOn(this.test).executes(() => {});
}

await run(CI);
```

Mark the project root with a `zuke.json` (`{ "name": "my-project", "build":
"build.ts", "runtime": "node" }`, without `runtime` on Deno) so the `zuke`
command can find the build, knows its file and its runtime, then run it with
`zuke test`. (For the launcher scripts a CLI-less CI runner needs, prefer `zuke
setup`, which drops them in for you.)

## Finding the exact API — never guess

Every external tool has a typed `*Tasks` wrapper; **do not fall back to
`Deno.Command`, `node:child_process` or hand-rolled shell.** First confirm a
wrapper exists at all — `llms.txt`'s `## Packages` catalogue or the table in
[`zuke-write-build`'s cheatsheet](../zuke-write-build/references/cheatsheet.md)
is the only way to answer that; a package's own docs need its name, so they
cannot reveal that one exists. Once you know the package name, get its exact
signatures:

- A single package, in the version the project actually has installed — prefer
  this in a consumer repo, since it cannot describe an API that version lacks:
  on Node, `node_modules/@zuke/<package>/README.md` (its `## API` section) and
  its `.d.ts` files; on Deno, `deno doc jsr:@zuke/<package>`.
- The whole typed surface of every package is in **`llms-full.txt`** (indexed by
  `llms.txt`) — at the repo root in the Zuke repo itself, or from a consumer
  repo <https://raw.githubusercontent.com/zuke-build/zuke/master/llms-full.txt>
  (index: <https://raw.githubusercontent.com/zuke-build/zuke/master/llms.txt>).
  Both track `master`, so they may document symbols that are merged but not yet
  released; use them to find what exists, then confirm the signature in the
  installed package.

Once the project is scaffolded, use the **zuke-write-build** skill to add and
edit targets.

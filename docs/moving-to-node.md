# Moving a build from Deno to Node

A Zuke build runs on Node or on Deno. Node is the default for a new project, and
it is where Zuke is going: builds on Deno are supported until **October 2027**,
and every run of one says so on stderr. This page moves an existing Deno project
to Node. Nothing about the build's shape changes: it is the same class, the same
targets and the same `@zuke/*` packages, now installed from npm.

## What changes

|                    | On Deno                       | On Node                                             |
| ------------------ | ----------------------------- | --------------------------------------------------- |
| `zuke.json`        | no `runtime` field            | `"runtime": "node"`                                 |
| The launchers      | bootstrap a pinned Deno       | bootstrap a pinned Node, then `npm ci`              |
| Where `@zuke/*` is | `deno.json` imports, from JSR | `package.json` dependencies, from npm               |
| A package's name   | `jsr:@zuke/docker@^1`         | `npm:@zuke-build/docker@^1`, aliased `@zuke/docker` |
| The lock           | `deno.lock`                   | `package-lock.json`                                 |

The `@zuke` scope on npm belongs to someone else, so the packages are published
as `@zuke-build/<name>` and installed under the alias `@zuke/<name>`. The build
file's imports read the same on both runtimes.

## 1. Convert the project

In the project root, with a `zuke` that is current:

```sh
zuke setup --runtime node
```

It converts the project in place, with or without `--force`:

- `zuke.json` gains `"runtime": "node"` and keeps its other fields.
- `./zuke` and `zuke.ps1` are rewritten as the Node launchers. A file at that
  name that is not one of Zuke's launchers is left alone.
- `package.json` is created or merged: `"type": "module"`, `@zuke/core`, and
  every other `@zuke/*` package `deno.json` or an inline `jsr:` specifier in the
  build file imports, through its npm alias.
- `.mcp.json`'s `zuke` server, when it runs the build with `deno run`, is
  pointed at `node`, keeping its other arguments. One that passes Deno any other
  option is left alone, with a note.
- `.gitignore` gains `node_modules/`.

The build file and `deno.json` are kept. Setup reports what it could not do for
you, and exits non-zero when the build cannot run yet.

## 2. Fix what Node cannot load

- **`jsr:` specifiers in the build file.** Node cannot load one. Import the bare
  name, `@zuke/docker` for `jsr:@zuke/docker@^1`, which `package.json` now
  declares. Setup asks for this as a manual step.
- **Other imports `deno.json` mapped.** Setup names them in a note. Declare an
  npm package for each one the build uses. A JSR-only package such as
  `@std/yaml` has an npm form at `npm:@jsr/std__yaml`, served by JSR's
  [npm compatibility registry](https://jsr.io/docs/npm-compatibility), which an
  `.npmrc` line `@jsr:registry=https://npm.jsr.io` enables.
- **`Deno.*` in the build file.** Node has no `Deno` global. Use the tasks
  `@zuke/core` provides on both runtimes: `FileTasks` for files, `EnvTasks` for
  the environment, `RuntimeTasks` for the working directory, platform and exit,
  `ProcessTasks` and the `$` shell for subprocesses. A target that calls a tool
  wrapper (`DenoTasks`, `NpmTasks`, …) needs no change: the wrapper runs the
  tool, whichever runtime runs the build.

Node 26 runs a TypeScript build file as it is, stripping its types. It does not
transform syntax that has runtime meaning, so an `enum`, a `namespace` or a
constructor parameter property has to become plain code.

## 3. Run it, and commit

```sh
./zuke --list   # installs Node and the dependencies on the first run
./zuke          # the default target
```

The first run writes `package-lock.json`. Commit it with `package.json`,
`zuke.json` and the launchers. Once nothing else in the project uses it, delete
`deno.json` and `deno.lock`.

## CI

A generated workflow runs the build through `./zuke`, which now bootstraps Node
itself, so `zuke generate-ci --check` passes unchanged. A job that sets
`denoVersion` on the Zuke action, to run `deno` directly, sets `nodeVersion`
instead.

## The editor and MCP

Setup points the `zuke` server in `.mcp.json` at Node itself: `deno run -A
build.ts mcp` becomes `node build.ts mcp`, with any `--allow-run` kept. An entry
that runs Deno some other way is left as it is, with a note: point it at `node
<build file> mcp` by hand. An editor's TypeScript support reads `node_modules`
once the first `./zuke` run has installed it.

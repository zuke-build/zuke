---
name: zuke-write-build
description: Write or edit a Zuke build (build.ts) — the code-first, strongly-typed build system for TypeScript, on Node or Deno. Use when adding or changing targets, wiring dependencies, calling a tool wrapper (DenoTasks, NpmTasks, DockerTasks, ...), generating CI, or authoring/refactoring a build.ts build file. For first-time project scaffolding, use the zuke-setup skill instead.
---

# Write or edit a Zuke build

A build is a class that **extends `Build`**. Each **target is a class field**
created with `target()` and made runnable with `await run(MyBuild)` at the
bottom of `build.ts` (no `import.meta.main` guard — `run` no-ops on import). The
build runs on Node, the default for a new project, or on Deno: `zuke.json`'s
`"runtime"` field says which (`"node"`, or none for Deno). Builds on Deno are
supported until October 2027;
[`docs/moving-to-node.md`](https://github.com/zuke-build/zuke/blob/master/docs/moving-to-node.md)
moves one.

<!-- check -->

```ts
import { Build, run, target } from "@zuke/core";
import { NpmTasks } from "@zuke/npm";

class CI extends Build {
  install = target()
    .description("Clean-install dependencies")
    .executes(async () => {
      await NpmTasks.ci();
    });

  test = target()
    .description("Run the test script")
    .dependsOn(this.install)
    .executes(async () => {
      await NpmTasks.test();
    });

  // A field named `default` runs when no target is named on the CLI.
  default = target().dependsOn(this.test).executes(() => {});
}

await run(CI);
```

## Non-negotiable rules

1. **Import `@zuke/*` by bare specifier, and declare it in the project's
   manifest.** Write `import { DockerTasks } from "@zuke/docker";` the same way
   on both runtimes; `zuke add docker` declares it, and `zuke setup` already
   declared `@zuke/core`.
   - **On Node**, `package.json` declares it under its npm alias:
     `"@zuke/docker": "npm:@zuke-build/docker@^1"`. The `@zuke` scope on npm
     belongs to someone else, so never install an `@zuke/*` package from npm by
     that name.
   - **On Deno**, the `imports` block of `deno.json` maps it: `"@zuke/docker":
     "jsr:@zuke/docker@^1"`. Never an inline `jsr:@zuke/docker@^1` in the import
     statement: Deno's default lint set (the one that applies when `deno.json`
     configures no `lint.rules`, which is what `zuke setup` scaffolds) rejects
     it under `no-import-prefix`, and Node cannot load one.

   Either way the caret major is pinned in the manifest, so a future `@zuke`
   major cannot land unannounced.
2. **Dependencies are `this.<field>` references, never strings.**
   `.dependsOn(this.lint)`, not `.dependsOn("lint")` — so renames and typos are
   compile-time errors.
3. **A target may only depend on siblings declared _above_ it.** Class fields
   initialise top-to-bottom; a forward reference is `undefined` and is reported
   as an error (TypeScript also flags it, `TS2729`). Order fields so
   dependencies come first.
4. **Check the package catalogue before writing any command.** `llms.txt`'s `##
   Packages` catalogue (raw:
   <https://raw.githubusercontent.com/zuke-build/zuke/master/llms.txt>) and the
   package list in [`references/catalogue.md`](references/catalogue.md) are the
   only ways to answer "does a `@zuke/<tool>` wrapper exist for this CLI?" — a
   package's own docs only describe a package whose name you already know; they
   cannot tell you a wrapper exists. Whatever runs in an `.executes(...)` body
   drives an external tool through its namespaced `*Tasks` object, configured
   with a **settings lambda** that mirrors the real CLI's flags — `DenoTasks`,
   `NpmTasks`, `DockerTasks`, `GitTasks`, and 30+ more — never a raw
   `Deno.Command`, `node:child_process` or shell string. `@zuke/cmd`
   (`CmdTasks.exec`) or the `$` shell from `@zuke/core/shell` is the **last
   resort**, reached for only once the catalogue confirms no typed wrapper
   exists — using it for a tool that has a `@zuke/<tool>` package is a **bug**,
   not a style choice: it discards typed flags, argv purity, and tool
   resolution. (If a build delegates its side effects to your own tested modules
   behind injected clients, the wrapper rule still governs whatever those
   modules run in the target body.)
5. **A body is required**, unless the target is one of the four forms that
   replace it: a `service()`, a `.forEach()` fan-out, a `.waitsFor()` gate, or a
   target declaring only `.effect(...)`. Otherwise set `.executes(...)`; it may
   be sync or async, and its return value is ignored — `.executes(() =>
   DenoTasks.lint())` is fine as-is; never wrap a single wrapper call in an
   `async` block just to discard its result.
6. **Reach the runtime through `@zuke/core`, never through `Deno.*`.** A build
   on Node has no `Deno` global. `FileTasks` (files), `EnvTasks` (the
   environment), `RuntimeTasks` (working directory, platform, arguments, exit)
   and `ProcessTasks` or `$` (subprocesses) work on both runtimes.

## Find the exact signature first

Before calling any task or settings method, confirm the real shape — but first
confirm a wrapper exists at all: a package's docs need its name, so they cannot
answer "does one exist for this tool?"; only the catalogue (`llms.txt`'s `##
Packages` list or [`references/catalogue.md`](references/catalogue.md)) can.

- **One package — prefer this in a consumer repo, once you know its name.** It
  shows the version the project actually has installed, so it cannot describe an
  API that version lacks.
  - On Node: `node_modules/@zuke/<package>/README.md` and its `## API` section,
    and the package's `.d.ts` files beside it, once `./zuke` or `npm ci` has
    installed the dependencies.
  - On Deno: `deno doc jsr:@zuke/<package>` (e.g. `deno doc jsr:@zuke/docker`),
    or `zuke doc <package>`, which runs it.
- **Whole surface:** `llms-full.txt` (index: `llms.txt`) — at the repo root in
  the Zuke repo itself. From a consumer repo, fetch
  <https://raw.githubusercontent.com/zuke-build/zuke/master/llms-full.txt>
  (index: <https://raw.githubusercontent.com/zuke-build/zuke/master/llms.txt>).
  Both track `master`, so they can document symbols that are merged but not yet
  in any published release. Use them for breadth — which packages and tasks
  exist — and confirm a signature in the installed package before relying on it.
- A quick map of the common methods and task objects is in the reference files
  listed below — read the one for the feature you are wiring, then verify
  specifics against the sources above.

## Workflow for a change

1. Read the existing `build.ts` to learn the targets already declared and their
   order.
2. Identify the tool you need and look up its `*Tasks` object and settings
   methods ([`references/catalogue.md`](references/catalogue.md) → the installed
   package / `llms-full.txt`).
3. Add or edit the target field. Place it **below** every target it depends on.
   Wire dependencies with `this.<field>`.
4. Validate with the `zuke` command (it works from any directory inside the
   project; install it with `npm install -g @zuke-build/cli` if it is missing,
   or run the project's `./zuke` launcher instead): `zuke --list` shows it;
   `zuke <target> --dry-run` previews the plan; `zuke <target>` runs it. To run,
   inspect or debug a build further, use the `zuke-run-build` skill.

## Reference files — read only the one you need

Each file opens with a short summary of its features, then the detail. Read the
one that matches the change; none of them is needed to start.

| Read                                                 | When you are                                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [`references/catalogue.md`](references/catalogue.md) | Checking whether a `@zuke/<tool>` wrapper exists, before writing any command.                                                   |
| [`references/targets.md`](references/targets.md)     | Writing targets: `target()` methods, `group()`, components, `service()`, the target context, caching, `.forEach()`, parameters. |
| [`references/durable.md`](references/durable.md)     | Persisting run state, taking a cross-run lock, waiting on an external event, compensating with `.onCancel()`, `.effect()`.      |
| [`references/tools.md`](references/tools.md)         | Calling a tool wrapper (Node, git, GitHub, Deno, Flutter, Dart) or provisioning a tool hermetically.                            |
| [`references/cloud.md`](references/cloud.md)         | Deploying or signing: gcloud, AWS, Azure, Kubernetes, Apple, Google Play, SignPath.                                             |
| [`references/plugins.md`](references/plugins.md)     | Adding AI review or self-healing, OpenTelemetry, Prometheus, a canary rollout, a Homebrew tap, a Chocolatey package, QR codes.  |
| [`references/ci.md`](references/ci.md)               | Generating CI with `cicd()`, or starting from a complete recipe build.                                                          |

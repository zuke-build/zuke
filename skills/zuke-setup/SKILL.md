---
name: zuke-setup
description: Set up Zuke — a code-first, strongly-typed build automation system for Deno/TypeScript — in a project. Use when the user wants to add Zuke to a repo, scaffold a zuke.ts build file, install the Zuke CLI, or bootstrap the ./zuke launcher. After scaffolding, switch to the zuke-write-build skill to author targets.
---

# Set up Zuke in a project

Zuke defines builds as a TypeScript class run on **Deno**. Each target is a
class field; targets reference each other by `this.<field>` (never strings).
Packages are imported from **JSR** (`jsr:@zuke/...`), not npm.

## The fast path: `zuke setup`

The `@zuke/cli` tool scaffolds everything. Install it once, then run `setup` in
the target project:

```sh
deno install -A -g -n zuke jsr:@zuke/cli   # once, globally
zuke setup                                  # in the project root
./zuke                                       # run the build
```

No global install? The same wizard runs directly:

```sh
deno run -A jsr:@zuke/cli setup
```

`setup` flags: `--dir <path>`, `--name <ClassName>`, `--force` (overwrite
existing files), `--yes` (non-interactive).

### What `zuke setup` writes

- **`zuke.ts`** — a starter build class with a sample target and a `default`.
- **`./zuke`** + **`./zuke.ps1`** — bootstrap launchers that locate the project
  and **install Deno on first use if it's missing** (override the version with
  `DENO_VERSION`), then run `zuke.ts`. A fresh checkout needs nothing but the
  script.
- **`deno.json`** — merged to add a `zuke` task (and `fmt`/`lint`/`test` if
  absent).
- **`zuke.json`** — `{ "name": "..." }`, which marks the repo root.

## Running the build

```sh
./zuke                 # run the default target  (Windows: .\zuke.ps1)
./zuke <target>        # run a specific target
./zuke --list          # list every target
./zuke <target> --dry-run   # print the plan without executing
```

If Deno is already installed you can equivalently use
`deno task zuke <target>` or `deno run -A zuke.ts <target>`. The `-A` flag
grants permissions, since targets typically run processes and touch files.

## Manual setup (no CLI)

Create `zuke.ts` in the project root, extend `Build`, declare targets with
`target()`, and call `await run(MyBuild)` at the bottom:

```ts
import { Build, run, target } from "jsr:@zuke/core";
import { DenoTasks } from "jsr:@zuke/deno";

class CI extends Build {
  lint = target().executes(() => DenoTasks.lint());
  test = target().dependsOn(this.lint)
    .executes(() => DenoTasks.test((s) => s.allowAll()));
  default = target().dependsOn(this.test).executes(() => {});
}

await run(CI);
```

Run with `deno run -A zuke.ts test`. (For the `./zuke` launcher experience,
prefer `zuke setup`, which drops the bootstrap scripts in for you.)

## Finding the exact API — never guess

Every external tool has a typed `*Tasks` wrapper; **do not fall back to
`Deno.Command` or hand-rolled shell.** To get exact signatures:

- The whole typed surface of every package is in **`llms-full.txt`** at the repo
  root (indexed by `llms.txt`).
- A single package on the command line: `deno doc jsr:@zuke/<package>`.

Once the project is scaffolded, use the **zuke-write-build** skill to add and
edit targets.

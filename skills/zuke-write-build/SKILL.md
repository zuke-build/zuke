---
name: zuke-write-build
description: Write or edit a Zuke build (zuke.ts) — the code-first, strongly-typed build system for Deno/TypeScript. Use when adding or changing targets, wiring dependencies, calling a tool wrapper (DenoTasks, NpmTasks, DockerTasks, ...), generating CI, or authoring/refactoring a zuke.ts build file. For first-time project scaffolding, use the zuke-setup skill instead.
---

# Write or edit a Zuke build

A build is a class that **extends `Build`**. Each **target is a class field**
created with `target()` and made runnable with `await run(MyBuild)` at the
bottom of `zuke.ts` (no `import.meta.main` guard — `run` no-ops on import).

```ts
import { Build, run, target } from "jsr:@zuke/core";
import { DenoTasks } from "jsr:@zuke/deno";

class CI extends Build {
  lint = target()
    .description("Lint sources")
    .executes(() => DenoTasks.lint());

  test = target()
    .description("Type-check and test")
    .dependsOn(this.lint)
    .executes(() => DenoTasks.test((s) => s.allowAll().coverage("cov_profile")));

  // A field named `default` runs when no target is named on the CLI.
  default = target().dependsOn(this.test).executes(() => {});
}

await run(CI);
```

## Non-negotiable rules

1. **Dependencies are `this.<field>` references, never strings.**
   `.dependsOn(this.lint)`, not `.dependsOn("lint")` — so renames and typos are
   compile-time errors.
2. **A target may only depend on siblings declared _above_ it.** Class fields
   initialise top-to-bottom; a forward reference is `undefined` and is reported
   as an error (TypeScript also flags it, `TS2729`). Order fields so
   dependencies come first.
3. **Never guess the API and never shell out by hand.** Every external tool is a
   namespaced `*Tasks` object configured with a **settings lambda** that mirrors
   the real CLI's flags — `DenoTasks`, `NpmTasks`, `DockerTasks`, `GitTasks`, and
   30+ more. Reach for `jsr:@zuke/cmd` (`CmdTasks.exec`) or the `$` shell from
   `jsr:@zuke/core/shell` only when no typed wrapper exists.
4. **A body is required.** Set `.executes(...)`; it may be sync or async.

## Find the exact signature first

Before calling any task or settings method, confirm the real shape:

- **Whole surface:** read `llms-full.txt` at the repo root (index: `llms.txt`).
- **One package:** `deno doc jsr:@zuke/<package>` (e.g. `deno doc jsr:@zuke/deno`).
- A quick map of the most common methods and task objects is in
  [`references/cheatsheet.md`](references/cheatsheet.md) next to this file — read
  it when wiring targets, then verify specifics against the sources above.

## Workflow for a change

1. Read the existing `zuke.ts` to learn the targets already declared and their
   order.
2. Identify the tool you need and look up its `*Tasks` object and settings
   methods (cheatsheet → `deno doc` / `llms-full.txt`).
3. Add or edit the target field. Place it **below** every target it depends on.
   Wire dependencies with `this.<field>`.
4. Validate: `./zuke --list` shows it; `./zuke <target> --dry-run` previews the
   plan; `./zuke <target>` runs it.

## Common building blocks (see the cheatsheet for details)

- **Parallel batches:** `group()` + `.partOf(this.group)` run members
  concurrently; depend on the group to wait for all of them.
- **Reusable bundles:** a *component* is a function returning related targets;
  assign it to a field and reference members as `this.release.publish`.
- **Caching:** `.inputs(...)` / `.outputs(...)` make a target incremental.
- **Typed inputs:** `parameter("...")` (with `.secret()` / `.required()`), read
  as `this.x.value`, gated with `.requires(this.x)`.
- **Code-first CI:** `cicd({ provider: "github" })` generates and verifies the
  workflow YAML from the build.
- **AI review & self-healing (`@zuke/ai`):** gate a target on a structured LLM
  review of the diff (`securityReviewer(...)` etc. via `.validateBefore`), or
  attach `aiFixer(...)` with `.recoverWith(...)` so a failing target is diagnosed
  and (opt-in) auto-fixed, with a committable PR suggestion. Override
  `recoverWith()` on the build to apply one fixer to every target. See the
  cheatsheet's AI section.

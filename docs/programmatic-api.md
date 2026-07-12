# Programmatic API

Beyond authoring, `mod.ts` exports the building blocks if you want to drive Zuke
yourself or test a build:

```ts
import {
  discoverTargets, // (build) => Map<string, TargetBuilder>
  execute, // (build, rootTarget, options?) => Promise<BuildResult>
  executionSet, // (rootTarget) => Set<TargetBuilder>
  findCycle, // (targets) => string[] | null
  GraphError,
  plan, // (rootTarget) => TargetBuilder[]  (topological order)
  validateGraph, // (targets) => void  (throws GraphError)
} from "jsr:@zuke/core";
```

## `execute` options

`execute(build, rootTarget, options?)` resolves parameters and runs the plan. The
options object mirrors the CLI flags:

| Option | Type | Effect |
| --- | --- | --- |
| `silent` | `boolean` | Suppress all banner/summary output. |
| `reporter` | `{ info(line), error(line) }` | Custom output sink; overrides `silent`. |
| `renderer` | `Renderer` | Restyle the per-target banners and summary (see below). |
| `plugins` | `Plugin[]` | [Lifecycle observers](./extending.md) invoked alongside the build's hooks. |
| `skip` | `string[]` | Target names to skip even if planned (`--skip`). |
| `parallel` | `boolean \| number` | Run independent targets concurrently (`--parallel`). |
| `cache` | `boolean \| BuildCache` | Incremental [caching](./caching.md); `false` disables it (`--no-cache`). |
| `dryRun` | `boolean` | Print the plan without running any body (`--dry-run`). |
| `params` | `Record<string, string>` | Raw [parameter](./parameters.md) values, keyed by property name. |

`readEnv`, `prompt`, `github`, and `color` are additional test/CI seams — see the
`ExecuteOptions` JSDoc for the full list.

```ts
import { discoverTargets, execute } from "jsr:@zuke/core";

const build = new MyBuild();
const target = discoverTargets(build).get("test");
if (target) {
  const result = await execute(build, target, { parallel: true, cache: false });
  console.log(result.ok ? "green" : "red");
}
```

`BuildResult` is `{ ok: boolean; executed: string[]; error?: unknown }`.

## Inspecting the CLI shape — `describeCli`

`describeCli(build)` returns a structured `CliDescription` of a build's whole
command surface — its reserved commands, option flags, targets (with
descriptions and dependencies), and [parameters](./parameters.md) — the same data
that backs `zuke --help`, `zuke --list`, and `zuke --list --json`. Use it to
build tooling around a build without shelling out or parsing `--help` text.

```ts
import { describeCli } from "jsr:@zuke/core";

const cli = describeCli(new MyBuild());
for (const t of cli.targets) console.log(t.name, "→", t.dependsOn.join(", "));
```

## Custom output — `Renderer`

The per-target banners and the end-of-build summary are produced by a
`Renderer`. Zuke ships `defaultRenderer`; pass your own (or
[`@zuke/console`](./tools.md)'s alternative) via `execute(..., { renderer })` to
restyle the output. A renderer receives each `TargetReport` and the `Style`
palette, so custom rendering doesn't have to reimplement colour handling.

```ts
import { defaultRenderer, execute, type Renderer } from "jsr:@zuke/core";

const quiet: Renderer = {
  ...defaultRenderer,
  // override only the hooks you want to change…
};
await execute(build, target, { renderer: quiet });
```

## Injecting a cache — `BuildCache`

The `cache` option normally takes a boolean, but it also accepts a `BuildCache`
instance directly. This is mainly a test seam: supply an in-memory or
pre-seeded [cache](./caching.md) so a run's cache behaviour is deterministic
without touching `.zuke/cache.json`.

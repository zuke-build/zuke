# Extending Zuke

Zuke is built to be extended **without forking**. There are three stable
extension points, each a small public contract a third-party package can build
against:

1. **Plugins** — observe the build lifecycle (`Plugin`).
2. **Tool wrappers** — add a typed CLI wrapper (`ToolSettings` / `defineTool`).
3. **Components** — ship reusable bundles of targets (the bundle convention).

## 1. Plugins — observe the lifecycle

A **plugin** is a plain object implementing any of the lifecycle hooks. Register
plugins by passing them to `run` (or `execute`); each hook runs alongside the
build's own method, in registration order. Plugins **observe** — they report,
time, or notify — they don't change the plan or a target's result.

```ts
import { type Plugin, run } from "jsr:@zuke/core";

const timing: Plugin = {
  name: "timing",
  onTargetEnd: (target, status, { runId, durationMs }) =>
    console.log(`${runId} ${target}: ${status} in ${durationMs}ms`),
  onFinish: (result) => console.log(`done: ${result.ok ? "ok" : "failed"}`),
};

await run(MyBuild, { plugins: [timing] });
```

| Hook                                  | When it runs                                                        |
| ------------------------------------- | ------------------------------------------------------------------- |
| `onStart(run)`                        | Once, before any target runs.                                       |
| `onTargetStart(target, run)`          | Before a target's body executes (not skipped/cached).               |
| `onTargetEnd(target, status, timing)` | After each target settles, with its status and duration.            |
| `onFinish(result, run)`               | Once, after the run (success or failure).                           |
| `onRunStateChange(record)`            | On each run-level status change; needs a [state store](./state.md). |

Each hook carries context beyond the bare names: `run` is a `RunInfo`
(`{ runId, dryRun }`) whose `runId` is **stable across a suspend/resume
boundary**, so an exporter can group a run's events (e.g. under one trace id);
`timing` is a `TargetTiming` (`{ runId, durationMs }`). `onRunStateChange`
receives the full [`RunRecord`](./state.md) whenever the run goes `running`,
`suspended`, `succeeded`, `failed`, `cancelling`, or `cancelled` — per-target
timings, waits, and the audit trail in one payload — and only fires when a state
store is configured (a plain build with no store never produces a record).

The extra arguments are **additive**: a plugin written against the old
signatures (`onTargetEnd: (target, status) => …`) keeps working unchanged, since
a function that ignores its trailing arguments is still assignable. Every hook
is optional and may be async — the executor awaits each before continuing. Hooks
mirror the `Build` lifecycle methods, so anything a build can observe by
overriding those, a plugin can observe without subclassing — and several plugins
can observe at once.

A plugin is just a value, so a package can export a factory:

```ts
// @acme/zuke-slack
export function slack(opts: { webhook: string }): Plugin {
  return {
    name: "slack",
    onFinish: async (result) => {
      if (!result.ok) await notify(opts.webhook, "build failed");
    },
  };
}
```

[`@zuke/otel`](./observability.md) is a full worked example of this pattern: a
factory returning a `Plugin` that turns `onRunStateChange` records into
OpenTelemetry spans and counters — including trace continuity across a
suspend/resume — with no runtime dependencies.

## 2. Tool wrappers — typed CLI tasks

Wrap a CLI as a typed, fluent task in the settings-lambda style. For a one-off,
`defineTool` needs no class (see [Tools](./tools.md#define-your-own-tool)); a
distributable package extends `ToolSettings` from `@zuke/core/tooling`.

```ts
import {
  type Configure,
  runSettings,
  ToolSettings,
} from "jsr:@zuke/core/tooling";

class MyToolSettings extends ToolSettings {
  #args: string[] = [];
  fast(): this {
    this.#args.push("--fast");
    return this;
  }
  protected override defaultTool(): string {
    return "mytool";
  }
  protected override buildArgs(): string[] {
    return ["build", ...this.#args];
  }
}

export const MyToolTasks = {
  build: (configure?: Configure<MyToolSettings>) =>
    runSettings(new MyToolSettings(), configure),
};

// → await MyToolTasks.build((s) => s.fast().cwd("app"));
```

`buildArgs()` must stay **pure** (no I/O) so argv construction is unit-testable;
the base contributes the shared chainers (`env`, `cwd`, `noThrow`, `quiet`,
`toolPath`, `args`) and runs the command through the injection-free shell. A
wrapper package is a workspace sibling that depends only on `@zuke/core` — the
existing `@zuke/*` wrappers are the template.

## 3. Components — reusable target bundles

A **component** is a function that returns an object of related targets.
Assigned to a build field, discovery recurses into the bundle and names each
target with a dotted path (`release.publish`), runnable as
`zuke release.publish` and shown in the graph. Components compose, nest, and
take options.

```ts
// @acme/zuke-release
export function release(opts: { registry: string }) {
  const pack = target().executes(/* … */);
  const publish = target()
    .dependsOn(pack)
    .executes(async () => {
      await $`npm publish --registry ${opts.registry}`;
    });
  return { pack, publish };
}

// In a build:
class MyBuild extends Build {
  release = release({ registry: "https://registry.npmjs.org" });
  deploy = target().dependsOn(this.release.publish).executes(/* … */);
}
```

Targets reference each other across components via the field
(`this.release.publish`), so declare a component field above anything that
depends on it. Components can also declare [parameters](./parameters.md) and
nest other components — all discovered under the same dotted path. See
[Authoring](./authoring.md#reusable-components) for the full convention.

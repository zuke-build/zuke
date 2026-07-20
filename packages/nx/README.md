# @zuke/nx

Typed [Nx](https://nx.dev) CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `run`, `runMany`, and
`affected`.

```ts
import { NxTasks } from "jsr:@zuke/nx";

await NxTasks.run((s) => s.target("web:build"));
await NxTasks.runMany((s) =>
  s.target("build").projects("web", "api").parallel(3)
);
await NxTasks.affected((s) => s.target("test").base("main"));
```

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/nx` — typed `NxTasks` wrappers for the Nx (https://nx.dev) CLI, for
use in Zuke builds.

```ts
import { NxTasks } from "jsr:@zuke/nx";

await NxTasks.affected((s) => s.target("test").base("main"));
await NxTasks.runMany((s) => s.target("build").projects("web", "api"));
```
@module

const NxTasks: NxTasksApi
  Typed task functions for the `nx` CLI.

class NxAffectedSettings extends NxSettings
  Settings for `nx affected`.

  target(name: string): this
    The target to run on affected projects (required).
  base(ref: string): this
    The base ref to diff against (`--base`).
  head(ref: string): this
    The head ref to diff against (`--head`).
  configuration(name: string): this
    Use a named configuration (`--configuration`).
  parallel(count: number): this
    Maximum number of tasks to run in parallel (`--parallel`).
  override protected buildArgs(): string[]
    Assemble the `nx affected` argv.

class NxRunManySettings extends NxSettings
  Settings for `nx run-many`.

  target(name: string): this
    The target to run across projects (required).
  projects(...names: string[]): this
    Limit to specific projects (`--projects`); repeatable.
  configuration(name: string): this
    Use a named configuration (`--configuration`).
  parallel(count: number): this
    Maximum number of tasks to run in parallel (`--parallel`).
  all(): this
    Run for every project (`--all`).
  override protected buildArgs(): string[]
    Assemble the `nx run-many` argv.

class NxRunSettings extends NxSettings
  Settings for `nx run` (a single `project:target`).

  target(spec: string): this
    The `project:target` to run, e.g. `web:build` (required).
  configuration(name: string): this
    Use a named configuration (`--configuration`).
  override protected buildArgs(): string[]
    Assemble the `nx run` argv.

abstract class NxSettings extends ToolSettings
  Base for all `nx` subcommand settings: the binary is `nx`.

  override protected defaultTool(): string
    The tool binary is `nx`.

interface NxTasksApi
  The shape of {@link NxTasks}.

  run(configure?: Configure<NxRunSettings>): Promise<CommandOutput>
    Run a single `project:target`: `nx run`.
  runMany(configure?: Configure<NxRunManySettings>): Promise<CommandOutput>
    Run a target across many projects: `nx run-many`.
  affected(configure?: Configure<NxAffectedSettings>): Promise<CommandOutput>
    Run a target on affected projects: `nx affected`.
````

</details>

<!-- ZUKE:API:END -->

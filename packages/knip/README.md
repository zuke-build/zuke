# @zuke/knip

Typed [Knip](https://knip.dev) CLI task wrapper for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — find unused files,
dependencies, and exports.

```ts
import { KnipTasks } from "jsr:@zuke/knip";

await KnipTasks.run((s) => s.production().strict());
```

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/knip` — a typed `KnipTasks` wrapper for the Knip (https://knip.dev)
CLI (unused files, dependencies, and exports), for use in Zuke builds.

```ts
import { KnipTasks } from "jsr:@zuke/knip";

await KnipTasks.run((s) => s.production().strict());
```
@module

const KnipTasks: KnipTasksApi
  Typed task functions for the `knip` CLI.

class KnipRunSettings extends ToolSettings
  Settings for a `knip` run.

  override protected defaultTool(): string
    The underlying CLI command: `knip`.
  production(): this
    Restrict analysis to production code paths (`--production`).
  strict(): this
    Treat the production set strictly (`--strict`).
  fix(): this
    Auto-remove unused exports/dependencies where possible (`--fix`).
  cache(): this
    Enable the analysis cache (`--cache`).
  noExitCode(): this
    Always exit 0, even when issues are found (`--no-exit-code`).
  config(path: PathLike): this
    Use an explicit config file (`--config`).
  workspace(name: string): this
    Restrict to a single workspace (`--workspace`).
  reporter(name: string): this
    Choose the reporter, e.g. `json` or `compact` (`--reporter`).
  include(...types: string[]): this
    Limit to specific issue types, e.g. `files`, `dependencies` (`--include`).
  override protected buildArgs(): string[]
    Assemble the `knip <flags>` argv.

interface KnipTasksApi
  The shape of {@link KnipTasks}.

  run(configure?: Configure<KnipRunSettings>): Promise<CommandOutput>
    Find unused files, dependencies, and exports: `knip`.
````

</details>

<!-- ZUKE:API:END -->

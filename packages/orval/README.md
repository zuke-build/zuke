# @zuke/orval

Typed [`orval`](https://orval.dev) task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. `orval` reads an OpenAPI specification and generates a
type-safe TypeScript API client and optional mocks. Arguments stay a discrete
argv array, so command construction is injection-free.

```ts
import { OrvalTasks } from "jsr:@zuke/orval";

await OrvalTasks.generate((s) => s.config("orval.config.ts").clean());
```

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/orval` — typed `orval` task wrappers for Zuke builds.

`orval` is an OpenAPI client and mock generator (https://orval.dev). It reads
an OpenAPI specification and generates a type-safe TypeScript client and
optional mocks. Configure a fluent settings object in a lambda; the task
builds the argv and runs it.

```ts
import { OrvalTasks } from "jsr:@zuke/orval";
await OrvalTasks.generate((s) => s.config("orval.config.ts").clean());
```
@module

const OrvalTasks: OrvalTasksApi
  Typed task functions for the `orval` OpenAPI client and mock generator.

class OrvalGenerateSettings extends ToolSettings
  Settings for an `orval` generation run.

  override protected defaultTool(): string
  config(value: PathLike): this
    Configuration file to load settings from (`-c`/`--config`).
  project(value: string): this
    Run only the named project from the config (`-p`/`--project`).
  input(value: PathLike): this
    OpenAPI specification to read — a file path or URL (`-i`/`--input`).
  output(value: PathLike): this
    Directory the generated client is written to (`-o`/`--output`).
  watch(): this
    Regenerate on changes to the specification (`-w`/`--watch`).
  clean(): this
    Remove previously generated files before writing (`--clean`).
  prettier(): this
    Format the generated output with Prettier (`--prettier`).
  biome(): this
    Format the generated output with Biome (`--biome`).
  mock(): this
    Generate mocks alongside the client (`--mock`).
  override protected buildArgs(): string[]

interface OrvalTasksApi
  The shape of {@link OrvalTasks}.

  generate(configure?: Configure<OrvalGenerateSettings>): Promise<CommandOutput>
    Generate a TypeScript API client and mocks from an OpenAPI spec with `orval`.
````

</details>

<!-- ZUKE:API:END -->

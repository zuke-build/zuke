# @zuke/openapi-ts

Typed [`openapi-ts`](https://heyapi.dev) task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. `openapi-ts` is the [Hey API](https://heyapi.dev) code
generator (`@hey-api/openapi-ts`): it turns an OpenAPI specification into a
type-safe client. Arguments stay a discrete argv array, so command construction
is injection-free.

```ts
import { OpenapiTsTasks } from "jsr:@zuke/openapi-ts";

await OpenapiTsTasks.generate((s) =>
  s.input("openapi.yaml").output("src/client").client("@hey-api/client-fetch")
);
```

> [!NOTE]
> `openapi-ts` reads its settings from the command line, a config file
> (`.file(...)`), or both. See the [Hey API docs](https://heyapi.dev) for the
> full set of options.

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/openapi-ts` — typed `openapi-ts` task wrappers for Zuke builds.

`openapi-ts` is the Hey API (https://heyapi.dev) code generator
(`@hey-api/openapi-ts`): it turns an OpenAPI specification into a type-safe
client. Configure a fluent settings object in a lambda; the task builds the
argv and runs it.

```ts
import { OpenapiTsTasks } from "jsr:@zuke/openapi-ts";
await OpenapiTsTasks.generate((s) =>
  s.input("openapi.yaml").output("src/client")
);
```
@module

const OpenapiTsTasks: OpenapiTsTasksApi
  Typed task functions for the Hey API `openapi-ts` code generator.

class OpenapiTsGenerateSettings extends ToolSettings
  Settings for an `openapi-ts` generation run.

  override protected defaultTool(): string
    The tool binary this settings object invokes (`openapi-ts`).
  override protected defaultResolution(): ToolResolution
    Resolve the binary from `node_modules/.bin` by default — openapi-ts is an npm-distributed tool.
  input(value: PathLike): this
    OpenAPI specification to read — a file path or URL (`--input`).
  output(value: PathLike): this
    Directory the generated client is written to (`--output`).
  client(value: string): this
    HTTP client to generate for, e.g. `@hey-api/client-fetch` (`--client`).
  file(value: PathLike): this
    Configuration file to load settings from (`--file`).
  dryRun(): this
    Print the planned output without writing any files (`--dry-run`).
  watch(): this
    Regenerate on changes to the specification (`--watch`).
  silent(): this
    Suppress informational logging (`--silent`).
  override protected buildArgs(): string[]
    Assemble the `openapi-ts` argv from the configured flags.

interface OpenapiTsTasksApi
  The shape of {@link OpenapiTsTasks}.

  generate(configure?: Configure<OpenapiTsGenerateSettings>): Promise<CommandOutput>
    Generate a type-safe API client from an OpenAPI spec with `openapi-ts`.
````

</details>

<!-- ZUKE:API:END -->

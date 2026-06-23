# @zuke/dprint

Typed [`dprint`](https://dprint.dev/) task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. `fmt` formats files in place; `check` verifies formatting.
Arguments stay a discrete argv array, so command construction is injection-free.

```ts
import { DprintTasks } from "jsr:@zuke/dprint";

await DprintTasks.check((s) => s.config("dprint.json"));
await DprintTasks.fmt((s) => s.files("src").excludes("**/*.md").incremental());
```

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/dprint` — typed `dprint` task wrappers for Zuke builds.

Configure a fluent settings object in a lambda; the task builds the argv and
runs it. `fmt` formats files in place; `check` verifies formatting.

```ts
import { DprintTasks } from "jsr:@zuke/dprint";
await DprintTasks.check((s) => s.config("dprint.json"));
```
@module

const DprintTasks: DprintTasksApi
  Typed task functions for the `dprint` code formatter.

class DprintCheckSettings extends DprintSettings
  Settings for `dprint check` (verify formatting without writing).

  override protected subcommand(): string

class DprintFmtSettings extends DprintSettings
  Settings for `dprint fmt` (format files in place).

  override protected subcommand(): string

interface DprintTasksApi
  The shape of {@link DprintTasks}.

  fmt(configure?: Configure<DprintFmtSettings>): Promise<CommandOutput>
    Format files in place: `dprint fmt`.
  check(configure?: Configure<DprintCheckSettings>): Promise<CommandOutput>
    Verify formatting: `dprint check`.
````

</details>

<!-- ZUKE:API:END -->

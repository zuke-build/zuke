# @zuke/husky

Typed [`husky`](https://typicode.github.io/husky) task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. `husky` manages Git hooks; this wrapper targets husky v9+.
Arguments stay a discrete argv array, so command construction is injection-free.

```ts
import { HuskyTasks } from "jsr:@zuke/husky";

await HuskyTasks.init();
await HuskyTasks.install();
```

> [!NOTE]
> husky v9 removed the legacy `install` subcommand. `HuskyTasks.install()` emits
> the bare `husky` invocation (optionally followed by a directory), which is how
> v9 installs the hooks.

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/husky` — typed `husky` task wrappers for Zuke builds.

`husky` (https://typicode.github.io/husky) manages Git hooks. Configure a
fluent settings object in a lambda; the task builds the argv and runs it.

```ts
import { HuskyTasks } from "jsr:@zuke/husky";
await HuskyTasks.init();
await HuskyTasks.install();
```
@module

const HuskyTasks: HuskyTasksApi
  Typed task functions for the `husky` Git-hooks tool.

class HuskyInitSettings extends HuskySettings
  Settings for `husky init [dir]` — scaffold husky in a project: create the
  hooks directory, add a sample `pre-commit` hook, and wire up the `prepare`
  script. This is the canonical husky v9 setup command.

  dir(path: PathLike): this
    The hooks directory to initialise (positional; defaults to `.husky`).
  override protected subcommandArgs(): string[]
    Assemble the `husky init [dir]` subcommand argv.

class HuskyInstallSettings extends HuskySettings
  Settings for installing Git hooks by invoking `husky [dir]` bare.

  husky v9 removed the old `install` subcommand: running `husky` with no
  subcommand is what installs the hooks (an optional directory may follow).
  This task therefore emits the bare `husky` invocation — its default argv is
  just `["husky"]`, not `["husky", "install"]`.

  dir(path: PathLike): this
    The hooks directory to install into (positional; defaults to `.husky`).
  override protected subcommandArgs(): string[]
    Assemble the bare `husky [dir]` invocation argv (no subcommand).

abstract class HuskySettings extends ToolSettings
  Shared base for every `husky` invocation: the binary and argv assembly.

  override protected defaultTool(): string
    The tool binary is `husky`.
  override protected defaultResolution(): ToolResolution
    Resolve the binary from `node_modules/.bin` by default — husky is an npm-distributed tool.
  abstract protected subcommandArgs(): string[]
    The subcommand argv (everything after the binary).
  override protected buildArgs(): string[]
    Assemble the full `husky` argv from the subcommand argv.

interface HuskyTasksApi
  The shape of {@link HuskyTasks}.

  init(configure?: Configure<HuskyInitSettings>): Promise<CommandOutput>
    Scaffold husky in a project: `husky init [dir]`.
  install(configure?: Configure<HuskyInstallSettings>): Promise<CommandOutput>
    Install Git hooks via the bare `husky [dir]` invocation (husky v9 removed
    the `install` subcommand).
````

</details>

<!-- ZUKE:API:END -->

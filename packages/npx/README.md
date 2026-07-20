# @zuke/npx

Typed `npx` package-runner task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — download and execute
a package binary in one step (npm's sibling of `bun x` and `pnpm dlx`).

```ts
import { NpxTasks } from "jsr:@zuke/npx";

await NpxTasks.npx((s) => s.command("cowsay").yes().execArgs("hello"));
```

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/npx` — typed `NpxTasks` wrappers for the `npx` package runner, for use
in Zuke build targets (including builds that drive Node projects).

```ts
import { NpxTasks } from "jsr:@zuke/npx";

await NpxTasks.npx((s) => s.command("cowsay").yes().execArgs("hello"));
```
@module

const NpxTasks: NpxTasksApi
  Typed task functions for the `npx` package runner.

class NpxSettings extends ToolSettings
  Settings for the `npx` package runner.

  override protected defaultTool(): string
    The executable this settings object drives: `npx`.
  command(name: string): this
    The package binary to execute (required unless {@link call} is set).
  package(...specs: string[]): this
    Packages to load before running (`--package=`); repeatable.
  call(script: string): this
    Execute a string as if inside `npm run-script` (`--call`).
  yes(): this
    Auto-install a missing package without prompting (`--yes`).
  no(): this
    Never auto-install; fail if the package is missing (`--no`).
  ignoreExisting(): this
    Ignore binaries already present in `$PATH` (`--ignore-existing`).
  execArgs(...args: Array<string | number>): this
    Arguments forwarded to the command.
  override protected buildArgs(): string[]
    Assemble the `npx <command>` argv from the configured settings.

interface NpxTasksApi
  The shape of {@link NpxTasks}.

  npx(configure?: Configure<NpxSettings>): Promise<CommandOutput>
    Download and execute a package binary: `npx <command>`.
````

</details>

<!-- ZUKE:API:END -->

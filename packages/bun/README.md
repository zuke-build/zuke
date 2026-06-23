# @zuke/bun

Typed `bun` CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `install`, `add`,
`remove`, `run`, `x` (bunx), and `test`.

```ts
import { BunTasks } from "jsr:@zuke/bun";

await BunTasks.install((s) => s.frozenLockfile());
await BunTasks.run((s) => s.script("build"));
await BunTasks.test((s) => s.coverage());
```

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/bun` — typed `BunTasks` wrappers for the `bun` CLI, for use in Zuke
build targets (package management, scripts, and the built-in test runner).

```ts
import { BunTasks } from "jsr:@zuke/bun";

await BunTasks.install((s) => s.frozenLockfile());
await BunTasks.run((s) => s.script("build"));
```
@module

const BunTasks: BunTasksApi
  Typed task functions for the `bun` CLI.

class BunAddSettings extends BunSettings
  Settings for `bun add`.

  packages(...specs: string[]): this
    Package specs to add (required).
  dev(): this
    Add to devDependencies (`--dev`).
  optional(): this
    Add to optionalDependencies (`--optional`).
  exact(): this
    Pin the exact version (`--exact`).
  global(): this
    Install globally (`--global`).
  override protected buildArgs(): string[]

class BunInstallSettings extends BunSettings
  Settings for `bun install`.

  production(): this
    Install without devDependencies (`--production`).
  frozenLockfile(): this
    Fail if the lockfile is out of date (`--frozen-lockfile`).
  override protected buildArgs(): string[]

class BunRemoveSettings extends BunSettings
  Settings for `bun remove`.

  packages(...names: string[]): this
    Package names to remove (required).
  override protected buildArgs(): string[]

class BunRunSettings extends BunSettings
  Settings for `bun run`.

  script(name: string): this
    The package.json script to run (required).
  scriptArgs(...args: Array<string | number>): this
    Arguments forwarded to the script.
  override protected buildArgs(): string[]

class BunTestSettings extends BunSettings
  Settings for `bun test`.

  paths(...patterns: string[]): this
    Test file or directory patterns to run; omit to run all tests.
  coverage(): this
    Collect coverage (`--coverage`).
  bail(): this
    Stop after the first failure (`--bail`).
  override protected buildArgs(): string[]

class BunXSettings extends BunSettings
  Settings for `bun x` (the `bunx` package runner).

  command(name: string): this
    The package binary to execute (required).
  execArgs(...args: Array<string | number>): this
    Arguments forwarded to the command.
  override protected buildArgs(): string[]

interface BunTasksApi
  The shape of {@link BunTasks}.

  install(configure?: Configure<BunInstallSettings>): Promise<CommandOutput>
    Install dependencies: `bun install`.
  add(configure?: Configure<BunAddSettings>): Promise<CommandOutput>
    Add dependencies: `bun add`.
  remove(configure?: Configure<BunRemoveSettings>): Promise<CommandOutput>
    Remove dependencies: `bun remove`.
  run(configure?: Configure<BunRunSettings>): Promise<CommandOutput>
    Run a package.json script: `bun run`.
  x(configure?: Configure<BunXSettings>): Promise<CommandOutput>
    Execute a package binary: `bun x` (bunx).
  test(configure?: Configure<BunTestSettings>): Promise<CommandOutput>
    Run the test suite: `bun test`.
````

</details>

<!-- ZUKE:API:END -->

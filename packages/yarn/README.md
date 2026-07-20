# @zuke/yarn

Typed `yarn` CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `install`, `add`,
`remove`, `run`, and `dlx`.

Works with both Yarn Classic (v1) and Berry (v2+); options that exist on only
one line are noted in their JSDoc (e.g. `.immutable()` is Berry, `dlx` is
Berry).

```ts
import { YarnTasks } from "jsr:@zuke/yarn";

await YarnTasks.install((s) => s.immutable());
await YarnTasks.run((s) => s.script("build"));
```

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/yarn` — typed `YarnTasks` wrappers for the `yarn` CLI, for use in Zuke
build targets (Yarn Classic v1 and Berry v2+; version-specific options are
documented on each method).

```ts
import { YarnTasks } from "jsr:@zuke/yarn";

await YarnTasks.install((s) => s.immutable());
await YarnTasks.run((s) => s.script("build"));
```
@module

const YarnTasks: YarnTasksApi
  Typed task functions for the `yarn` CLI.

class YarnAddSettings extends YarnSettings
  Settings for `yarn add`.

  packages(...specs: string[]): this
    Package specs to add (required).
  dev(): this
    Add to devDependencies (`--dev`).
  exact(): this
    Pin the exact version (`--exact`).
  override protected buildArgs(): string[]
    Assemble the `yarn add` argv.

class YarnDlxSettings extends YarnSettings
  Settings for `yarn dlx` (Yarn Berry's one-off package runner).

  command(name: string): this
    The command to execute (required).
  package(spec: string): this
    An extra package to make available (`--package`).
  execArgs(...args: Array<string | number>): this
    Arguments forwarded to the command.
  override protected buildArgs(): string[]
    Assemble the `yarn dlx` argv.

class YarnInstallSettings extends YarnSettings
  Settings for `yarn install`.

  immutable(): this
    Fail if the lockfile would change — `--immutable` (Yarn Berry).
  frozenLockfile(): this
    Fail if the lockfile would change — `--frozen-lockfile` (Yarn Classic).
  override protected buildArgs(): string[]
    Assemble the `yarn install` argv.

class YarnRemoveSettings extends YarnSettings
  Settings for `yarn remove`.

  packages(...names: string[]): this
    Package names to remove (required).
  override protected buildArgs(): string[]
    Assemble the `yarn remove` argv.

class YarnRunSettings extends YarnSettings
  Settings for `yarn run`.

  script(name: string): this
    The package.json script to run (required).
  scriptArgs(...args: Array<string | number>): this
    Arguments forwarded to the script.
  override protected buildArgs(): string[]
    Assemble the `yarn run` argv.

abstract class YarnSettings extends ToolSettings
  Base for all `yarn` subcommand settings: binary is `yarn` from PATH.

  override protected defaultTool(): string
    The default binary: `yarn` resolved from PATH.

interface YarnTasksApi
  The shape of {@link YarnTasks}.

  install(configure?: Configure<YarnInstallSettings>): Promise<CommandOutput>
    Install dependencies: `yarn install`.
  add(configure?: Configure<YarnAddSettings>): Promise<CommandOutput>
    Add dependencies: `yarn add`.
  remove(configure?: Configure<YarnRemoveSettings>): Promise<CommandOutput>
    Remove dependencies: `yarn remove`.
  run(configure?: Configure<YarnRunSettings>): Promise<CommandOutput>
    Run a package.json script: `yarn run`.
  dlx(configure?: Configure<YarnDlxSettings>): Promise<CommandOutput>
    Download and execute a package binary: `yarn dlx` (Berry).
````

</details>

<!-- ZUKE:API:END -->

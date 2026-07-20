# @zuke/pnpm

Typed `pnpm` CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `install`, `add`,
`remove`, `run`, `dlx`, and `publish`.

```ts
import { PnpmTasks } from "jsr:@zuke/pnpm";

await PnpmTasks.install((s) => s.frozenLockfile());
await PnpmTasks.run((s) => s.script("build").filter("app"));
```

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/pnpm` — typed `PnpmTasks` wrappers for the `pnpm` CLI, for use in Zuke
build targets (including builds that drive Node/workspace projects).

```ts
import { PnpmTasks } from "jsr:@zuke/pnpm";

await PnpmTasks.install((s) => s.frozenLockfile());
await PnpmTasks.run((s) => s.script("build").filter("app"));
```
@module

const PnpmTasks: PnpmTasksApi
  Typed task functions for the `pnpm` CLI.

class PnpmAddSettings extends PnpmSettings
  Settings for `pnpm add`.

  packages(...specs: string[]): this
    Package specs to add (required).
  saveDev(): this
    Save to devDependencies (`--save-dev`).
  saveExact(): this
    Pin the exact version (`--save-exact`).
  global(): this
    Install globally (`--global`).
  override protected buildArgs(): string[]
    Assemble the `pnpm add` argv.

class PnpmDlxSettings extends PnpmSettings
  Settings for `pnpm dlx`.

  command(name: string): this
    The command to execute (required).
  package(spec: string): this
    The package providing the command (`--package=`).
  execArgs(...args: Array<string | number>): this
    Arguments forwarded to the command.
  override protected buildArgs(): string[]
    Assemble the `pnpm dlx` argv.

class PnpmInstallSettings extends PnpmSettings
  Settings for `pnpm install`.

  frozenLockfile(): this
    Fail if the lockfile is out of date (`--frozen-lockfile`).
  prod(): this
    Install without devDependencies (`--prod`).
  override protected buildArgs(): string[]
    Assemble the `pnpm install` argv.

class PnpmPublishSettings extends PnpmSettings
  Settings for `pnpm publish`.

  tag(name: string): this
    Publish under a dist-tag (`--tag=`).
  access(level: PnpmAccess): this
    Set the package access level (`--access=`).
  noGitChecks(): this
    Skip the clean-working-tree checks (`--no-git-checks`).
  dryRun(): this
    Report what would be published without uploading (`--dry-run`).
  override protected buildArgs(): string[]
    Assemble the `pnpm publish` argv.

class PnpmRemoveSettings extends PnpmSettings
  Settings for `pnpm remove`.

  packages(...names: string[]): this
    Package names to remove (required).
  override protected buildArgs(): string[]
    Assemble the `pnpm remove` argv.

class PnpmRunSettings extends PnpmSettings
  Settings for `pnpm run`.

  script(name: string): this
    The package.json script to run (required).
  filter(pattern: string): this
    Restrict to matching workspace packages (`--filter`).
  ifPresent(): this
    Do not fail when the script is missing (`--if-present`).
  scriptArgs(...args: Array<string | number>): this
    Arguments forwarded to the script.
  override protected buildArgs(): string[]
    Assemble the `pnpm run` argv.

abstract class PnpmSettings extends ToolSettings
  Base for all `pnpm` subcommand settings: binary is `pnpm` from PATH.

  override protected defaultTool(): string
    The default binary: `pnpm` resolved from PATH.

interface PnpmTasksApi
  The shape of {@link PnpmTasks}.

  install(configure?: Configure<PnpmInstallSettings>): Promise<CommandOutput>
    Install dependencies: `pnpm install`.
  add(configure?: Configure<PnpmAddSettings>): Promise<CommandOutput>
    Add dependencies: `pnpm add`.
  remove(configure?: Configure<PnpmRemoveSettings>): Promise<CommandOutput>
    Remove dependencies: `pnpm remove`.
  run(configure?: Configure<PnpmRunSettings>): Promise<CommandOutput>
    Run a package.json script: `pnpm run`.
  dlx(configure?: Configure<PnpmDlxSettings>): Promise<CommandOutput>
    Download and execute a package binary: `pnpm dlx`.
  publish(configure?: Configure<PnpmPublishSettings>): Promise<CommandOutput>
    Publish the package: `pnpm publish`.

type PnpmAccess = "public" | "restricted"
  An access level accepted by pnpm's `--access` flag.
````

</details>

<!-- ZUKE:API:END -->

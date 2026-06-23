# @zuke/npm

Typed `npm` CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `install`, `ci`,
`run`, `exec`, `publish`, and `version`.

```ts
import { NpmTasks } from "jsr:@zuke/npm";

await NpmTasks.ci();
await NpmTasks.run((s) => s.script("build"));
```

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/npm` — typed `NpmTasks` wrappers for the `npm` CLI, for use in Zuke
build targets (including builds that drive Node projects).

```ts
import { NpmTasks } from "jsr:@zuke/npm";

await NpmTasks.ci();
await NpmTasks.run((s) => s.script("build"));
```
@module

const NpmTasks: NpmTasksApi
  Typed task functions for the `npm` CLI.

class NpmCiSettings extends NpmSettings
  Settings for `npm ci`.

  omit(type: NpmOmitType): this
    Skip a dependency group (`--omit=dev` etc.); repeatable.
  override protected buildArgs(): string[]

class NpmExecSettings extends NpmSettings
  Settings for `npm exec`.

  command(name: string): this
    The command to execute (required).
  package(spec: string): this
    The package providing the command (`--package=`).
  yes(): this
    Skip the install prompt (`--yes`).
  execArgs(...args: Array<string | number>): this
    Arguments forwarded to the command (after `--`).
  override protected buildArgs(): string[]

class NpmInstallSettings extends NpmSettings
  Settings for `npm install`.

  packages(...specs: string[]): this
    Package specs to install; omit to install from package.json.
  saveDev(): this
    Save to devDependencies (`--save-dev`).
  saveExact(): this
    Pin exact versions (`--save-exact`).
  override protected buildArgs(): string[]

class NpmPublishSettings extends NpmSettings
  Settings for `npm publish`.

  tag(name: string): this
    Publish under a dist-tag (`--tag=`).
  access(level: NpmAccess): this
    Set the package access level (`--access=`).
  dryRun(): this
    Report what would be published without uploading (`--dry-run`).
  otp(code: string): this
    Provide a one-time password (`--otp=`).
  override protected buildArgs(): string[]

class NpmRunSettings extends NpmSettings
  Settings for `npm run`.

  script(name: string): this
    The package.json script to run (required).
  workspace(name: string): this
    Run in a specific workspace (`--workspace=`).
  ifPresent(): this
    Do not fail when the script is missing (`--if-present`).
  scriptArgs(...args: Array<string | number>): this
    Arguments forwarded to the script (after `--`).
  override protected buildArgs(): string[]

class NpmVersionSettings extends NpmSettings
  Settings for `npm version`.

  bump(value: string): this
    The bump: `patch` | `minor` | `major` or an explicit semver (required).
  message(text: string): this
    Commit message; `%s` expands to the new version (`--message`).
  noGitTagVersion(): this
    Do not create a git commit and tag (`--no-git-tag-version`).
  override protected buildArgs(): string[]

interface NpmTasksApi
  The shape of {@link NpmTasks}.

  install(configure?: Configure<NpmInstallSettings>): Promise<CommandOutput>
    Install dependencies: `npm install`.
  ci(configure?: Configure<NpmCiSettings>): Promise<CommandOutput>
    Clean install from the lockfile: `npm ci`.
  run(configure?: Configure<NpmRunSettings>): Promise<CommandOutput>
    Run a package.json script: `npm run`.
  exec(configure?: Configure<NpmExecSettings>): Promise<CommandOutput>
    Execute a package binary: `npm exec`.
  publish(configure?: Configure<NpmPublishSettings>): Promise<CommandOutput>
    Publish the package: `npm publish`.
  version(configure?: Configure<NpmVersionSettings>): Promise<CommandOutput>
    Bump the package version: `npm version`.

type NpmAccess = "public" | "restricted"
  An access level accepted by npm's `--access` flag.

type NpmOmitType = "dev" | "optional" | "peer"
  A dependency group accepted by npm's `--omit` flag.
````

</details>

<!-- ZUKE:API:END -->

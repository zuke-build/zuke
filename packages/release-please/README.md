# @zuke/release-please

Typed [release-please](https://github.com/googleapis/release-please) CLI task
wrappers for [Zuke](https://github.com/zuke-build/zuke#readme) builds — maintain
release PRs and cut GitHub releases.

```ts
import { ReleasePleaseTasks } from "jsr:@zuke/release-please";

await ReleasePleaseTasks.releasePr((s) =>
  s.token(token).repoUrl("owner/repo").targetBranch("main")
);
await ReleasePleaseTasks.githubRelease((s) =>
  s.token(token).repoUrl("owner/repo").targetBranch("main")
);
```

release-please ships only on npm, so install it first (e.g. with
`DenoTasks.install` or `npm`) and point the wrapper at the binary with
`.toolPath(...)`.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/release-please` — typed `ReleasePleaseTasks` wrappers for the
release-please (https://github.com/googleapis/release-please) CLI, for use in
Zuke builds (maintaining release PRs and cutting GitHub releases).

```ts
import { ReleasePleaseTasks } from "jsr:@zuke/release-please";

await ReleasePleaseTasks.releasePr((s) =>
  s.token(token).repoUrl("owner/repo").targetBranch("main"));
await ReleasePleaseTasks.githubRelease((s) =>
  s.token(token).repoUrl("owner/repo").targetBranch("main"));
```
@module

const ReleasePleaseTasks: ReleasePleaseTasksApi
  Typed task functions for the `release-please` CLI.

class ReleasePleaseGithubReleaseSettings extends ReleasePleaseSettings
  Settings for `release-please github-release` (cut releases and tags).

  override protected subcommand(): string
    The subcommand token, `github-release`.

class ReleasePleaseReleasePrSettings extends ReleasePleaseSettings
  Settings for `release-please release-pr` (maintain the release PR).

  override protected subcommand(): string
    The subcommand token, `release-pr`.

abstract class ReleasePleaseSettings extends ToolSettings
  Shared base for release-please subcommands. Each subcommand contributes its
  leading token via {@link subcommand}; the common `--token`/`--repo-url`/… flags
  live here since `release-pr` and `github-release` accept the same set.

  override protected defaultTool(): string
    The default binary name, `release-please`.
  abstract protected subcommand(): string
    The subcommand token, e.g. `release-pr`.
  token(value: string): this
    GitHub access token (`--token`).
  repoUrl(value: string): this
    The repository, as `owner/repo` or a URL (`--repo-url`).
  targetBranch(value: string): this
    The branch to release from (`--target-branch`).
  configFile(path: PathLike): this
    Path to the release-please config file (`--config-file`).
  manifestFile(path: PathLike): this
    Path to the release-please manifest file (`--manifest-file`).
  dryRun(): this
    Print actions without performing them (`--dry-run`).
  debug(): this
    Emit verbose debug logging (`--debug`).
  override protected buildArgs(): string[]
    Assemble the `release-please <subcommand>` argv with the common flags.

interface ReleasePleaseTasksApi
  The shape of {@link ReleasePleaseTasks}.

  releasePr(configure?: Configure<ReleasePleaseReleasePrSettings>): Promise<CommandOutput>
    Create or update the release PR: `release-please release-pr`.
  githubRelease(configure?: Configure<ReleasePleaseGithubReleaseSettings>): Promise<CommandOutput>
    Cut GitHub releases and tags: `release-please github-release`.
````

</details>

<!-- ZUKE:API:END -->

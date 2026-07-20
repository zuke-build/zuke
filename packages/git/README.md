# @zuke/git

Typed [`git`](https://git-scm.com/) task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. Typed tasks cover the common commands; `GitTasks.run` with
`.command(...)` handles anything else. Every command shares the global options
`.dir()` (`-C <path>`) and `.config()` (`-c key=value`). Arguments stay a
discrete argv array, so command construction is injection-free.

```ts
import { GitTasks } from "jsr:@zuke/git";

await GitTasks.add((s) => s.all());
await GitTasks.commit((s) => s.message("ci: cut release"));
await GitTasks.tag((s) => s.name("v1.2.3").message("Release 1.2.3"));
await GitTasks.push((s) => s.remote("origin").ref("main").tags());

// Anything without a typed task:
await GitTasks.run((s) => s.command("rev-parse", "--short", "HEAD"));
```

Tasks: `init`, `clone`, `add`, `commit`, `status`, `checkout`, `branch`, `tag`,
`push`, `pull`, `fetch`, and `run`.

## Repository info — `gitInfo()`

`gitInfo()` resolves the current repository's metadata for versioning and
conditional steps: `branch`, `commit`/`shortCommit`, nearest `tag`, `dirty`
flag, and `remoteUrl`. It throws outside a git repository; optional fields are
`undefined` when absent. Pass `{ cwd }` to inspect another directory.

```ts
import { gitInfo } from "jsr:@zuke/git";

const git = await gitInfo();
console.log(`${git.branch} @ ${git.shortCommit}${git.dirty ? " (dirty)" : ""}`);
```

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/git` — typed `git` task wrappers for Zuke builds.

Configure a fluent settings object in a lambda; the task builds the argv and
runs it. Typed tasks cover the common commands (add, commit, push, …); use
`GitTasks.run` with `.command(...)` for anything else.

```ts
import { GitTasks, gitInfo } from "jsr:@zuke/git";
await GitTasks.commit((s) => s.all().message("ci: release"));
const { branch, shortCommit } = await gitInfo();
```

The `gitInfo()` helper resolves repository metadata (branch, commit, tag,
dirty state, remote) for versioning and conditional steps.
@module

async function gitInfo(options: GitInfoOptions): Promise<GitInfo>
  Resolve {@link GitInfo} for the repository at `cwd`. Throws if `cwd` is not a
  git repository (or `git` is unavailable). Optional fields (`tag`, `remoteUrl`)
  are `undefined` when absent.

const GitTasks: GitTasksApi
  Typed task functions for the common `git` commands.

class GitAddSettings extends GitSettings
  Settings for `git add`.

  paths(...values: PathLike[]): this
    Paths/pathspecs to stage (positional); repeatable.
  all(): this
    Stage all changes including new files (`-A`/`--all`).
  update(): this
    Stage modifications and deletions, but not new files (`-u`/`--update`).
  override protected subcommandArgs(): string[]
    Assemble the `git add` argv.

class GitBranchSettings extends GitSettings
  Settings for `git branch`.

  name(value: string): this
    The branch name to create or operate on.
  deleteBranch(force: boolean): this
    Delete the branch (`-d`, or `-D` when forced).
  all(): this
    List both local and remote-tracking branches (`-a`/`--all`).
  override protected subcommandArgs(): string[]
    Assemble the `git branch` argv.

class GitCheckoutSettings extends GitSettings
  Settings for `git checkout`.

  ref(target: string): this
    The branch, commit, or path to check out (required).
  create(): this
    Create a new branch (`-b`).
  force(): this
    Force checkout, discarding local changes (`-f`/`--force`).
  override protected subcommandArgs(): string[]
    Assemble the `git checkout` argv.

class GitCloneSettings extends GitSettings
  Settings for `git clone`.

  repository(url: string): this
    The repository URL to clone (required).
  directory(path: PathLike): this
    Target directory for the clone.
  branch(name: string): this
    Check out a specific branch (`-b`/`--branch`).
  depth(commits: number): this
    Create a shallow clone of the given depth (`--depth`).
  bare(): this
    Clone a bare repository (`--bare`).
  override protected subcommandArgs(): string[]
    Assemble the `git clone` argv.

class GitCommitSettings extends GitSettings
  Settings for `git commit`.

  message(text: string): this
    The commit message (`-m`).
  all(): this
    Stage modified/deleted files before committing (`-a`/`--all`).
  amend(): this
    Amend the previous commit (`--amend`).
  noEdit(): this
    Keep the existing message when amending (`--no-edit`).
  allowEmpty(): this
    Allow a commit with no changes (`--allow-empty`).
  override protected subcommandArgs(): string[]
    Assemble the `git commit` argv.

class GitFetchSettings extends GitSettings
  Settings for `git fetch`.

  remote(name: string): this
    The remote to fetch from.
  all(): this
    Fetch from all remotes (`--all`).
  tags(): this
    Also fetch tags (`--tags`).
  prune(): this
    Prune deleted remote refs (`--prune`).
  override protected subcommandArgs(): string[]
    Assemble the `git fetch` argv.

class GitInitSettings extends GitSettings
  Settings for `git init`.

  bare(): this
    Create a bare repository (`--bare`).
  initialBranch(name: string): this
    Name the initial branch (`-b`/`--initial-branch`).
  override protected subcommandArgs(): string[]
    Assemble the `git init` argv.

class GitPullSettings extends GitSettings
  Settings for `git pull`.

  remote(name: string): this
    The remote to pull from.
  ref(value: string): this
    The refspec/branch to pull.
  rebase(): this
    Rebase instead of merge (`--rebase`).
  ffOnly(): this
    Only fast-forward (`--ff-only`).
  override protected subcommandArgs(): string[]
    Assemble the `git pull` argv.

class GitPushSettings extends GitSettings
  Settings for `git push`.

  remote(name: string): this
    The remote to push to (e.g. `origin`).
  ref(value: string): this
    The refspec/branch to push.
  setUpstream(): this
    Set the upstream tracking ref (`-u`/`--set-upstream`).
  tags(): this
    Also push tags (`--tags`).
  forceWithLease(): this
    Force push, but only if the remote ref is unchanged (`--force-with-lease`).
  deleteRef(): this
    Delete the remote ref (`--delete`).
  override protected subcommandArgs(): string[]
    Assemble the `git push` argv.

class GitRunSettings extends GitSettings
  Settings for an arbitrary `git` command not covered by a typed task.

  command(...parts: Array<string | number>): this
    The subcommand and its arguments, e.g. `command("rev-parse", "HEAD")`.
  override protected subcommandArgs(): string[]
    Assemble the arbitrary `git` subcommand argv from `.command(...)`.

abstract class GitSettings extends ToolSettings
  Shared base for every `git` subcommand: the binary and global options.

  override protected defaultTool(): string
    The default tool binary: `git`.
  abstract protected subcommandArgs(): string[]
    The subcommand argv (after the global options).
  dir(path: PathLike): this
    Run git as if started in `path` (`-C <path>`).
  config(key: string, value: string): this
    Set a one-off config value (`-c key=value`); repeatable.
  override protected buildArgs(): string[]
    Assemble the `git` argv: global options followed by the subcommand.

class GitStatusSettings extends GitSettings
  Settings for `git status`.

  short(): this
    Short-format output (`-s`/`--short`).
  porcelain(): this
    Stable machine-readable output (`--porcelain`).
  branch(): this
    Show branch information (`-b`/`--branch`).
  override protected subcommandArgs(): string[]
    Assemble the `git status` argv.

class GitTagSettings extends GitSettings
  Settings for `git tag`.

  name(value: string): this
    The tag name.
  message(text: string): this
    Create an annotated tag with this message (`-a -m`).
  force(): this
    Replace an existing tag (`-f`/`--force`).
  deleteTag(): this
    Delete the tag (`-d`/`--delete`).
  override protected subcommandArgs(): string[]
    Assemble the `git tag` argv.

interface GitInfo
  Resolved git repository information.

  branch: string
    Current branch, or `"HEAD"` when detached.
  commit: string
    Full commit SHA of `HEAD`.
  shortCommit: string
    Abbreviated commit SHA.
  tag?: string
    The nearest tag (`git describe --tags --abbrev=0`), if any.
  dirty: boolean
    Whether the working tree has uncommitted changes.
  remoteUrl?: string
    The `origin` remote URL, if configured.

interface GitInfoOptions
  Options for {@link gitInfo}.

  cwd?: string
    Directory to inspect (defaults to the current directory).
  run?: GitRunner
    Override how git is invoked (defaults to spawning `git`); for testing.

interface GitTasksApi
  The shape of {@link GitTasks}.

  init(configure?: Configure<GitInitSettings>): Promise<CommandOutput>
    Create a repository: `git init`.
  clone(configure?: Configure<GitCloneSettings>): Promise<CommandOutput>
    Clone a repository: `git clone`.
  add(configure?: Configure<GitAddSettings>): Promise<CommandOutput>
    Stage changes: `git add`.
  commit(configure?: Configure<GitCommitSettings>): Promise<CommandOutput>
    Record changes: `git commit`.
  status(configure?: Configure<GitStatusSettings>): Promise<CommandOutput>
    Show working-tree status: `git status`.
  checkout(configure?: Configure<GitCheckoutSettings>): Promise<CommandOutput>
    Switch branches or restore files: `git checkout`.
  branch(configure?: Configure<GitBranchSettings>): Promise<CommandOutput>
    Manage branches: `git branch`.
  tag(configure?: Configure<GitTagSettings>): Promise<CommandOutput>
    Manage tags: `git tag`.
  push(configure?: Configure<GitPushSettings>): Promise<CommandOutput>
    Update remote refs: `git push`.
  pull(configure?: Configure<GitPullSettings>): Promise<CommandOutput>
    Fetch and integrate: `git pull`.
  fetch(configure?: Configure<GitFetchSettings>): Promise<CommandOutput>
    Download objects and refs: `git fetch`.
  run(configure?: Configure<GitRunSettings>): Promise<CommandOutput>
    Run any other git command via `.command(...)`.

type GitRunner = (args: string[]) => Promise<string | null>
  Runs a `git` subcommand and resolves to its trimmed stdout, or `null` when
  the command fails (non-zero exit, or `git` unavailable).
````

</details>

<!-- ZUKE:API:END -->

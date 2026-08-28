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
await GitTasks.push((s) => s.remote("origin").ref("main").followTags());

// Anything without a typed task (bisect, notes, blame, …):
await GitTasks.run((s) => s.command("bisect", "start"));
```

Tasks, by what they do:

| Area                 | Tasks                                                              |
| -------------------- | ------------------------------------------------------------------ |
| Start a working area | `init`, `clone`, `worktree`                                        |
| Working tree & index | `add`, `rm`, `mv`, `restore`, `clean`, `reset`, `stash`, `commit`  |
| Branches & tags      | `branch`, `checkout`, `switch`, `tag`                              |
| Inspect              | `status`, `log`, `show`, `diff`, `lsFiles`, `revParse`, `describe` |
| Integrate            | `merge`, `rebase`, `cherryPick`, `revert`, `apply`                 |
| Collaborate          | `push`, `pull`, `fetch`, `remote`, `lsRemote`, `submodule`         |
| Everything else      | `config`, `archive`, `run`                                         |

## Tasks that hand back values

Most tasks resolve to the raw `CommandOutput`. These run a machine-readable form
of the command and parse it, so a target reads git's answer instead of scraping
stdout:

```ts
const changed = await GitTasks.diffNames((s) => s.mergeBase("origin/main"));
const commits = await GitTasks.logEntries((s) => s.range("v1.2.0"));
const dirty = await GitTasks.statusEntries(); // [] means a clean tree
const remotes = await GitTasks.remoteList(); // { name, fetchUrl, pushUrl }[]
const files = await GitTasks.lsFileNames((s) => s.others().excludeStandard());
const sha = await GitTasks.revision((s) => s.short().rev("HEAD"));
const url = await GitTasks.configGet((s) => s.get("remote.origin.url"));
const base = await GitTasks.defaultBranch(); // `main`, `master`, whichever
const trees = await GitTasks.worktreeList();
```

`statusEntries`, `diffNames`, and `lsFileNames` use git's `-z` forms, whose
NUL-delimited records survive a path containing a space or a newline;
`logEntries` pins a `--format` separated by the ASCII unit and record
separators, which a commit message cannot contain. `configGet` reports an unset
key as `undefined` rather than failing, since `git config --get` signals that
through its exit code.

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
runs it. Typed tasks cover the everyday commands — staging, committing,
branching, transferring, inspecting history, integrating work, remotes,
config, submodules, archives, patches — and `GitTasks.run` with
`.command(...)` covers the long tail.

```ts
import { GitTasks, gitInfo } from "jsr:@zuke/git";
await GitTasks.commit((s) => s.all().message("ci: release"));
const changed = await GitTasks.diffNames((s) => s.mergeBase("origin/main"));
const { branch, shortCommit } = await gitInfo();
```

A handful of tasks hand back parsed values rather than raw output —
`statusEntries`, `logEntries`, `diffNames`, `lsFileNames`, `remoteList`,
`worktreeList`, `revision`, `configGet`, `defaultBranch` — so a target reads
git's answer instead of scraping stdout. The `gitInfo()` helper resolves
repository metadata (branch, commit, tag, dirty state, remote) for
versioning and conditional steps.
@module

async function gitInfo(options: GitInfoOptions): Promise<GitInfo>
  Resolve {@link GitInfo} for the repository at `cwd`. Throws if `cwd` is not a
  git repository (or `git` is unavailable). Optional fields (`tag`, `remoteUrl`)
  are `undefined` when absent.

const GitTasks: GitTasksApi
  Typed task functions for the `git` commands.

const LOG_ENTRY_FORMAT: string
  The `--format` {@link readLogEntries} pins. Fields in {@link GitCommitEntry}
  order, separated by `%x1f`, each commit terminated by `%x1e` — separators no
  commit message can contain, unlike the newlines a line-oriented format would
  rely on.

class GitAddSettings extends GitSettings
  Settings for `git add`.

  paths(...values: PathLike[]): this
    Paths/pathspecs to stage (positional); repeatable.
  all(): this
    Stage all changes including new files (`-A`/`--all`).
  update(): this
    Stage modifications and deletions, but not new files (`-u`/`--update`).
  force(): this
    Stage files git would otherwise ignore (`-f`/`--force`).
  intentToAdd(): this
    Record the paths' existence but not their contents (`-N`/`--intent-to-add`),
    which is what makes an untracked file show up in `git diff`.
  override protected subcommandArgs(): string[]
    Assemble the `git add` argv.

class GitApplySettings extends GitSettings
  Settings for `git apply`.

  patches(...values: PathLike[]): this
    The patch files to apply (positional); repeatable. Reads stdin when empty.
  check(): this
    Report whether the patch would apply, changing nothing (`--check`).
  reverse(): this
    Apply the patch backwards (`--reverse`).
  threeWay(): this
    Fall back to a three-way merge when the patch does not apply cleanly
    (`--3way`), leaving conflict markers instead of refusing outright.
  index(): this
    Apply to the index as well as the working tree (`--index`).
  cached(): this
    Apply to the index only, leaving the working tree alone (`--cached`).
  strip(components: number): this
    Strip this many leading path components (`-p<n>`); git's default is 1.
  whitespace(action: "nowarn" | "warn" | "fix" | "error" | "error-all"): this
    What to do about whitespace errors (`--whitespace=<action>`): `nowarn`,
    `warn`, `fix`, `error`, or `error-all`.
  exclude(...patterns: string[]): this
    Skip files matching this pattern (`--exclude=<pattern>`); repeatable.
  override protected subcommandArgs(): string[]
    Assemble the `git apply` argv.

class GitArchiveSettings extends GitSettings
  Settings for `git archive`.

  treeish(rev: string): this
    The tree, commit, or tag to archive (positional, required).
  format(name: string): this
    The archive format (`--format=<fmt>`), e.g. `tar`, `tar.gz`, or `zip`.
  output(path: PathLike): this
    Write to this file (`--output=<file>`) instead of stdout.
  prefix(value: string): this
    Prepend this path to every entry (`--prefix=<prefix>/`).
  remote(nameOrUrl: string): this
    Ask a remote repository for the archive (`--remote=<repo>`).
  paths(...values: PathLike[]): this
    Archive only these pathspecs (positional); repeatable.
  override protected subcommandArgs(): string[]
    Assemble the `git archive` argv.

class GitBranchSettings extends GitSettings
  Settings for `git branch`.

  name(value: string): this
    The branch name to create or operate on.
  startPoint(rev: string): this
    The commit a created branch forks from (git's trailing `<start-point>`),
    e.g. `origin/main`.
  deleteBranch(force: boolean): this
    Delete the branch (`-d`, or `-D` when forced).
  rename(newName: string, force: boolean): this
    Rename {@link name} to `newName` (`-m`, or `-M` when forced).
  setUpstreamTo(ref: string): this
    Point the branch's upstream at this ref (`--set-upstream-to=<ref>`).
  all(): this
    List both local and remote-tracking branches (`-a`/`--all`).
  remotes(): this
    List remote-tracking branches only (`-r`/`--remotes`).
  contains(rev: string): this
    List only branches containing this commit (`--contains <commit>`).
  merged(ref: string): this
    List only branches already merged into this ref (`--merged <ref>`) — the
    listing a cleanup target filters stale branches from.
  format(spec: string): this
    Render a listing through a format string (`--format=<fmt>`), e.g.
    `%(refname:short)` for bare branch names with no `*` marker or padding.
  sort(key: string): this
    Order a listing (`--sort=<key>`), e.g. `-committerdate` for most recent first.
  override protected subcommandArgs(): string[]
    Assemble the `git branch` argv.

class GitCheckoutSettings extends GitSettings
  Settings for `git checkout`.

  ref(target: string): this
    The branch or commit to check out — or, with {@link paths}, the source to
    restore those paths from. Required unless {@link paths} is given.
  paths(...paths: string[]): this
    Restore one or more paths (`git checkout [<ref>] -- <paths>`). The `--`
    separates paths from any ref so a path is never misread as a branch name;
    repeatable. With no {@link ref}, restores the paths from the index
    (discarding working-tree changes).
  create(): this
    Create a new branch (`-b`).
  detach(): this
    Check the ref out with a detached `HEAD` (`--detach`).
  force(): this
    Force checkout, discarding local changes (`-f`/`--force`).
  override protected subcommandArgs(): string[]
    Assemble the `git checkout` argv.

class GitCherryPickSettings extends GitReplaySettings
  Settings for `git cherry-pick`.

  allowEmpty(): this
    Keep a commit that produces no changes (`--allow-empty`).
  ff(): this
    Fast-forward instead of rewriting when the parent matches `HEAD` (`--ff`).
  override protected replayCommand(): string
    The `cherry-pick` subcommand token.
  override protected taskName(): string
    The `GitTasks` method that runs it.
  override protected replayFlags(): string[]
    `cherry-pick`'s own flags.

class GitCleanSettings extends GitSettings
  Settings for `git clean`.

  paths(...values: PathLike[]): this
    Limit the clean to these pathspecs (positional); repeatable.
  force(): this
    Actually delete the files (`-f`/`--force`).
  dryRun(): this
    List what would be deleted without deleting it (`-n`/`--dry-run`).
  directories(): this
    Also remove untracked directories (`-d`).
  includeIgnored(): this
    Remove ignored files too (`-x`) — the switch that turns a clean into a
    from-scratch build, since `node_modules` and `target/` are ignored.
  onlyIgnored(): this
    Remove only ignored files (`-X`), keeping other untracked ones.
  exclude(...patterns: string[]): this
    Spare paths matching this pattern (`--exclude=<pattern>`); repeatable.
  override protected subcommandArgs(): string[]
    Assemble the `git clean` argv.

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
  filter(spec: string): this
    Partial-clone filter (`--filter=<spec>`), e.g. `blob:none` for a treeless
    clone that fetches blobs on demand — the cheap way to get full history in
    CI without the file contents of every revision.
  singleBranch(): this
    Clone only the history of the checked-out branch (`--single-branch`).
  recurseSubmodules(): this
    Also clone submodules (`--recurse-submodules`).
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
  noVerify(): this
    Skip the `pre-commit` and `commit-msg` hooks (`--no-verify`) — what a bot
    commit wants when the hooks are meant for humans at a terminal.
  author(value: string): this
    Attribute the commit to someone else (`--author="Name <email>"`).
  paths(...values: PathLike[]): this
    Commit only these pathspecs (positional); repeatable.
  override protected subcommandArgs(): string[]
    Assemble the `git commit` argv.

class GitConfigSettings extends GitSettings
  Settings for `git config`. Pick the operation with {@link get},
  {@link getAll}, {@link set}, {@link add}, {@link unset}, or {@link list},
  and the file with {@link global}, {@link local}, {@link system},
  {@link worktree}, or {@link file}.

  get(key: string): this
    Read a key's value (`--get <key>`).
  getAll(key: string): this
    Read every value of a multi-valued key (`--get-all <key>`).
  set(key: string, value: string): this
    Set a key, replacing any existing value (`git config <key> <value>`).
  add(key: string, value: string): this
    Add another value to a multi-valued key (`--add <key> <value>`).
  unset(key: string): this
    Remove a key (`--unset <key>`).
  list(): this
    List every configured key (`--list`).
  global(): this
    Use the user's configuration (`--global`).
  local(): this
    Use the repository's configuration (`--local`).
  system(): this
    Use the machine's configuration (`--system`).
  worktree(): this
    Use the worktree's configuration (`--worktree`).
  file(path: PathLike): this
    Use a specific file (`--file <path>`), rather than one of the scopes.
  defaultValue(value: string): this
    What to report when the key is unset (`--default <value>`), which also
    makes `--get` exit 0 instead of 1.
  override protected subcommandArgs(): string[]
    Assemble the `git config` argv.

class GitDefaultBranchSettings extends GitSettings
  Settings for {@link "./git.ts".GitTasks.defaultBranch}: which remote to ask,
  plus the global options every git task shares.

  askRemote_: boolean
    Ask the remote itself rather than reading the local ref. Set by the task
    for its fallback attempt; a caller has no reason to set it, since the task
    already tries both in the order that avoids the network when it can.
  remote(name: string): this
    The remote whose default branch is wanted (default `origin`).
  get remoteName(): string
    The remote being asked — the prefix the local ref reports it under.
  override protected subcommandArgs(): string[]
    Assemble either the local ref read or the remote query.

class GitDescribeSettings extends GitSettings
  Settings for `git describe`.

  commitish(rev: string): this
    The commit to describe (positional); defaults to `HEAD`.
  tags(): this
    Consider lightweight tags too, not only annotated ones (`--tags`).
  all(): this
    Consider every ref, not only tags (`--all`).
  always(): this
    Fall back to an abbreviated SHA when no tag matches (`--always`).
  exactMatch(): this
    Fail unless the commit is exactly at a tag (`--exact-match`).
  abbrev(length: number): this
    How many SHA characters to append (`--abbrev=<n>`). `0` suppresses the
    suffix entirely, which is how a build reads the nearest tag's bare name.
  dirty(suffix?: string): this
    Append a marker when the working tree is dirty (`--dirty[=<suffix>]`).
  match(...patterns: string[]): this
    Only consider tags matching this glob (`--match <pattern>`); repeatable.
  override protected subcommandArgs(): string[]
    Assemble the `git describe` argv.

class GitDiffSettings extends GitSettings
  Settings for `git diff`.

  commits(...revs: string[]): this
    The commits to compare (positional); repeatable. One rev diffs the working
    tree against it; two diff them against each other.
  mergeBase(from: string, to: string): this
    Compare the two ends of a range — `from...to` with three dots, which diffs
    `to` against the point the two branches last shared. That is the diff a
    pull request shows, and the one a review or an "affected" check wants,
    since it excludes whatever landed on the base branch meanwhile.
  paths(...values: PathLike[]): this
    Limit the diff to these pathspecs (positional, after `--`); repeatable.
  staged(): this
    Diff the index against `HEAD` rather than the working tree (`--staged`).
  nameOnly(): this
    List the changed paths instead of the patch (`--name-only`).
  nameStatus(): this
    List the changed paths with their status letters (`--name-status`).
  stat(): this
    Summarise the changes per file (`--stat`).
  shortstat(): this
    One summary line for the whole diff (`--shortstat`).
  unified(lines: number): this
    Lines of context around each hunk (`--unified=<n>`).
  ignoreAllSpace(): this
    Ignore whitespace entirely when comparing (`--ignore-all-space`).
  exitCode(): this
    Report differences through the exit code (`--exit-code`): 1 when there are
    any, 0 when there are none. Pair it with `.noThrow()` to branch on
    `output.code` instead of catching.
  diffFilter(letters: string): this
    Keep only files whose change matches these status letters
    (`--diff-filter=<letters>`), e.g. `ACM` for added, copied, and modified —
    how a lint target skips paths the diff only deleted.
  nulTerminated(): this
    Terminate output records with a NUL rather than a newline (`-z`).
  override protected subcommandArgs(): string[]
    Assemble the `git diff` argv.

class GitFetchSettings extends GitSettings
  Settings for `git fetch`.

  remote(name: string): this
    The remote to fetch from.
  refspec(...specs: string[]): this
    Add a refspec to fetch, after the remote — `master`, or
    `master:refs/remotes/origin/master` to also update the remote-tracking ref
    (which is what makes `origin/master` resolvable in a shallow CI checkout
    that never fetched it). Repeatable.

    Prefix the source with `+` to force the update. Pair it with
    {@link depth}: a shallow fetch is not a fast-forward of the history
    already present, and git rejects such an update unless it is forced.
  noTags(): this
    Skip fetching tags (`--no-tags`).
  depth(commits: number): this
    Limit history to this many commits (`--depth`). `1` is enough to diff
    against a base branch and avoids pulling a whole history into a CI job.
  unshallow(): this
    Deepen a shallow clone into the full history (`--unshallow`) — what a
    release target needs before `git describe` or a changelog can see past the
    one commit CI checked out.
  all(): this
    Fetch from all remotes (`--all`).
  tags(): this
    Also fetch tags (`--tags`).
  prune(): this
    Prune deleted remote refs (`--prune`).
  force(): this
    Update refs even when the update is not a fast-forward (`--force`).
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

class GitLogSettings extends GitSettings
  Settings for `git log`.

  revisions(...revs: string[]): this
    Revisions to walk (positional), e.g. `HEAD` or `origin/main`; repeatable.
  range(from: string, to: string): this
    Walk the commits in `from..to` — what is on `to` and not on `from`, the
    range a changelog since the last tag is built from. `to` defaults to
    `HEAD`.
  paths(...values: PathLike[]): this
    Limit the walk to these pathspecs (positional, after `--`); repeatable.
  maxCount(count: number): this
    Stop after this many commits (`--max-count=<n>`).
  skip(count: number): this
    Skip this many commits before reporting any (`--skip=<n>`).
  oneline(): this
    One abbreviated line per commit (`--oneline`).
  format(spec: string): this
    Render each commit through a format string (`--format=<fmt>`), e.g.
    `%H %s`. Given after {@link oneline}, so it wins when both are set.
  since(date: string): this
    Only commits more recent than this date (`--since=<date>`).
  until(date: string): this
    Only commits older than this date (`--until=<date>`).
  author(...patterns: string[]): this
    Only commits whose author matches this pattern (`--author=`); repeatable.
  grep(...patterns: string[]): this
    Only commits whose message matches this pattern (`--grep=`); repeatable.
  noMerges(): this
    Skip merge commits (`--no-merges`).
  firstParent(): this
    Follow only the first parent of a merge (`--first-parent`).
  reverse(): this
    Report oldest first (`--reverse`).
  follow(): this
    Keep following a single file across renames (`--follow`).
  override protected subcommandArgs(): string[]
    Assemble the `git log` argv.

class GitLsFilesSettings extends GitSettings
  Settings for `git ls-files`.

  paths(...values: PathLike[]): this
    Limit the listing to these pathspecs (positional); repeatable.
  cached(): this
    List files in the index (`--cached`), git's default.
  modified(): this
    List files modified in the working tree (`--modified`).
  deleted(): this
    List files deleted from the working tree (`--deleted`).
  others(): this
    List untracked files (`--others`). Pair it with {@link excludeStandard},
    or the listing includes everything `.gitignore` covers.
  ignored(): this
    List ignored files (`--ignored`); only meaningful with {@link others}.
  stage(): this
    Show the mode, object name, and stage of each entry (`--stage`).
  excludeStandard(): this
    Apply the standard ignore rules (`--exclude-standard`).
  directory(): this
    Report an untracked directory once rather than every file in it (`--directory`).
  nulTerminated(): this
    Terminate each entry with a NUL rather than a newline (`-z`).
  override protected subcommandArgs(): string[]
    Assemble the `git ls-files` argv.

class GitLsRemoteSettings extends GitSettings
  Settings for `git ls-remote`.

  remote(nameOrUrl: string): this
    The remote (or URL) to ask; defaults to the branch's upstream.
  patterns(...values: string[]): this
    Limit the listing to refs matching these patterns (positional); repeatable.
  heads(): this
    List branch refs only (`--heads`).
  tags(): this
    List tag refs only (`--tags`).
  refs(): this
    Hide peeled tags and pseudo-refs (`--refs`).
  symref(): this
    Also report what the remote's `HEAD` points at (`--symref`).
  exitCode(): this
    Exit 2 when nothing matched (`--exit-code`).
  override protected subcommandArgs(): string[]
    Assemble the `git ls-remote` argv.

class GitMergeSettings extends GitSequencerSettings
  Settings for `git merge`.

  refs(...values: string[]): this
    The commits to merge into the current branch (positional); repeatable.
  message(text: string): this
    The merge commit's message (`-m`).
  noFf(): this
    Always create a merge commit (`--no-ff`), even when a fast-forward would do.
  ffOnly(): this
    Refuse anything but a fast-forward (`--ff-only`).
  squash(): this
    Stage the merged result without recording a merge (`--squash`).
  noCommit(): this
    Merge but leave the commit to the caller (`--no-commit`).
  strategy(name: string): this
    The merge strategy (`--strategy=<name>`), e.g. `ours`.
  strategyOption(...options: string[]): this
    An option for the strategy (`--strategy-option=<option>`), e.g.
    `theirs` to resolve conflicting hunks in favour of the merged branch;
    repeatable.
  allowUnrelatedHistories(): this
    Merge histories that share no commit (`--allow-unrelated-histories`).
  override protected subcommandArgs(): string[]
    Assemble the `git merge` argv.

class GitMvSettings extends GitSettings
  Settings for `git mv`.

  sources(...values: PathLike[]): this
    The path(s) to move (positional, required); repeatable.
  destination(path: PathLike): this
    Where they move to (required): a file name for a single source, a
    directory when there is more than one.
  force(): this
    Overwrite an existing destination (`-f`/`--force`).
  dryRun(): this
    Report what would move without moving it (`-n`/`--dry-run`).
  override protected subcommandArgs(): string[]
    Assemble the `git mv` argv.

class GitPullSettings extends GitSettings
  Settings for `git pull`.

  remote(name: string): this
    The remote to pull from.
  ref(value: string): this
    The refspec/branch to pull.
  rebase(): this
    Rebase instead of merge (`--rebase`).
  noRebase(): this
    Merge rather than rebase (`--no-rebase`), whatever `pull.rebase` is set to
    in the ambient config — the flag a build reaches for when it must not
    depend on the machine it runs on.
  ffOnly(): this
    Only fast-forward (`--ff-only`).
  depth(commits: number): this
    Limit the fetched history to this many commits (`--depth`).
  tags(): this
    Also fetch tags (`--tags`).
  prune(): this
    Prune deleted remote refs while fetching (`--prune`).
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
  followTags(): this
    Push the annotated tags reachable from the refs being pushed
    (`--follow-tags`) — a release target's tag rides along with its commit
    instead of needing a second push.
  forceWithLease(): this
    Force push, but only if the remote ref is unchanged (`--force-with-lease`).
  deleteRef(): this
    Delete the remote ref (`--delete`).
  atomic(): this
    Update every ref or none (`--atomic`).
  dryRun(): this
    Report what would be pushed without pushing it (`--dry-run`).
  pushOption(...values: string[]): this
    Send a server-side option (`--push-option=<value>`); repeatable. GitLab
    reads these for `ci.skip` and merge-request creation.
  override protected subcommandArgs(): string[]
    Assemble the `git push` argv.

class GitRebaseSettings extends GitSequencerSettings
  Settings for `git rebase`.

  upstream(rev: string): this
    The commit the current branch is replayed onto (positional).
  branch(name: string): this
    Rebase this branch rather than the checked-out one (git's `<branch>`).
  onto(rev: string): this
    Replay onto a different base than the upstream (`--onto <newbase>`).
  autosquash(): this
    Fold `fixup!`/`squash!` commits into their targets (`--autosquash`).
  autostash(): this
    Stash local changes and restore them afterwards (`--autostash`), instead
    of refusing to start on a dirty tree.
  keepEmpty(): this
    Keep commits that produce no changes (`--keep-empty`).
  rebaseMerges(): this
    Recreate merge commits rather than flattening them (`--rebase-merges`).
  strategy(name: string): this
    The merge strategy used to replay each commit (`--strategy=<name>`).
  strategyOption(...options: string[]): this
    An option for that strategy (`--strategy-option=<option>`); repeatable.
  skip(): this
    Drop the current commit and carry on (`--skip`).
  override protected subcommandArgs(): string[]
    Assemble the `git rebase` argv.

class GitRemoteSettings extends GitSettings
  Settings for `git remote`. Pick the subcommand with {@link list},
  {@link add}, {@link remove}, {@link rename}, {@link setUrl},
  {@link getUrl}, {@link show}, or {@link prune}.

  list(): this
    List the configured remotes (`git remote`), the default.
  add(name: string, url: string): this
    Add a remote (`git remote add <name> <url>`).
  remove(name: string): this
    Remove a remote and its tracking refs (`git remote remove <name>`).
  rename(oldName: string, newName: string): this
    Rename a remote (`git remote rename <old> <new>`).
  setUrl(name: string, url: string): this
    Change a remote's URL (`git remote set-url <name> <url>`). Add
    {@link pushUrl} to change only the push URL.
  getUrl(name: string): this
    Print a remote's URL (`git remote get-url <name>`).
  show(name: string): this
    Describe a remote and its branches (`git remote show <name>`).
  prune(name: string): this
    Delete tracking refs the remote no longer has (`git remote prune <name>`).
  verbose(): this
    Show each remote's URLs when listing (`-v`/`--verbose`).
  fetch(): this
    Fetch from the remote right after adding it (`-f`, `add` only).
  track(branch: string): this
    Track only this branch (`-t <branch>`, `add` only).
  pushUrl(): this
    Operate on the push URL (`--push`), for {@link setUrl} and {@link getUrl}.
  override protected subcommandArgs(): string[]
    Assemble the `git remote` argv.

abstract class GitReplaySettings extends GitSequencerSettings
  Shared base for `cherry-pick` and `revert`: the same commit list, the same
  `--no-commit`/`--mainline`, and the same four control flags. Only the
  subcommand's name and the extra flags differ, which is why they are one
  implementation rather than two that drift.

  commits(...revs: string[]): this
    The commits to replay (positional, required); repeatable.
  noCommit(): this
    Apply the change without committing it (`-n`/`--no-commit`).
  mainline(parent: number): this
    Which parent of a merge commit to treat as the mainline
    (`-m <parent-number>`), counting from 1. Replaying a merge needs it: git
    cannot otherwise tell which side of the merge the change is.
  signoff(): this
    Add a `Signed-off-by` trailer (`--signoff`).
  skip(): this
    Drop the current commit and carry on (`--skip`).
  abstract protected replayCommand(): string
    The subcommand token, e.g. `"cherry-pick"`.
  abstract protected taskName(): string
    The `GitTasks` method's name, for the errors this base reports.
  abstract protected replayFlags(): string[]
    The flags this command adds beyond the shared ones.
  override protected subcommandArgs(): string[]
    Assemble the `cherry-pick`/`revert` argv.

class GitResetSettings extends GitSettings
  Settings for `git reset`.

  ref(rev: string): this
    The commit to reset to (positional); defaults to `HEAD`.
  paths(...values: PathLike[]): this
    Reset only these pathspecs — unstaging them (positional); repeatable.
  soft(): this
    Move the branch only, keeping the index and working tree (`--soft`).
  mixed(): this
    Reset the index but not the working tree (`--mixed`), git's default.
  hard(): this
    Reset the index and the working tree (`--hard`), discarding changes.
  merge(): this
    Reset, keeping changes to files that differ between the commits (`--merge`).
  keep(): this
    Like {@link merge}, but refuse when a changed file differs (`--keep`).
  override protected subcommandArgs(): string[]
    Assemble the `git reset` argv.

class GitRestoreSettings extends GitSettings
  Settings for `git restore`.

  paths(...values: PathLike[]): this
    The pathspecs to restore (positional, required); repeatable.
  source(treeish: string): this
    Restore the contents from this commit or tree (`--source=<tree-ish>`)
    rather than from the index.
  staged(): this
    Restore the index (`--staged`) — unstaging the paths. Combine with
    {@link worktree} to reset both, which is what `git restore -SW` does.
  worktree(): this
    Restore the working tree (`--worktree`), git's default when neither is given.
  override protected subcommandArgs(): string[]
    Assemble the `git restore` argv.

class GitRevParseSettings extends GitSettings
  Settings for `git rev-parse`.

  rev(...values: string[]): this
    The revisions or arguments to resolve (positional); repeatable.
  short(length?: number): this
    Abbreviate the SHA (`--short`, or `--short=<n>` with a length). git picks
    a length long enough to stay unambiguous when none is given.
  abbrevRef(): this
    Print the ref's short name (`--abbrev-ref`), e.g. `main` for `HEAD`.
  verify(): this
    Fail rather than echo the argument when it names no object (`--verify`).
  gitDir(): this
    Print the path of the `.git` directory (`--git-dir`).
  showToplevel(): this
    Print the absolute path of the working tree's root (`--show-toplevel`).
  showPrefix(): this
    Print the current directory's path relative to that root (`--show-prefix`).
  isInsideWorkTree(): this
    Print whether this is inside a working tree (`--is-inside-work-tree`).
  override protected subcommandArgs(): string[]
    Assemble the `git rev-parse` argv.

class GitRevertSettings extends GitReplaySettings
  Settings for `git revert`.

  noEdit(): this
    Take the generated message without opening an editor (`--no-edit`).
  override protected replayCommand(): string
    The `revert` subcommand token.
  override protected taskName(): string
    The `GitTasks` method that runs it.
  override protected replayFlags(): string[]
    `revert`'s own flags.

class GitRmSettings extends GitSettings
  Settings for `git rm`.

  paths(...values: PathLike[]): this
    Paths/pathspecs to remove (positional, required); repeatable.
  cached(): this
    Remove from the index only, leaving the file on disk (`--cached`) — how a
    file committed by mistake stops being tracked without being deleted.
  recursive(): this
    Recurse into directories (`-r`).
  force(): this
    Remove even when the file has staged or local changes (`-f`/`--force`).
  dryRun(): this
    Report what would be removed without removing it (`-n`/`--dry-run`).
  ignoreUnmatch(): this
    Exit 0 when no path matches (`--ignore-unmatch`).
  override protected subcommandArgs(): string[]
    Assemble the `git rm` argv.

class GitRunSettings extends GitSettings
  Settings for an arbitrary `git` command not covered by a typed task.

  command(...parts: Array<string | number>): this
    The subcommand and its arguments, e.g. `command("bisect", "start")`.
  override protected subcommandArgs(): string[]
    Assemble the arbitrary `git` subcommand argv from `.command(...)`.

abstract class GitSequencerSettings extends GitSettings
  Base for the commands that can be left in progress by a conflict. Subclasses
  expose only the actions their command accepts — `merge` has no `--skip` —
  and call {@link GitSequencerSettings.sequencer_} to record one.

  continue(): this
    Resume the operation once the conflict is resolved (`--continue`).
  abort(): this
    Undo it and restore the pre-operation state (`--abort`).
  quit(): this
    Forget the operation, leaving the tree as it is (`--quit`).
  protected sequencer_(action: SequencerAction): this
    Record a control action. Subclasses use it to offer the ones their command
    accepts — `skip` exists only on `rebase`, `cherry-pick`, and `revert`.
  protected sequencerArgs(): string[]
    The chosen control flag, or an empty argv when the command is a fresh one.
  protected get controlling(): boolean
    Whether a control action was chosen. Every other flag and positional is
    then invalid: git takes `--continue` and friends alone.
  protected controlArgs_(task: string, command: string, options: string[]): string[]
    The argv for a control action, given everything else the lambda set.
    `options` is what the command would have run without one; a control flag
    takes none of it, so anything there is refused by name rather than
    silently dropped — which is the failure git itself reports as a bare
    usage dump.

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

class GitShowSettings extends GitSettings
  Settings for `git show`.

  object(...names: string[]): this
    The objects to show (positional); repeatable. A commit, a tag, or a blob
    at a revision such as `HEAD:deno.json` — the way a build reads a file as
    it was, without checking anything out.
  paths(...values: PathLike[]): this
    Limit the output to these pathspecs (positional, after `--`); repeatable.
  format(spec: string): this
    Render the commit header through a format string (`--format=<fmt>`).
  noPatch(): this
    Suppress the diff (`--no-patch`), leaving only the header.
  nameOnly(): this
    List the changed paths instead of the diff (`--name-only`).
  nameStatus(): this
    List the changed paths with their status letters (`--name-status`).
  stat(): this
    Summarise the changes (`--stat`).
  override protected subcommandArgs(): string[]
    Assemble the `git show` argv.

class GitStashSettings extends GitSettings
  Settings for `git stash`. Pick the subcommand with {@link push},
  {@link pop}, {@link apply}, {@link list}, {@link show}, {@link drop}, or
  {@link clear}; the remaining methods apply to the one picked.

  push(): this
    Stash the working tree and index (`git stash push`).
  pop(): this
    Restore a stash and drop it (`git stash pop`).
  apply(): this
    Restore a stash and keep it (`git stash apply`).
  list(): this
    List the stashes (`git stash list`).
  show(): this
    Show a stash's diff (`git stash show`).
  drop(): this
    Discard a stash (`git stash drop`).
  clear(): this
    Discard every stash (`git stash clear`).
  stash(ref: string): this
    Which stash to act on, e.g. `stash@{1}` (positional); defaults to the most
    recent. Only meaningful for {@link pop}, {@link apply}, {@link show}, and
    {@link drop}.
  message(text: string): this
    Label the stash being pushed (`-m`).
  includeUntracked(): this
    Stash untracked files too (`--include-untracked`).
  keepIndex(): this
    Leave what is already staged in the index (`--keep-index`).
  staged(): this
    Stash only what is staged (`--staged`).
  paths(...values: PathLike[]): this
    Stash only these pathspecs (positional, after `--`); repeatable.
  override protected subcommandArgs(): string[]
    Assemble the `git stash` argv.

class GitStatusSettings extends GitSettings
  Settings for `git status`.

  short(): this
    Short-format output (`-s`/`--short`).
  porcelain(): this
    Stable machine-readable output (`--porcelain`).
  branch(): this
    Show branch information (`-b`/`--branch`).
  nulTerminated(): this
    Terminate each record with a NUL rather than a newline (`-z`), which also
    turns on `--porcelain` and stops git quoting unusual paths.
  untrackedFiles(mode: "no" | "normal" | "all"): this
    How much of an untracked directory to report (`--untracked-files=<mode>`):
    `no`, `normal` (the default — the directory), or `all` (every file in it).
  ignored(): this
    Also report ignored files (`--ignored`).
  paths(...values: string[]): this
    Limit the report to these pathspecs (positional); repeatable.
  override protected subcommandArgs(): string[]
    Assemble the `git status` argv.

class GitSubmoduleSettings extends GitSettings
  Settings for `git submodule`. Pick the subcommand with {@link add},
  {@link init}, {@link deinit}, {@link update}, {@link sync}, {@link status},
  or {@link foreach}.

  add(url: string, path?: PathLike): this
    Add a submodule (`git submodule add <url> [<path>]`).
  init(): this
    Register the submodules in `.gitmodules` (`git submodule init`).
  deinit(): this
    Unregister submodules (`git submodule deinit`).
  update(): this
    Check the submodules out at their recorded commits (`git submodule update`).
  sync(): this
    Copy the configured URLs into `.git/config` (`git submodule sync`).
  status(): this
    Report each submodule's checked-out commit (`git submodule status`).
  foreach(...command: string[]): this
    Run a command in each submodule (`git submodule foreach <command>`).
  paths(...values: PathLike[]): this
    Limit the operation to these paths (positional); repeatable.
  withInit(): this
    Initialise uninitialised submodules first (`--init`), the flag
    {@link update} needs on a fresh clone. Named for the flag rather than the
    `init` subcommand, which is what {@link init} runs.
  recursive(): this
    Recurse into nested submodules (`--recursive`).
  remote(): this
    Use the upstream branch's latest commit rather than the recorded one (`--remote`).
  force(): this
    Discard local changes in the submodule (`--force`).
  depth(commits: number): this
    Clone the submodules shallowly (`--depth <n>`).
  jobs(count: number): this
    Clone this many submodules in parallel (`--jobs <n>`).
  branch(name: string): this
    Track this branch when adding or updating (`-b <branch>`).
  override protected subcommandArgs(): string[]
    Assemble the `git submodule` argv.

class GitSwitchSettings extends GitSettings
  Settings for `git switch`.

  branch(name: string): this
    The branch to switch to — or, with {@link create}, the one to create.
  startPoint(rev: string): this
    The commit the new branch forks from (git's trailing `<start-point>`),
    e.g. `origin/main`. Without it a created branch forks from the current
    `HEAD`, which is whatever the checkout happened to be on.
  create(): this
    Create the branch (`-c`); fails if it already exists.
  forceCreate(): this
    Create the branch, resetting it if it exists (`-C`).
  track(mode: "direct" | "inherit"): this
    Set up upstream tracking (`--track=<mode>`), `direct` or `inherit`.
  detach(): this
    Switch with a detached `HEAD` (`--detach`) — checking out a commit rather
    than a branch, which `switch` otherwise refuses.
  force(): this
    Throw away local changes rather than refusing to switch (`--force`).
  override protected subcommandArgs(): string[]
    Assemble the `git switch` argv.

class GitTagSettings extends GitSettings
  Settings for `git tag`.

  name(value: string): this
    The tag name.
  commit(rev: string): this
    The commit to tag (git's trailing `<commit>`), rather than `HEAD`. Only
    meaningful when creating a tag.
  message(text: string): this
    Create an annotated tag with this message (`-a -m`).
  force(): this
    Replace an existing tag (`-f`/`--force`).
  deleteTag(): this
    Delete the tag (`-d`/`--delete`).
  list(pattern?: string): this
    List tags (`-l`), optionally matching a shell pattern such as `v1.*`.
    With no pattern, lists them all.
  sort(key: string): this
    Order a listing (`--sort=<key>`), e.g. `-v:refname` for newest-version
    first — the ordering a release target wants, since the default is
    lexicographic and puts `v1.10.0` before `v1.9.0`.
  override protected subcommandArgs(): string[]
    Assemble the `git tag` argv.

class GitWorktreeSettings extends GitSettings
  Settings for `git worktree`. Pick the subcommand with {@link add},
  {@link list}, {@link remove}, or {@link prune}; the remaining methods apply
  to the one picked, mirroring the flags git accepts for it.

  add(path: PathLike): this
    Check a new worktree out at `path` (`git worktree add <path>`).
  list(): this
    List the repository's worktrees (`git worktree list`).
  remove(path: PathLike): this
    Remove the worktree at `path` (`git worktree remove <path>`).
  prune(): this
    Discard records of worktrees whose directories are gone (`git worktree prune`).
  branch(name: string): this
    The branch to check out in the new worktree — or, with
    {@link createBranch}, the name of the branch to create there.
  createBranch(): this
    Create {@link branch} rather than checking out an existing one (`-b`).
  startPoint(ref: string): this
    The commit the new branch forks from — git's trailing `<commit-ish>`, e.g.
    `origin/main`. Only meaningful with {@link createBranch}: without a start
    point git branches from the parent checkout's `HEAD`, which is whatever
    the developer happened to have open.

    Setting this and {@link branch} without {@link createBranch} is refused:
    both want the same trailing position, and there is no reading of the
    command where git would take them both.
  detach(): this
    Check out with a detached `HEAD` (`--detach`).
  force(): this
    Force the operation (`--force`): check out a branch already checked out
    elsewhere, or remove a worktree with modifications. Without it git refuses
    both.
  porcelain(): this
    Emit the stable machine-readable listing (`--porcelain`).
  override protected subcommandArgs(): string[]
    Assemble the `git worktree` argv.

interface GitCommitEntry
  One commit of {@link "./git.ts".GitTasks.logEntries}.

  commit: string
    The full commit SHA (`%H`).
  shortCommit: string
    The abbreviated commit SHA (`%h`).
  parents: string[]
    The parent SHAs (`%P`); two or more mean a merge, none the root commit.
  authorName: string
    The author's name (`%an`).
  authorEmail: string
    The author's email (`%ae`).
  authoredAt: string
    When the commit was authored, ISO 8601 (`%aI`).
  committedAt: string
    When the commit was committed, ISO 8601 (`%cI`).
  subject: string
    The first line of the message (`%s`).
  body: string
    The rest of the message (`%B` after the subject), trailing newlines trimmed.

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

interface GitRemote
  One remote of `git remote --verbose`, with both of its URLs folded in.

  name: string
    The remote's name, e.g. `origin`.
  fetchUrl?: string
    Where fetches read from, when the listing reported one.
  pushUrl?: string
    Where pushes write to, when the listing reported one.

interface GitStatusEntry
  One record of `git status --porcelain -z`: a path and how it changed.

  index: string
    The index (staged) status code — git's `X` column: `M` modified, `A`
    added, `D` deleted, `R` renamed, `C` copied, `?` untracked, `!` ignored,
    or a space when the index matches `HEAD`.
  workingTree: string
    The working-tree status code — git's `Y` column, with the same letters,
    or a space when the working tree matches the index.
  path: string
    The path, relative to the repository root; for a rename, the new one.
  originalPath?: string
    Where a renamed or copied entry came from; absent otherwise.

interface GitTasksApi
  The shape of {@link GitTasks}.

  init(configure?: Configure<GitInitSettings>): Promise<CommandOutput>
    Create a repository: `git init`.
  clone(configure?: Configure<GitCloneSettings>): Promise<CommandOutput>
    Clone a repository: `git clone`.
  add(configure?: Configure<GitAddSettings>): Promise<CommandOutput>
    Stage changes: `git add`.
  rm(configure?: Configure<GitRmSettings>): Promise<CommandOutput>
    Remove tracked files: `git rm`.
  mv(configure?: Configure<GitMvSettings>): Promise<CommandOutput>
    Move or rename a tracked file: `git mv`.
  restore(configure?: Configure<GitRestoreSettings>): Promise<CommandOutput>
    Restore working-tree or index contents: `git restore`.
  clean(configure?: Configure<GitCleanSettings>): Promise<CommandOutput>
    Delete untracked files: `git clean`.
  commit(configure?: Configure<GitCommitSettings>): Promise<CommandOutput>
    Record changes: `git commit`.
  status(configure?: Configure<GitStatusSettings>): Promise<CommandOutput>
    Show working-tree status: `git status`.
  statusEntries(configure?: Configure<GitStatusSettings>): Promise<GitStatusEntry[]>
    The working tree's changes as parsed {@link GitStatusEntry} values, from
    `git status --porcelain -z` — the form no path can corrupt. An empty array
    means a clean tree.

    The lambda configures the rest (`.dir()`, `.untrackedFiles()`, `.paths()`);
    the output format is fixed, since the parse depends on it.
  checkout(configure?: Configure<GitCheckoutSettings>): Promise<CommandOutput>
    Switch branches or restore files: `git checkout`.
  switch(configure?: Configure<GitSwitchSettings>): Promise<CommandOutput>
    Switch branches: `git switch`, `checkout`'s modern half.
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
  remote(configure?: Configure<GitRemoteSettings>): Promise<CommandOutput>
    Manage remotes: `git remote add|remove|rename|set-url|get-url|show|prune`.
  remoteList(configure?: Configure<GitRemoteSettings>): Promise<GitRemote[]>
    The configured remotes as parsed {@link GitRemote} entries, each with the
    fetch and push URL folded together, from `git remote --verbose`.
  lsRemote(configure?: Configure<GitLsRemoteSettings>): Promise<CommandOutput>
    List a remote's refs without fetching them: `git ls-remote`.
  log(configure?: Configure<GitLogSettings>): Promise<CommandOutput>
    Show history: `git log`.
  logEntries(configure?: Configure<GitLogSettings>): Promise<GitCommitEntry[]>
    History as parsed {@link GitCommitEntry} values — SHA, parents, author,
    dates, subject, and body — for building a changelog or deciding what a
    range contains.

    The lambda configures the walk (`.range()`, `.maxCount()`, `.paths()`);
    the `--format` is fixed, since the parse depends on it.
  show(configure?: Configure<GitShowSettings>): Promise<CommandOutput>
    Show an object: `git show`.
  diff(configure?: Configure<GitDiffSettings>): Promise<CommandOutput>
    Show changes: `git diff`.
  diffNames(configure?: Configure<GitDiffSettings>): Promise<string[]>
    The changed paths of a diff, from `git diff --name-only -z`. What a target
    needs to decide whether the work it guards has to run at all.
  lsFiles(configure?: Configure<GitLsFilesSettings>): Promise<CommandOutput>
    List index and working-tree files: `git ls-files`.
  lsFileNames(configure?: Configure<GitLsFilesSettings>): Promise<string[]>
    The paths of a `git ls-files -z` listing — git's own file list, ignore
    rules already applied.
  revParse(configure?: Configure<GitRevParseSettings>): Promise<CommandOutput>
    Resolve revisions and repository paths: `git rev-parse`.
  revision(configure?: Configure<GitRevParseSettings>): Promise<string>
    A `git rev-parse` result as a trimmed string — the commit SHA, ref name,
    or path a version stamp or cache key is built from.
  describe(configure?: Configure<GitDescribeSettings>): Promise<CommandOutput>
    Name a commit after the nearest tag: `git describe`.
  merge(configure?: Configure<GitMergeSettings>): Promise<CommandOutput>
    Join two histories: `git merge`.
  rebase(configure?: Configure<GitRebaseSettings>): Promise<CommandOutput>
    Replay commits onto another base: `git rebase`.
  cherryPick(configure?: Configure<GitCherryPickSettings>): Promise<CommandOutput>
    Apply existing commits here: `git cherry-pick`.
  revert(configure?: Configure<GitRevertSettings>): Promise<CommandOutput>
    Undo commits with new ones: `git revert`.
  reset(configure?: Configure<GitResetSettings>): Promise<CommandOutput>
    Move the branch, index, and optionally the working tree: `git reset`.
  stash(configure?: Configure<GitStashSettings>): Promise<CommandOutput>
    Park and restore uncommitted work: `git stash`.
  config(configure?: Configure<GitConfigSettings>): Promise<CommandOutput>
    Read or write configuration: `git config`.
  configGet(configure?: Configure<GitConfigSettings>): Promise<string | undefined>
    One configuration value, or `undefined` when the key is unset — which
    `git config --get` reports as a non-zero exit rather than as empty output.
    The lambda must pick the key with `.get(...)` or `.getAll(...)`.
  submodule(configure?: Configure<GitSubmoduleSettings>): Promise<CommandOutput>
    Manage submodules: `git submodule add|init|update|sync|status|foreach`.
  archive(configure?: Configure<GitArchiveSettings>): Promise<CommandOutput>
    Package a tree as a tarball or zip: `git archive`.
  apply(configure?: Configure<GitApplySettings>): Promise<CommandOutput>
    Apply a patch file: `git apply`.
  worktree(configure?: Configure<GitWorktreeSettings>): Promise<CommandOutput>
    Manage worktrees: `git worktree add|list|remove|prune`. Pick the
    subcommand in the lambda — `s.add(path)`, `s.list()`, `s.remove(path)`, or
    `s.prune()`. For a listing to read rather than print, use
    {@link GitTasksApi.worktreeList}.
  worktreeList(configure?: Configure<GitWorktreeSettings>): Promise<GitWorktree[]>
    List the repository's worktrees as parsed {@link GitWorktree} entries,
    from `git worktree list --porcelain`.

    The lambda configures the global options (`.dir()`, `.config()`); the
    subcommand itself is fixed, since the parse depends on it.
  defaultBranch(configure?: Configure<GitDefaultBranchSettings>): Promise<string>
    The name of a remote's default branch — `main`, `master`, or whatever it
    chose — so a build does not have to hardcode one.

    Reads the local `refs/remotes/<remote>/HEAD` first, which costs no network,
    and asks the remote itself when that ref was never populated. Fails when
    neither names a branch, rather than guessing.
  run(configure?: Configure<GitRunSettings>): Promise<CommandOutput>
    Run any other git command via `.command(...)`.

interface GitWorktree
  One entry of `git worktree list --porcelain`.

  path: string
    The worktree's absolute path, as git reports it.
  head?: string
    The commit checked out there, or `undefined` for a bare repository.
  branch?: string
    The checked-out branch, without its `refs/heads/` prefix; absent when detached.
  bare: boolean
    Whether this entry is the bare repository rather than a working tree.
  detached: boolean
    Whether `HEAD` is detached there.
  locked: boolean
    Whether the worktree is locked (`git worktree lock`).

type GitRunner = (args: string[]) => Promise<string | null>
  Runs a `git` subcommand and resolves to its trimmed stdout, or `null` when
  the command fails (non-zero exit, or `git` unavailable).

type SequencerAction = "continue" | "abort" | "skip" | "quit"
  What to do with an operation git left in progress.
````

</details>

<!-- ZUKE:API:END -->

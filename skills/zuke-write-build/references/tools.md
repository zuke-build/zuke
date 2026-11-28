# Tool wrappers and provisioning

The settings-lambda style, provisioning tools, and the Node, git, GitHub and
Deno wrappers.

> Confirm exact signatures against the version the project has installed: on
> Node, `node_modules/@zuke/<package>/README.md` (its `## API` section) and the
> `.d.ts` files; on Deno, `deno doc jsr:@zuke/<package>`. For breadth, use
> `llms-full.txt`
> (<https://raw.githubusercontent.com/zuke-build/zuke/master/llms-full.txt>,
> which tracks `master`). This file is a summary, not the source of truth.

## In brief

- **Provisioning tools:** `ToolTasks.install((s) => …)` / `toolchain((t) => …)`
  fetch pinned, checksum-verified release binaries so a build is hermetic, and
  `t.npm({ name, version, bin? })` / `ToolTasks.npm(...)` provision a
  version-pinned, cached npm-registry package (needs `npm` on `PATH`); hand the
  returned path to a wrapper's `.toolPath(...)`. In a Node monorepo, resolve a
  wrapper's binary from `node_modules/.bin` npx-style instead —
  `.fromNodeModules()` on the settings (or `ZUKE_TOOL_RESOLUTION=node_modules`
  repo-wide) walks up for the local shim and falls back to PATH; `.fromPath()`
  forces PATH and an explicit `.toolPath(...)` always wins. Detail below, or
  [`docs/tools.md`](https://github.com/zuke-build/zuke/blob/master/docs/tools.md).
- **Deno Deploy (`@zuke/deno`, until the service closes, about April 2027):**
  `DenoDeployTasks.deploy((s) =>
  s.token(t).org(o).app(a).prod().json().nonInteractive())`; `create`, the
  `env*` tasks (`envAdd((s) => s.variable("K").secretValue(v))`), `logs`
  (`.once()`), `deploymentsList`, `appsGet`, `whoami`. The token goes in
  `DENO_DEPLOY_TOKEN`, never the argv. Detail below.
- **Flutter apps (`@zuke/flutter`):** `FlutterTasks.pubGet()`, `.analyze()`,
  `.test((s) => s.coverage())`, and one task per artifact — `buildAppBundle((s)
  => s.release().flavor("prod").buildNumber(n))`, `buildIpa`, `buildWeb`,
  `buildApk`, the desktop builds — plus the `pub*`, `drive`, `install`, `doctor`
  and `config` commands. Detail below.
- **Dart packages and CLIs (`@zuke/dart`):** `DartTasks.pubGet()`, `.analyze((s)
  => s.fatalInfos())`, `.format((s) => s.setExitIfChanged().output("none"))`,
  `.fix()`, `.test((s) => s.coverage("coverage").reporter("github"))`, `.run()`,
  and one task per compile target — `compileExe((s) => s.entry("bin/main.dart")
  .output("build/app"))`, `compileJs`, `compileWasm`, `compileAotSnapshot`,
  `compileJitSnapshot`, `compileKernel` — plus `doc`, `create`, the `pub*`
  commands, `info` and `version`. Detail below.

## Provisioning tools — hermetic builds

Fetch pinned, checksum-verified tool binaries from the build itself instead of
assuming they're installed. Both return the installed binary's `AbsolutePath`;
hand it to a wrapper's `.toolPath(...)`, to `CmdTasks`, or to `defineTool`
(`@zuke/core/tooling` — the submodule, not the package root).

```ts
import { toolchain, ToolTasks } from "@zuke/core";

// One release binary:
bin = target().executes(async () =>
  await ToolTasks.install((s) =>
    s.name("shellcheck").url(shellcheckUrl).checksum(shellcheckSum)
  )
);

// Many at once — release binaries via .tool(), npm packages via .npm():
tools = toolchain((t) =>
  t.tool((s) => s.name("helm").url(helmUrl))
    .npm({ name: "vitest", version: "4.1.9" })
);
// install() returns Map<name, AbsolutePath>; npm packages need `npm` on PATH.
```

`.archive("tar.gz")`, `.archive("tar.xz")` or `.archive("zip")` unpacks an
archive and copies `.binaryPath(...)` (default the name) out — the xz decoder is
built in (for `.tar.xz`-only releases such as the Flutter SDK and Zig), zip
reading covers the `stored`/`deflate` methods release assets use, rejects
encrypted/zip64 archives, and every format blocks zip-slip. `.checksum(sha256)`
verifies (the archive's SHA-256 for an archive, the binary's for `"raw"`) and
doubles as the install cache key.

**Multi-file runtimes (Node.js, a JDK, …)** — `ToolTasks.installTree((s) => …)`
(or `toolchain().tree((s) => …)`) keeps the _whole_ extracted tree instead of
one binary, for a runtime that ships several bins plus `lib/`. `.strip(1)`
unwraps the `tool-v1.2.3/` top directory, `.bins("bin/node", "bin/npm")` marks
executables (symlinks preserved). It returns the tree root as a callable
`AbsolutePath`, so `root("bin", "node")` is a binary and `root("bin")` the
directory to put on PATH:

```ts
import { prependPath, ToolTasks } from "@zuke/core";

const node = await ToolTasks.installTree((s) =>
  s.name("node").archive("tar.gz").strip(1).bins("bin/node", "bin/npm")
    .url(nodeUrl).checksum(nodeSum)
);
prependPath(node("bin")); // node/npm (and node_modules/.bin shims) now on PATH
```

`prependPath(dir)` puts `dir` first on the process `PATH` (idempotent, platform
separator) so every subprocess Zuke spawns — the shell `$`, `Command`, and the
tool wrappers, which inherit the process environment — finds the provisioned
tool.

**Resolve from `node_modules/.bin`** — in a Node monorepo where tool binaries
are hoisted to the repo root, a wrapper can find its binary npx-style instead of
needing a `.toolPath(...)`. `.fromNodeModules()` on any settings object walks up
from the working directory for `node_modules/.bin/<tool>` (the `.cmd`/`.bat`
shims on Windows, spawned as themselves) and falls back to `PATH` on a miss;
`.fromPath()` forces `PATH`; and `ZUKE_TOOL_RESOLUTION=node_modules|path` flips
every wrapper repo-wide without touching call sites (a per-call setting wins
over it). An explicit `.toolPath(...)` always wins, so a `toolchain()` pin stays
hermetic. `resolvedArgv()` shows what a run will spawn. See
[`docs/tools.md`](https://github.com/zuke-build/zuke/blob/master/docs/tools.md).

## Tool wrappers — the settings-lambda style

```ts
await DenoTasks.test((s) => s.allowAll().coverage("cov_profile"));
await DenoTasks.test((s) =>
  s.allowAll().reporter("junit").junitPath("report.xml").traceLeaks()
);
await DenoTasks.fmt((s) => s.check().paths("mod.ts"));
await DenoTasks.lint((s) => s.json().rulesExclude("no-explicit-any"));
await CmdTasks.exec("my-tool", (s) => s.args("--flag", "value")); // no wrapper in the catalogue? last resort: cmd

// Wrong — @zuke/docker has a typed wrapper, so this discards typed flags,
// argv purity, and tool resolution:
await CmdTasks.exec("docker", (s) => s.args("build", "-t", "app", "."));
// Right — check the catalogue, find @zuke/docker, use it:
await DockerTasks.build((s) => s.tag("app").context("."));
```

### Reading a value out of a Node module — `NodeTasks.evaluate`

Some builds need a **value** from the Node side of the project rather than an
exit code: an OpenAPI document produced by booting the app, a resolved config.
`NodeTasks.evaluate(module, (s) => …)` imports the module in Node, awaits one
export — calling it when it is a function — and resolves to its JSON value, so
the target keeps the result instead of a script having to write it somewhere.

```ts
// tools/openapi.mjs — the consumer's own module: export default async () => document
const spec = await NodeTasks.evaluate("tools/openapi.mjs");
await FileTasks.writeText("openapi.json", JSON.stringify(spec, null, 2));

// A named export, called with arguments:
const config = await NodeTasks.evaluate(
  "dist/config.js",
  (s) => s.export("resolveConfig").callWith("production"),
);
```

`module` is a **path** resolved against the working directory (`.cwd()` moves
it); the module resolves its own imports from the surrounding `node_modules`, so
this is how a build reaches framework code (NestJS, TypeORM) it must not depend
on itself. The value crosses the process boundary as JSON, so it — and each
`callWith` argument — must be JSON-serialisable.

**A module that never exits** — one that boots an app and leaves a server, a
pool, or a timer on the event loop — would otherwise block the evaluation on a
value it has already produced. `.exitAfterResult()` ends the Node process once
the result has been written:

```ts
const spec = await NodeTasks.evaluate(
  "tools/openapi.mjs",
  (s) => s.export("buildDocument").exitAfterResult(),
);
```

What the module would do after handing back its value does not happen: output is
cut off, a `beforeExit` handler or a not-yet-awaited teardown never runs, and
its exit code is no longer observed. Use it for a module whose value is the
point of running it; keep the default for one whose after-the-value work matters
(writing a file, committing a transaction, failing through an exit code). A
module that throws before producing a result still fails the target, and one
that exits on its own is unaffected.

### git — `GitTasks`

`GitTasks` wraps the everyday git surface, so a build never shells out for it:

| Area                 | Tasks                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start a working area | `init`, `clone`, `worktree`                                                                                                                             |
| Working tree & index | `add`, `rm`, `mv`, `restore`, `clean`, `reset`, `stash`, `commit`                                                                                       |
| Branches & tags      | `branch`, `checkout`, `switch`, `tag`                                                                                                                   |
| Inspect              | `status`, `log`, `show`, `diff`, `lsFiles`, `revParse`, `describe`                                                                                      |
| Interrogate          | `mergeBase`, `revList`, `forEachRef`, `showRef`, `symbolicRef`, `nameRev`, `lsTree`, `catFile`, `checkIgnore`, `blame`, `shortlog`, `grep`, `mergeTree` |
| Integrate            | `merge`, `rebase`, `cherryPick`, `revert`, `apply`                                                                                                      |
| Collaborate          | `push`, `pull`, `fetch`, `remote`, `lsRemote`, `submodule`                                                                                              |
| Signatures           | `verifyCommit`, `verifyTag`                                                                                                                             |
| Everything else      | `config`, `archive`, `run`                                                                                                                              |

`run` (`s.command("bisect", "start")`) is for the long tail only — reaching for
it, or for `CmdTasks.exec`, when a typed task exists discards the flags and the
validation.

A handful of tasks hand back **values** rather than `CommandOutput`, so a target
reads git's answer instead of scraping stdout:

```ts
const changed = await GitTasks.diffNames((s) => s.mergeBase("origin/main")); // string[]
const commits = await GitTasks.logEntries((s) => s.range("v1.2.0")); // subject, body, author, dates
const dirty = await GitTasks.statusEntries(); // [] means a clean tree
const files = await GitTasks.lsFileNames((s) => s.others().excludeStandard());
const remotes = await GitTasks.remoteList(); // { name, fetchUrl, pushUrl }[]
const sha = await GitTasks.revision((s) => s.short().rev("HEAD"));
const url = await GitTasks.configGet((s) => s.get("remote.origin.url")); // undefined when unset
```

They pin the machine-readable form (`-z`, a separator-based `--format`), so a
path with a space in it or a multi-line commit message parses correctly.

To assert that a generated file is tracked — which a drift check has to do
before it diffs, since `git diff` reports nothing at all about an untracked file
— either read the listing and check it is non-empty, or let git decide the exit
code with `lsFiles` and `.errorUnmatch()`, which needs `.paths(...)` to have
anything to assert about.

The interrogation commands add the answers CI asks for most — a base ref, a
commit count, whether one ref is contained in another:

```ts
const base = await GitTasks.mergeBase((s) => s.commits("HEAD", "origin/main"));
const build = await GitTasks.commitCount((s) => s.commits("HEAD")); // number
const shipped = await GitTasks.isAncestor((s) => s.commits("v1.2.0", "HEAD"));
const tags = await GitTasks.refs((s) =>
  s.patterns("refs/tags/").sort("-creatordate")
);
const ignored = await GitTasks.isIgnored((s) => s.paths("cov_profile"));
const manifest = await GitTasks.blobText((s) => s.object("v1.2.0:deno.json"));
const authors = await GitTasks.shortlogEntries((s) =>
  s.email().commits("v1.2.0..HEAD")
);
const clean = await GitTasks.mergesCleanly((s) =>
  s.branches("HEAD", "origin/main")
);
```

`isAncestor`, `isIgnored`, `mergesCleanly` and `isSignatureValid` answer from

- The org id and token default to `SIGNPATH_ORGANIZATION_ID` /
  `SIGNPATH_API_TOKEN`; ids must be GUIDs; API and connector URLs must be
  `https:`. Every error is scrubbed of the API and GitHub tokens — still declare
  the token `parameter(...).secret()`.
- The download goes to exactly `.output(path)` (never the server's file name),
  via a temp sibling renamed on success; redirects to storage drop the token.
- SignPath calls are HTTP, not commands: never mark a signing target
  `.dryRunnable()`, or `--dry-run` really submits. `signtool` is rarely on
  `PATH` — set `.toolPath(...)` to the Windows SDK's `signtool.exe`.

### Worktrees — `GitTasks.worktree`

A second working tree lets one repository have several branches checked out at
once. `GitTasks.worktree` picks the subcommand in the lambda; `worktreeList`
runs `git worktree list --porcelain` and hands back parsed entries, so a target
reads them as values instead of scraping stdout.

```ts
await GitTasks.worktree((s) =>
  s.add(path).branch(name).createBranch()
    .startPoint("origin/main")
); // where the new branch forks from
await GitTasks.worktree((s) => s.add(path).branch("release/1.2")); // existing branch
const trees = await GitTasks.worktreeList(); // { path, head, branch, bare, detached, locked }[]
await GitTasks.worktree((s) => s.remove(path).force()); // git refuses a dirty tree without it
await GitTasks.worktree((s) => s.prune()); // forget trees whose directories are gone
```

Reach for `.dir(repo)` when the build's own cwd is not the repository, as with
every other git task.

`GitTasks.defaultBranch((s) => s.remote("origin"))` returns what the remote
calls its default branch, so a build never hardcodes `main` and breaks on the
repositories that chose `master`. It reads the local
`refs/remotes/<remote>/HEAD` first and asks the remote only when that ref is
missing, which is the usual case on a fetch-only checkout.

### GitHub CLI — `GhTasks`

The three groups a build reaches for are typed; everything else goes through
`GhTasks.run((s) => s.command(...))`, and REST endpoints with no CLI verb
through `GhTasks.api(...)`. `GhTasks.appToken` mints a GitHub App installation
token, and `GhTasks.appTokenSource((s) => s.app(this.appId, this.appKey))` is
the lazy, memoised form a build hands to whatever posts for it — repository from
`GITHUB_REPOSITORY`, the App's own grant, `GITHUB_TOKEN` as the fallback when
the App is not configured. The REST-only operations are typed too:
`GhTasks.react((s) => s.issue(12).content("eyes"))` (also `.issueComment(id)` /
`.reviewComment(id)`), `listReactions`, `deleteReaction`, and
`GhTasks.collaboratorPermission((s) => s.login("mona"))` for a commenter's role
— reach for these before `GhTasks.api(...)`.

| Group     | Tasks                                                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `pr`      | `prCreate`, `prList`, `prListEntries`, `prView`, `prChecks`, `prMerge`, `prComment`, `prEdit`, `prClose`                                |
| `issue`   | `issueCreate`, `issueList`, `issueListEntries`, `issueView`, `issueComment`, `issueClose`                                               |
| `release` | `releaseCreate`, `releaseList`, `releaseListEntries`, `releaseView`, `releaseUpload`, `releaseDownload`, `releaseEdit`, `releaseDelete` |

| Group      | Tasks                                                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run`      | `runList`, `runListEntries`, `runView`, `runRerun`, `runCancel`, `runDelete`, `runDownload`, `runWatch`                                                               |
| `workflow` | `workflowList`, `workflowListEntries`, `workflowView`, `workflowRun`, `workflowEnable`, `workflowDisable`                                                             |
| `repo`     | `repoClone`, `repoCreate`, `repoView`, `repoList`, `repoListEntries`, `repoFork`, `repoSync`, `repoEdit`, `repoRename`, `repoArchive`, `repoDelete`, `repoSetDefault` |
| `secret`   | `secretSet`, `secretList`, `secretListEntries`, `secretDelete`                                                                                                        |
| `variable` | `variableSet`, `variableGet`, `variableValue`, `variableList`, `variableListEntries`, `variableDelete`                                                                |
| `label`    | `labelList`, `labelListEntries`, `labelCreate`, `labelEdit`, `labelDelete`, `labelClone`                                                                              |
| `cache`    | `cacheList`, `cacheListEntries`, `cacheDelete`                                                                                                                        |

```ts
await GhTasks.prMerge((s) => s.selector(123).squash().deleteBranch().auto());
await GhTasks.issueClose((s) => s.selector(42).reason("completed"));
await GhTasks.releaseCreate((s) => s.tag("v1.2.3").generateNotes().latest());
const open = await GhTasks.prListEntries((s) => s.state("open").limit(50));

// The Actions half — what a release build reads for control flow
const failed = await GhTasks.runListEntries((s) =>
  s.status("failure").limit(20)
);
await GhTasks.runRerun((s) => s.selector(failed[0].databaseId ?? 0).failed());
await GhTasks.workflowRun((s) => s.workflow("e2e.yml").ref("master"));
await GhTasks.cacheDelete((s) => s.all().ref(ref).succeedOnNoCaches());
await GhTasks.repoSync((s) => s.source("upstream/app").branch("master"));
```

`workflowRun` returns once the dispatch is accepted; the `githubWorkflow` wait
trigger is what suspends the build until the run finishes. The `repo` group
names its repository as an operand, not with `.repo(...)` — `repoRename` is the
one exception — and refuses the flag gh would reject. `repoClone` and `repoFork`
forward git flags after a `--` separator, so a shallow clone is
`.gitArgs("--depth=1")`, not a flag of gh's own; `repoEdit`'s toggles are
tri-state, as gh's are — `.enableIssues()` on, `.enableIssues(false)` off.

`secretSet` puts `.body(...)` in the process's arguments, where other processes
can read it. Omit the value and gh reads standard input, or use `.envFile(...)`;
source it from a `parameter().secret()` either way. A variable is not a secret —
GitHub returns its value in the clear.

Each takes `.repo("owner/name")` and keeps `.command(...)`/`.flag(...)` for a
flag not yet modelled. The `…ListEntries` readers pin gh's `--json` field set —
gh requires one by name — and hand back parsed entries, so a build branches on
data rather than on scraped text.

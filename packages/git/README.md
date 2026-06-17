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

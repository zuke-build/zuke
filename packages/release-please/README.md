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

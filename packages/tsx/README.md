# @zuke/tsx

Typed [`tsx`](https://tsx.is/) task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. The task names mirror the CLI: `tsx` runs an entry point
and `watch` re-runs it on changes. Arguments stay a discrete argv array, so
command construction is injection-free.

```ts
import { TsxTasks } from "jsr:@zuke/tsx";

await TsxTasks.tsx((s) =>
  s.script("src/main.ts").tsconfig("tsconfig.json").scriptArgs("--port", 3000)
);

// Watch mode:
await TsxTasks.watch((s) => s.script("src/main.ts").noClearScreen());
```

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

# @zuke/tsgo

Typed [`tsgo`](https://github.com/microsoft/typescript-go) task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. `tsgo` is the native TypeScript compiler (TypeScript 7 /
`@typescript/native-preview`); it mirrors the `tsc` command line. Arguments stay
a discrete argv array, so command construction is injection-free.

```ts
import { TsgoTasks } from "jsr:@zuke/tsgo";

await TsgoTasks.tsgo((s) =>
  s.project("tsconfig.json").noEmit().strict().pretty()
);
```

> [!NOTE]
> `tsgo` is a preview. Within this repo, `deno check` remains the authoritative
> type-checker — see [`CLAUDE.md`](../../CLAUDE.md). This wrapper is for
> projects that drive `tsgo` directly.

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

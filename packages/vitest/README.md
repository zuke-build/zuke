# @zuke/vitest

Typed [`vitest`](https://vitest.dev/) task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. Arguments stay a discrete argv array, so command
construction is injection-free.

Vitest defaults to watch mode when invoked bare; this wrapper emits the one-shot
`run` subcommand by default (CI-friendly) and switches to `watch` with
`.watch()`.

```ts
import { VitestTasks } from "jsr:@zuke/vitest";

await VitestTasks.run((s) => s.coverage().reporter("dot").bail(1));
```

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

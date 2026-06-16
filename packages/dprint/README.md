# @zuke/dprint

Typed [`dprint`](https://dprint.dev/) task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. `fmt` formats files in place; `check` verifies formatting.
Arguments stay a discrete argv array, so command construction is injection-free.

```ts
import { DprintTasks } from "jsr:@zuke/dprint";

await DprintTasks.check((s) => s.config("dprint.json"));
await DprintTasks.fmt((s) => s.files("src").excludes("**/*.md").incremental());
```

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

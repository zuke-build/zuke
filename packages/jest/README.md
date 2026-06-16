# @zuke/jest

Typed [`jest`](https://jestjs.io/) task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. Arguments stay a discrete argv array, so command
construction is injection-free.

```ts
import { JestTasks } from "jsr:@zuke/jest";

await JestTasks.run((s) => s.ci().coverage().maxWorkers("50%").bail());
```

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

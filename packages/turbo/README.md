# @zuke/turbo

Typed [Turborepo](https://turbo.build) CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `run` and `prune`.

```ts
import { TurboTasks } from "jsr:@zuke/turbo";

await TurboTasks.run((s) => s.tasks("build", "test").filter("web").parallel());
await TurboTasks.prune((s) => s.package("web").docker().outDir("out"));
```

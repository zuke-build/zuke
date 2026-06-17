# @zuke/jsr

Typed [JSR](https://jsr.io) CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `publish`, `add`, and
`remove`.

```ts
import { JsrTasks } from "jsr:@zuke/jsr";

await JsrTasks.publish((s) => s.dryRun().allowSlowTypes());
await JsrTasks.add((s) => s.packages("@std/assert"));
```

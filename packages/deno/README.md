# @zuke/deno

Typed `deno` CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `fmt`, `lint`,
`check`, `test`, `coverage`, `cache`, `run`, and `task` in a fluent
settings-lambda API.

```ts
import { DenoTasks } from "jsr:@zuke/deno";

await DenoTasks.test((s) => s.allowAll().coverage("cov_profile"));
await DenoTasks.fmt((s) => s.check());
```

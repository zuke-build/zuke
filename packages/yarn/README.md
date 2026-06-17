# @zuke/yarn

Typed `yarn` CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `install`, `add`,
`remove`, `run`, and `dlx`.

Works with both Yarn Classic (v1) and Berry (v2+); options that exist on only
one line are noted in their JSDoc (e.g. `.immutable()` is Berry, `dlx` is
Berry).

```ts
import { YarnTasks } from "jsr:@zuke/yarn";

await YarnTasks.install((s) => s.immutable());
await YarnTasks.run((s) => s.script("build"));
```

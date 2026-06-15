# @zuke/npm

Typed `npm` CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `install`, `ci`,
`run`, `exec`, `publish`, and `version`.

```ts
import { NpmTasks } from "jsr:@zuke/npm";

await NpmTasks.ci();
await NpmTasks.run((s) => s.script("build"));
```

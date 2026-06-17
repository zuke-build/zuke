# @zuke/bun

Typed `bun` CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `install`, `add`,
`remove`, `run`, `x` (bunx), and `test`.

```ts
import { BunTasks } from "jsr:@zuke/bun";

await BunTasks.install((s) => s.frozenLockfile());
await BunTasks.run((s) => s.script("build"));
await BunTasks.test((s) => s.coverage());
```

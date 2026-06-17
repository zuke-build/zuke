# @zuke/pnpm

Typed `pnpm` CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `install`, `add`,
`remove`, `run`, `dlx`, and `publish`.

```ts
import { PnpmTasks } from "jsr:@zuke/pnpm";

await PnpmTasks.install((s) => s.frozenLockfile());
await PnpmTasks.run((s) => s.script("build").filter("app"));
```

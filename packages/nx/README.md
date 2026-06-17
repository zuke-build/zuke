# @zuke/nx

Typed [Nx](https://nx.dev) CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `run`, `runMany`, and
`affected`.

```ts
import { NxTasks } from "jsr:@zuke/nx";

await NxTasks.run((s) => s.target("web:build"));
await NxTasks.runMany((s) =>
  s.target("build").projects("web", "api").parallel(3)
);
await NxTasks.affected((s) => s.target("test").base("main"));
```

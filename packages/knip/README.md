# @zuke/knip

Typed [Knip](https://knip.dev) CLI task wrapper for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — find unused files,
dependencies, and exports.

```ts
import { KnipTasks } from "jsr:@zuke/knip";

await KnipTasks.run((s) => s.production().strict());
```

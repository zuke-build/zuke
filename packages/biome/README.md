# @zuke/biome

Typed [Biome](https://biomejs.dev) CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `check`, `format`,
`lint`, and `ci`.

```ts
import { BiomeTasks } from "jsr:@zuke/biome";

await BiomeTasks.ci((s) => s.paths("src")); // read-only, CI-tuned
await BiomeTasks.check((s) => s.write().paths("src")); // apply safe fixes
```

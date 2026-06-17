# @zuke/vite

Typed [Vite](https://vitejs.dev) CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `dev`, `build`, and
`preview`.

```ts
import { ViteTasks } from "jsr:@zuke/vite";

await ViteTasks.build((s) => s.outDir("dist").mode("production"));
await ViteTasks.preview((s) => s.port(4173));
```

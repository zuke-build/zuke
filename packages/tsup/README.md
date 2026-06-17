# @zuke/tsup

Typed [tsup](https://tsup.egoist.dev) CLI task wrapper for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — bundle
TypeScript/JavaScript with formats, declarations, minification, and more.

```ts
import { TsupTasks } from "jsr:@zuke/tsup";

await TsupTasks.build((s) =>
  s.entry("src/index.ts").format("esm", "cjs").dts().minify().clean()
);
```

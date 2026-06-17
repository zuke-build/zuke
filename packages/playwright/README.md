# @zuke/playwright

Typed Playwright CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `test`, `install`
(browsers), `show-report`, and `codegen`.

```ts
import { PlaywrightTasks } from "jsr:@zuke/playwright";

await PlaywrightTasks.install((s) => s.withDeps());
await PlaywrightTasks.test((s) => s.project("chromium").grep("@smoke"));
```

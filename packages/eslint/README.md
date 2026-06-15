# @zuke/eslint

Typed [`eslint`](https://eslint.org/) task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. Arguments stay a discrete argv array, so command
construction is injection-free.

```ts
import { EslintTasks } from "jsr:@zuke/eslint";

await EslintTasks.lint((s) =>
  s.paths("src").ext(".ts", ".tsx").fix().maxWarnings(0)
);
```

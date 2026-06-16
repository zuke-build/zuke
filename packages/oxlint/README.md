# @zuke/oxlint

Typed [`oxlint`](https://oxc.rs/docs/guide/usage/linter.html) task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. Arguments stay a discrete argv array, so command
construction is injection-free.

```ts
import { OxlintTasks } from "jsr:@zuke/oxlint";

await OxlintTasks.lint((s) =>
  s.paths("src").config(".oxlintrc.json").fix().denyWarnings()
);
```

# @zuke/cspell

Typed [`cspell`](https://cspell.org/) task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. Arguments stay a discrete argv array, so command
construction is injection-free.

```ts
import { CspellTasks } from "jsr:@zuke/cspell";

await CspellTasks.check((s) =>
  s.files("**").config("cspell.json").noProgress().showSuggestions()
);
```

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

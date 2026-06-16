# @zuke/tsx

Typed [`tsx`](https://tsx.is/) task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. Runs a TypeScript entry point directly — one-shot by
default, or in watch mode via `.watch()`. Arguments stay a discrete argv array,
so command construction is injection-free.

```ts
import { TsxTasks } from "jsr:@zuke/tsx";

await TsxTasks.run((s) =>
  s.script("src/main.ts").tsconfig("tsconfig.json").scriptArgs("--port", 3000)
);

// Watch mode:
await TsxTasks.run((s) => s.script("src/main.ts").watch().noClearScreen());
```

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

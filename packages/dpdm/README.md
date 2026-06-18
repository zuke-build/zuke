# @zuke/dpdm

Typed [dpdm](https://github.com/acrazing/dpdm) CLI task wrapper for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — analyze a project's
module dependency graph and report circular imports.

```ts
import { DpdmTasks } from "jsr:@zuke/dpdm";

// Fail the build on any circular dependency among the entry files.
await DpdmTasks.analyze((s) =>
  s.noTree().noWarning().exitCode("circular:1").entries("src/index.ts")
);
```

Entry files are passed via `.entries(...)` and appended after every option, and
arguments stay a discrete argv array — so command construction is
injection-free.

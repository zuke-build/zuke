# Programmatic API

Beyond authoring, `mod.ts` exports the building blocks if you want to drive Zuke
yourself or test a build:

```ts
import {
  discoverTargets, // (build) => Map<string, TargetBuilder>
  execute, // (build, rootTarget, options?) => Promise<BuildResult>
  executionSet, // (rootTarget) => Set<TargetBuilder>
  findCycle, // (targets) => string[] | null
  GraphError,
  plan, // (rootTarget) => TargetBuilder[]  (topological order)
  validateGraph, // (targets) => void  (throws GraphError)
} from "jsr:@zuke/core";
```

`execute` accepts `{ silent?, reporter?, skip? }`. Provide a custom `reporter`
(`{ info(line), error(line) }`) to capture or redirect output.

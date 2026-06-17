# @zuke/tofu

Typed OpenTofu CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `init`, `validate`,
`plan`, `apply`, `destroy`, `fmt`, and `output`.

```ts
import { TofuTasks } from "jsr:@zuke/tofu";

await TofuTasks.init((s) => s.upgrade());
await TofuTasks.plan((s) => s.out("plan.tfplan").var("env", "prod"));
await TofuTasks.apply((s) => s.autoApprove().planFile("plan.tfplan"));
```

OpenTofu mirrors Terraform's command surface; each `-var` is emitted as a single
`-var=name=value` argv entry, so values are never re-split by a shell.

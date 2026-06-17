# @zuke/terraform

Typed Terraform CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `init`, `validate`,
`plan`, `apply`, `destroy`, `fmt`, and `output`.

```ts
import { TerraformTasks } from "jsr:@zuke/terraform";

await TerraformTasks.init((s) => s.upgrade());
await TerraformTasks.plan((s) => s.out("plan.tfplan").var("env", "prod"));
await TerraformTasks.apply((s) => s.autoApprove().planFile("plan.tfplan"));
```

Each `-var` is emitted as a single `-var=name=value` argv entry, so values are
never re-split by a shell.

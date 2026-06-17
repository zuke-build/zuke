# @zuke/helm

Typed [Helm](https://helm.sh) CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `install`, `upgrade`,
`uninstall`, `template`, `lint`, `dependencyUpdate`, `repoAdd`, and `package`.

```ts
import { HelmTasks } from "jsr:@zuke/helm";

await HelmTasks.upgrade((s) =>
  s.release("api").chart("./charts/api").install().namespace("prod")
    .set("image.tag", "1.4").wait()
);
```

Every task shares the cluster-targeting flags `.namespace(...)`,
`.kubeContext(...)`, and `.kubeconfig(...)`. Arguments stay a discrete argv
array end-to-end — never a shell string — so command construction is
injection-free.

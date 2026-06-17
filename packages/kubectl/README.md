# @zuke/kubectl

Typed `kubectl` CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — deploy to and manage
Kubernetes from a pipeline.

Tasks: `apply`, `create`, `delete`, `get`, `describe`, `logs`, `exec`,
`rollout`, `scale`, `setImage`, `patch`, `portForward`, `wait`, `top`.

```ts
import { KubectlTasks } from "jsr:@zuke/kubectl";

// Deploy and roll forward.
await KubectlTasks.apply((s) => s.file("k8s/").namespace("prod"));
await KubectlTasks.setImage((s) =>
  s.resource("deployment/api").image("api", "api:1.4").namespace("prod")
);
await KubectlTasks.rollout((s) =>
  s.status().resource("deployment/api").namespace("prod").timeout("120s")
);
```

Every task shares the cluster-targeting flags `.namespace(...)`,
`.context(...)`, and `.kubeconfig(...)`. Arguments stay a discrete argv array
end-to-end — never a shell string — so command construction is injection-free.

# @zuke/kustomize

Typed [Kustomize](https://kustomize.io) CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `build` and
`editSetImage`.

```ts
import { KustomizeTasks } from "jsr:@zuke/kustomize";

await KustomizeTasks.build((s) => s.dir("overlays/prod").output("out.yaml"));
await KustomizeTasks.editSetImage((s) => s.image("api", "api:1.4"));
```

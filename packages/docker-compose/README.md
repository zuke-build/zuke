# @zuke/docker-compose

Typed Docker Compose task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `up`, `down`,
`build`, `pull`, `push`, `run`, `exec`, `logs`, `ps`, `config`, `start`, `stop`,
`restart`, and `rm` — in a fluent settings-lambda API. Arguments stay a discrete
argv array, so command construction is injection-free.

Compose ships in two shapes: the v2 CLI plugin invoked as `docker compose` and
the legacy v1 standalone binary `docker-compose`. This wrapper detects which is
installed at run time (preferring the v2 plugin) and caches the result, so the
same build file works on either host. Pin the form explicitly with
`.usePlugin()` or `.useStandalone()` to skip detection.

```ts
import { DockerComposeTasks } from "jsr:@zuke/docker-compose";

await DockerComposeTasks.up((s) => s.file("compose.yml").detach().build());
await DockerComposeTasks.logs((s) => s.follow().tail(100));
await DockerComposeTasks.down((s) => s.volumes());
```

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

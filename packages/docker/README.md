# @zuke/docker

Typed `docker` CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `build`, `run`,
`exec`, `push`, `pull`, `tag`, `login`, `images`, `ps`, `stop`, `start`, `rm`,
`rmi`, `save`, and `load` — in a fluent settings-lambda API. Arguments stay a
discrete argv array, so command construction is injection-free.

```ts
import { DockerTasks } from "jsr:@zuke/docker";

await DockerTasks.build((s) =>
  s.tag("app:1.0").file("Dockerfile").buildArg("VERSION", "1.0")
);
await DockerTasks.push((s) => s.image("app:1.0"));
```

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

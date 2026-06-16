# @zuke/gcloud

Typed [`gcloud`](https://cloud.google.com/sdk/gcloud) (Google Cloud SDK) task
wrapper for [Zuke](https://github.com/zuke-build/zuke#readme) builds, in a
fluent settings-lambda API. `gcloud` is vast, so this is a flexible command
builder: name the command with `.command(...)`, set the common global flags
fluently, and pass anything else with `.flag(...)`. Arguments stay a discrete
argv array, so command construction is injection-free.

```ts
import { GcloudTasks } from "jsr:@zuke/gcloud";

await GcloudTasks.run((s) =>
  s.command("run", "deploy", "api")
    .project("my-project")
    .flag("region", "us-central1")
    .flag("source", ".")
    .noPrompt()
);

await GcloudTasks.run((s) => s.command("auth", "list").format("json"));
```

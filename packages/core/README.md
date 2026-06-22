# @zuke/core

Code-first, strongly-typed build automation for Deno. Define builds as
TypeScript classes; each target is a field wired to others by reference, forming
a dependency graph that Zuke sorts and runs.

```ts
import { Build, run, target } from "jsr:@zuke/core";

class MyBuild extends Build {
  hello = target()
    .description("Say hello")
    .executes(() => console.log("Hello from Zuke!"));
}

if (import.meta.main) await run(MyBuild);
```

Also exports `jsr:@zuke/core/shell` (the injection-safe `$` runner) and
`jsr:@zuke/core/tooling` (the base for typed tool wrappers).

See [Zuke](https://github.com/zuke-build/zuke#readme) for the full guide.

## Stability

From `1.0.0`, `@zuke/core` follows semantic versioning: breaking changes to the
public API bump the major version, so you can depend on `^1` with confidence.

## Paths

`@zuke/core` exports `absolutePath` and the `PathLike` type. Across the Zuke
tool-wrapper packages, every path argument accepts either a string or an
`AbsolutePath`.

## Announcements

`AnnounceTasks` posts build status — "build passed", "package published",
"service deployed" — to Slack, Microsoft Teams, and Discord from a pipeline.
Each task takes a settings-lambda, like the tool wrappers, and posts either to
an incoming webhook or, in bot mode (`.bot().token(t).channel(c)`), through the
platform's API.

```ts
import { AnnounceTasks } from "jsr:@zuke/core";

await AnnounceTasks.slack((s) =>
  s.webhook(slackWebhookUrl)
    .title("Deploy")
    .text("Shipped api@1.4.0 to production.")
    .success()
    .field("Service", "api")
);
```

The webhook URL or bot token embeds a secret, so source it from a
`parameter().secret()` build input. See the
[authoring guide](https://github.com/zuke-build/zuke/blob/master/docs/authoring.md)
for Teams and Discord, bot/API modes, and the full settings API.

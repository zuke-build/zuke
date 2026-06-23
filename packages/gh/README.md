# @zuke/gh

Typed [`gh`](https://cli.github.com/) (GitHub CLI) task wrapper for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. `gh` is broad, so this is a flexible command builder: name
the command with `.command(...)`, set `--repo`, and pass anything else with
`.flag(...)`. Arguments stay a discrete argv array, so command construction is
injection-free.

```ts
import { GhTasks } from "jsr:@zuke/gh";

await GhTasks.run((s) =>
  s.command("release", "create", "v1.2.3")
    .repo("acme/app")
    .flag("title", "v1.2.3")
    .flag("generate-notes")
);

await GhTasks.run((s) => s.command("pr", "list").flag("state", "open"));
```

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/gh` — a typed `gh` (GitHub CLI) task wrapper for Zuke builds.

A flexible command builder: name the command with `.command(...)`, set
`--repo`, and pass anything else with `.flag(...)`.

```ts
import { GhTasks } from "jsr:@zuke/gh";
await GhTasks.run((s) => s.command("pr", "list").flag("state", "open"));
```
@module

const GhTasks: GhTasksApi
  Typed task functions for the `gh` GitHub CLI.

class GhSettings extends ToolSettings
  Settings for a `gh` invocation.

  override protected defaultTool(): string
  command(...parts: Array<string | number>): this
    The command path and verb, e.g. `command("pr", "create")`.
  repo(slug: string): this
    Target repository as `OWNER/REPO` (`-R`/`--repo`).
  flag(name: string, value?: string | number): this
    Add an arbitrary flag. With a value it renders `--name value`; without one
    it renders the bare `--name`. Repeatable.
  override protected buildArgs(): string[]

interface GhTasksApi
  The shape of {@link GhTasks}.

  run(configure?: Configure<GhSettings>): Promise<CommandOutput>
    Run a `gh` command.
````

</details>

<!-- ZUKE:API:END -->

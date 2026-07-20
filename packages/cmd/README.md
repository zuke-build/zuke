# @zuke/cmd

Run any external command as a [Zuke](https://github.com/zuke-build/zuke#readme)
task — a generic, injection-safe tool wrapper for tools without a dedicated
package.

```ts
import { CmdTasks } from "jsr:@zuke/cmd";

await CmdTasks.exec("git", (s) => s.args("rev-parse", "HEAD"));
```

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/cmd` — generic command execution for Zuke builds: the fallback for
tools that have no dedicated wrapper package.

```ts
import { CmdTasks } from "jsr:@zuke/cmd";

await CmdTasks.exec("git", (s) => s.args("rev-parse", "HEAD"));
```
@module

const CmdTasks: CmdTasksApi
  Task functions for running arbitrary tools.

class CmdSettings extends ToolSettings
  Settings for a generic command: the tool name plus raw arguments.

  constructor(tool: PathLike)
    Create settings for `tool`; the tool name is required.
  override protected defaultTool(): string
    The command to run — the tool name passed to the constructor.
  override protected buildArgs(): string[]
    No implicit arguments; the caller supplies them via `.args(...)`.

interface CmdTasksApi
  The shape of {@link CmdTasks}.

  exec(tool: PathLike, configure?: Configure<CmdSettings>): Promise<CommandOutput>
    Run `tool` with the configured settings.
````

</details>

<!-- ZUKE:API:END -->

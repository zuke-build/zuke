# @zuke/lint-staged

Typed [lint-staged](https://github.com/lint-staged/lint-staged) task wrappers
for [Zuke](https://github.com/zuke-build/zuke#readme) builds — run the
configured linters over the staged files, or over the files a diff touched.

```ts
import { LintStagedTasks } from "jsr:@zuke/lint-staged";

await LintStagedTasks.run((s) => s.config(".lintstagedrc.json").relative());
await LintStagedTasks.run((s) => s.diff("main...HEAD").allowEmpty());
```

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/lint-staged` — typed `lint-staged` task wrappers for Zuke builds.

Configure a fluent settings object in a lambda; the task builds the argv and
runs it.

```ts
import { LintStagedTasks } from "jsr:@zuke/lint-staged";
await LintStagedTasks.run((s) => s.config(".lintstagedrc.json").relative());
```
@module

const LintStagedTasks: LintStagedTasksApi
  Typed task functions for `lint-staged`.

class LintStagedSettings extends ToolSettings
  Settings for a `lint-staged` run.

  override protected defaultTool(): string
    The default executable name (`lint-staged`).
  override protected defaultResolution(): ToolResolution
    Resolve the binary from `node_modules/.bin` by default — lint-staged is an npm-distributed tool.
  config(path: PathLike): this
    Use an explicit config file (`--config`).
  relative(): this
    Pass file paths relative to the working directory rather than absolute
    (`--relative`).

    Tools configured with root-relative globs — the usual case for an ESLint or
    Prettier config committed at the repo root — only match when the paths
    handed to them are relative too.
  concurrent(tasks: number): this
    Run at most `tasks` linter tasks at once (`--concurrent <n>`). Use `1` to
    serialise them — what a tool that writes shared state (a cache, a lockfile)
    needs.
  allowEmpty(): this
    Exit successfully when the tasks left nothing staged (`--allow-empty`).

    Without it a formatter that reverts the only staged change fails the run,
    because the resulting commit would be empty.
  diff(ref: string): this
    Take the file list from a diff instead of the staged files
    (`--diff <ref>`), e.g. `main...HEAD` to lint everything a branch touched.
  shell(): this
    Run the configured commands through a shell instead of parsing them (`--shell`).
  override protected buildArgs(): string[]
    Assemble the `lint-staged` argv.

interface LintStagedTasksApi
  The shape of {@link LintStagedTasks}.

  run(configure?: Configure<LintStagedSettings>): Promise<CommandOutput>
    Run the configured linters over the staged files: `lint-staged`.
````

</details>

<!-- ZUKE:API:END -->

# @zuke/playwright

Typed Playwright CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `test`, `install`
(browsers), `show-report`, and `codegen`.

```ts
import { PlaywrightTasks } from "jsr:@zuke/playwright";

await PlaywrightTasks.install((s) => s.withDeps());
await PlaywrightTasks.test((s) => s.project("chromium").grep("@smoke"));
```

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/playwright` — typed `PlaywrightTasks` wrappers for the Playwright CLI,
for use in Zuke build targets (end-to-end browser testing).

```ts
import { PlaywrightTasks } from "jsr:@zuke/playwright";

await PlaywrightTasks.install((s) => s.withDeps());
await PlaywrightTasks.test((s) => s.project("chromium").grep("@smoke"));
```
@module

const PlaywrightTasks: PlaywrightTasksApi
  Typed task functions for the Playwright CLI.

class PlaywrightCodegenSettings extends PlaywrightSettings
  Settings for `playwright codegen`.

  url(value: string): this
    The URL to open for recording; omit to start blank.
  target(language: string): this
    The output language (`--target=`, e.g. `javascript`, `python`).
  output(path: string): this
    Write the generated script to a file (`--output=`).
  override protected buildArgs(): string[]
    Assemble the `playwright codegen` argv.

class PlaywrightInstallSettings extends PlaywrightSettings
  Settings for `playwright install` (browser binaries).

  browsers(...names: string[]): this
    Browsers to install (e.g. `chromium`); omit to install all.
  withDeps(): this
    Also install the OS dependencies (`--with-deps`).
  override protected buildArgs(): string[]
    Assemble the `playwright install` argv.

abstract class PlaywrightSettings extends ToolSettings
  Base for all Playwright subcommand settings: binary is `playwright`.

  override protected defaultTool(): string
    The tool binary invoked by all Playwright subcommands: `playwright`.
  override protected defaultResolution(): ToolResolution
    Resolve the binary from `node_modules/.bin` by default — playwright is an npm-distributed tool.

class PlaywrightShowReportSettings extends PlaywrightSettings
  Settings for `playwright show-report`.

  dir(path: string): this
    The report directory to open; omit for the default.
  override protected buildArgs(): string[]
    Assemble the `playwright show-report` argv.

class PlaywrightTestSettings extends PlaywrightSettings
  Settings for `playwright test`.

  project(...names: string[]): this
    Restrict to the named project(s) (`--project=`); repeatable.
  grep(pattern: string): this
    Only run tests matching the pattern (`--grep`).
  headed(): this
    Run in headed browsers (`--headed`).
  workers(count: number): this
    Set the number of parallel workers (`--workers=`).
  reporter(name: string): this
    Choose the reporter (`--reporter=`).
  config(path: string): this
    Use a specific config file (`--config=`).
  paths(...filters: string[]): this
    Test file or directory filters to run; omit to run all tests.
  override protected buildArgs(): string[]
    Assemble the `playwright test` argv.

interface PlaywrightTasksApi
  The shape of {@link PlaywrightTasks}.

  test(configure?: Configure<PlaywrightTestSettings>): Promise<CommandOutput>
    Run the test suite: `playwright test`.
  install(configure?: Configure<PlaywrightInstallSettings>): Promise<CommandOutput>
    Install browser binaries: `playwright install`.
  showReport(configure?: Configure<PlaywrightShowReportSettings>): Promise<CommandOutput>
    Open the HTML report: `playwright show-report`.
  codegen(configure?: Configure<PlaywrightCodegenSettings>): Promise<CommandOutput>
    Record interactions into a script: `playwright codegen`.
````

</details>

<!-- ZUKE:API:END -->

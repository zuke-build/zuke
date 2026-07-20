# @zuke/cypress

Typed [Cypress](https://cypress.io) CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `run`, `open`,
`install`, `verify`, and `info`.

```ts
import { CypressTasks } from "jsr:@zuke/cypress";

await CypressTasks.run((s) => s.e2e().browser("chrome").spec("cypress/e2e/**"));
```

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/cypress` — typed `CypressTasks` wrappers for the
Cypress (https://cypress.io) CLI (end-to-end and component testing), for use
in Zuke builds.

```ts
import { CypressTasks } from "jsr:@zuke/cypress";

await CypressTasks.run((s) => s.e2e().browser("chrome"));
```
@module

const CypressTasks: CypressTasksApi
  Typed task functions for the `cypress` CLI.

class CypressInfoSettings extends CypressSettings
  Settings for `cypress info`.

  override protected buildArgs(): string[]
    Assemble the `cypress info` argv.

class CypressInstallSettings extends CypressSettings
  Settings for `cypress install` (the bundled binary).

  force(): this
    Reinstall even if already present (`--force`).
  override protected buildArgs(): string[]
    Assemble the `cypress install` argv.

class CypressOpenSettings extends CypressTestingSettings
  Settings for `cypress open` (interactive).

  override protected buildArgs(): string[]
    Assemble the `cypress open` argv.

class CypressRunSettings extends CypressTestingSettings
  Settings for `cypress run` (headless).

  headed(): this
    Run in a headed browser (`--headed`).
  spec(pattern: string): this
    Glob of spec files to run (`--spec`).
  record(): this
    Record the run to Cypress Cloud (`--record`).
  parallel(): this
    Run in parallel across machines (`--parallel`).
  tag(value: string): this
    Tag the recorded run (`--tag`).
  port(value: number): this
    Override the server port (`--port`).
  override protected buildArgs(): string[]
    Assemble the `cypress run` argv.

abstract class CypressSettings extends ToolSettings
  Base for all `cypress` subcommand settings: the binary is `cypress`.

  override protected defaultTool(): string
    The default tool binary: `cypress`.
  override protected defaultResolution(): ToolResolution
    Resolve the binary from `node_modules/.bin` by default — cypress is an npm-distributed tool.

abstract class CypressTestingSettings extends CypressSettings
  Base for the `run`/`open` commands, which share testing-type selection, a
  browser, a config file, and a project path.

  e2e(): this
    Run end-to-end tests (`--e2e`).
  component(): this
    Run component tests (`--component`).
  browser(name: string): this
    Choose the browser, e.g. `chrome` or `electron` (`--browser`).
  configFile(path: PathLike): this
    Use an explicit config file (`--config-file`).
  project(path: PathLike): this
    Run against a project at the given path (`--project`).
  protected sharedArgs(): string[]
    The testing-type/browser/config/project arguments shared by run and open.

class CypressVerifySettings extends CypressSettings
  Settings for `cypress verify`.

  override protected buildArgs(): string[]
    Assemble the `cypress verify` argv.

interface CypressTasksApi
  The shape of {@link CypressTasks}.

  run(configure?: Configure<CypressRunSettings>): Promise<CommandOutput>
    Run tests in headless mode: `cypress run`.
  open(configure?: Configure<CypressOpenSettings>): Promise<CommandOutput>
    Open the interactive runner: `cypress open`.
  install(configure?: Configure<CypressInstallSettings>): Promise<CommandOutput>
    Install the bundled binary: `cypress install`.
  verify(configure?: Configure<CypressVerifySettings>): Promise<CommandOutput>
    Verify the installation: `cypress verify`.
  info(configure?: Configure<CypressInfoSettings>): Promise<CommandOutput>
    Print environment info: `cypress info`.
````

</details>

<!-- ZUKE:API:END -->

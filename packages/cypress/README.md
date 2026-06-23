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

class CypressInstallSettings extends CypressSettings
  Settings for `cypress install` (the bundled binary).

  force(): this
    Reinstall even if already present (`--force`).
  override protected buildArgs(): string[]

class CypressOpenSettings extends CypressTestingSettings
  Settings for `cypress open` (interactive).

  override protected buildArgs(): string[]

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

class CypressVerifySettings extends CypressSettings
  Settings for `cypress verify`.

  override protected buildArgs(): string[]

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

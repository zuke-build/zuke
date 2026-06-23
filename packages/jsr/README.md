# @zuke/jsr

Typed [JSR](https://jsr.io) CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `publish`, `add`, and
`remove`.

```ts
import { JsrTasks } from "jsr:@zuke/jsr";

await JsrTasks.publish((s) => s.dryRun().allowSlowTypes());
await JsrTasks.add((s) => s.packages("@std/assert"));
```

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/jsr` — tools for the JSR (https://jsr.io) registry in Zuke builds:
typed `JsrTasks` wrappers for the `jsr` CLI (publish, add, remove), plus
read-only registry queries to check which versions are already published.

```ts
import { isPublished, JsrTasks } from "jsr:@zuke/jsr";

if (!(await isPublished("@zuke/core", "0.13.0"))) {
  await JsrTasks.publish((s) => s.allowDirty());
}
await JsrTasks.add((s) => s.packages("@std/assert"));
```
@module

async function isPublished(pkg: string, version: string, options?: JsrRegistryOptions): Promise<boolean>
  Whether `pkg@version` (e.g. `@zuke/core`, `0.13.0`) is already on JSR.

async function jsrVersions(pkg: string, options: JsrRegistryOptions): Promise<Set<string>>
  The set of published versions of `pkg` (a scoped name like `@zuke/core`).
  Resolves to an empty set if the package is not found on JSR.

function publishedVersions(meta: unknown): Set<string>
  The set of version strings present in a JSR `meta.json` payload. Tolerant of
  malformed input: anything without a `versions` object yields an empty set.

const JsrTasks: JsrTasksApi
  Typed task functions for the `jsr` CLI.

class JsrAddSettings extends JsrSettings
  Settings for `jsr add` (install a JSR dependency).

  packages(...specs: string[]): this
    Package specs to add, e.g. `@std/assert` (required).
  dev(): this
    Add as a development dependency (`--save-dev`).
  override protected buildArgs(): string[]

class JsrPublishSettings extends JsrSettings
  Settings for `jsr publish`.

  dryRun(): this
    Validate without publishing (`--dry-run`).
  allowSlowTypes(): this
    Permit slow types in the published package (`--allow-slow-types`).
  allowDirty(): this
    Publish even with an uncommitted working tree (`--allow-dirty`).
  noCheck(): this
    Skip type-checking before publishing (`--no-check`).
  provenance(): this
    Attach provenance attestation in CI (`--provenance`).
  token(value: string): this
    Authenticate with a token instead of the interactive flow (`--token`).
  override protected buildArgs(): string[]

class JsrRemoveSettings extends JsrSettings
  Settings for `jsr remove`.

  packages(...names: string[]): this
    Package names to remove (required).
  override protected buildArgs(): string[]

interface JsrRegistryOptions
  Options shared by the JSR registry helpers.

  fetch?: typeof fetch
    The `fetch` implementation to use. Defaults to the global `fetch`; override
    it to unit-test without network access.

interface JsrTasksApi
  The shape of {@link JsrTasks}.

  publish(configure?: Configure<JsrPublishSettings>): Promise<CommandOutput>
    Publish the package: `jsr publish`.
  add(configure?: Configure<JsrAddSettings>): Promise<CommandOutput>
    Add a JSR dependency: `jsr add`.
  remove(configure?: Configure<JsrRemoveSettings>): Promise<CommandOutput>
    Remove a dependency: `jsr remove`.
````

</details>

<!-- ZUKE:API:END -->

# @zuke/docs

Typed [Zuke](https://github.com/zuke-build/zuke#readme) tasks that generate and
verify API documentation for a JSR-style workspace — so neither humans nor
agents have to guess a package's API.

From one source of truth (`deno doc`), `DocsTasks.apiDocs(...)` produces:

- an **`llms.txt`** index (the [llmstxt.org](https://llmstxt.org) convention),
- a complete **`llms-full.txt`** reference — the whole typed surface in one
  file,
- a generated **`## API`** block in each package README (what renders on the
  package's JSR page).

`DocsTasks.checkApiDocs(...)` recomputes the same artifacts and returns the ones
that are stale on disk — wire it into your build's CI gate to fail on drift.

```ts
import { Build, run, target } from "jsr:@zuke/core";
import { DocsTasks } from "jsr:@zuke/docs";

const PACKAGES = ["core", "deno"];
const OPTIONS = { scope: "@acme" };

class Build_ extends Build {
  docs = target()
    .description("Regenerate API docs")
    .executes(() => DocsTasks.apiDocs(PACKAGES, OPTIONS));

  docsCheck = target()
    .description("Fail if API docs are stale")
    .executes(async () => {
      const stale = await DocsTasks.checkApiDocs(PACKAGES, OPTIONS);
      if (stale.length > 0) {
        throw new Error(`Stale docs: ${stale.join(", ")} — run the docs task.`);
      }
    });
}

await run(Build_);
```

Subprocesses (`deno doc`, `deno fmt`) run through the core `$` shell using
`Deno.execPath()` — the running `deno` — so there is no dependency on `PATH`.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/docs` — typed tasks for generating and verifying API documentation
across a Zuke (or any JSR-style) workspace, from a single source of truth:
`deno doc`.

{@link DocsTasks.apiDocs} turns each package's `deno doc` into three
artifacts so neither humans nor agents have to guess an API:

- an `llms.txt` index (the llmstxt.org convention),
- a complete `llms-full.txt` reference (the whole typed surface in one file),
- a generated `## API` block in every package README.

{@link DocsTasks.checkApiDocs} recomputes the same artifacts and reports any
that are stale on disk — run it in CI to fail when the docs drift from code.

```ts
import { DocsTasks } from "jsr:@zuke/docs";

// In a build target:
await DocsTasks.apiDocs(["core", "deno"], { scope: "@acme" });

// In the CI gate:
const stale = await DocsTasks.checkApiDocs(["core", "deno"], { scope: "@acme" });
if (stale.length > 0) throw new Error(`Stale docs: ${stale.join(", ")}`);
```
@module

const DocsTasks: DocsTasksApi
  Typed tasks for generating and verifying API documentation.

interface ApiDocsOptions
  Options accepted by {@link DocsTasks.apiDocs} and {@link DocsTasks.checkApiDocs}.

  packagesDir?: string
    Directory holding the package subdirectories. Default `"packages"`.
  scope?: string
    JSR scope used for package names and links. Default `"@zuke"`.
  jsrBaseUrl?: string
    Base URL for package documentation links. Default `"https://jsr.io"`.
  index?: string
    Output path for the short index. Default `"llms.txt"`.
  full?: string
    Output path for the full reference. Default `"llms-full.txt"`.
  readmes?: boolean
    Inject a generated `## API` block into each package README. Default `true`.
  project?: ProjectInfo
    Project framing for the index. Falls back to the scope and a generic blurb.
  regenerateCommand?: string
    Command shown in "regenerate with …" notes. Default `"deno task docs"`.

interface DocsTasksApi
  The shape of {@link DocsTasks}.

  apiDocs(packages: string[], options?: ApiDocsOptions): Promise<string[]>
    Generate the index, the full reference, and (unless disabled) each package
    README's API block, writing only the files whose content changed. Returns
    the repo-relative paths written.
  checkApiDocs(packages: string[], options?: ApiDocsOptions): Promise<string[]>
    Recompute every artifact and return the paths that are out of date on disk
    (empty when everything is current). Writes nothing.

interface ProjectInfo
  Project framing rendered into the `llms.txt` index.

  title: string
    Heading for the index, e.g. `"Zuke"`.
  summary: string
    One-paragraph summary, rendered as the index's blockquote.
  example?: string
    An optional canonical code example, fenced under an "Example" heading.
  install?: string
    An optional install/scaffold command, shown in the "do not guess" list.
````

</details>

<!-- ZUKE:API:END -->

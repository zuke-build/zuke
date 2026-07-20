# @zuke/docs

Typed [Zuke](https://github.com/zuke-build/zuke#readme) tasks that turn
already-generated API documentation into agent-friendly artifacts — so neither
humans nor agents have to guess a package's API.

You hand it each package's documentation text (for a Deno workspace, the output
of `deno doc`); `DocsTasks.apiDocs(...)` renders:

- an **`llms.txt`** index (the [llmstxt.org](https://llmstxt.org) convention),
- a complete **`llms-full.txt`** reference — the whole surface in one file,
- a generated **`## API`** block in each package README.

`DocsTasks.checkApiDocs(...)` recomputes the same artifacts and returns the ones
that are stale on disk — wire it into your build's CI gate to fail on drift.

This package **runs no subprocess and depends only on `@zuke/core`** — it does
not run `deno` and does not reference `@zuke/deno`. Pair it with whatever
produces your doc text: `@zuke/deno`'s `DenoTasks.doc`, a checked-in file, or
any other source.

```ts
import { DocsTasks, type PackageDoc } from "jsr:@zuke/docs";
import { DenoTasks } from "jsr:@zuke/deno";

// Produce the doc text however you like — here, via @zuke/deno:
const docs: PackageDoc[] = [];
for (const dir of ["core", "deno"]) {
  const { stdout } = await DenoTasks.doc((s) =>
    s.paths(`packages/${dir}/mod.ts`).env({ NO_COLOR: "1" }).quiet()
  );
  docs.push({ name: `@acme/${dir}`, dir, doc: stdout });
}

// Consume it — no deno here:
await DocsTasks.apiDocs(docs, { project: { title: "Acme", summary: "…" } });
```

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/docs` — typed tasks that turn already-generated API documentation into
agent-friendly artifacts, so neither humans nor agents have to guess an API.

You supply each package's documentation text (for a Deno workspace, the
output of `deno doc`); this package renders it into three things:

- an `llms.txt` index (the llmstxt.org convention),
- a complete `llms-full.txt` reference (the whole surface in one file),
- a generated `## API` block in every package README.

It runs no subprocess and depends only on `@zuke/core`, so it works without
`deno` on `PATH` and without the `@zuke/deno` package — pair it with whatever
produces your doc text (`@zuke/deno`'s `DenoTasks.doc`, a checked-in file, …).

```ts
import { DocsTasks } from "jsr:@zuke/docs";

const docs = [{ name: "@acme/core", dir: "core", doc: denoDocText }];
await DocsTasks.apiDocs(docs, { project: { title: "Acme", summary: "…" } });

// In the CI gate:
const stale = await DocsTasks.checkApiDocs(docs);
if (stale.length > 0) throw new Error(`Stale docs: ${stale.join(", ")}`);
```
@module

const DocsTasks: DocsTasksApi
  Typed tasks for generating and verifying API documentation.

interface ApiDocsOptions
  Options accepted by {@link DocsTasks.apiDocs} and {@link DocsTasks.checkApiDocs}.

  packagesDir?: string
    Directory holding the package subdirectories. Default `"packages"`.
  jsrBaseUrl?: string
    Base URL for package documentation links. Default `"https://jsr.io"`.
  index?: string
    Output path for the short index. Default `"llms.txt"`.
  full?: string
    Output path for the full reference. Default `"llms-full.txt"`.
  readmes?: boolean
    Inject a generated `## API` block into each package README. Default `true`.
  project?: ProjectInfo
    Project framing for the index. Falls back to a generic blurb.
  regenerateCommand?: string
    Command shown in "regenerate with …" notes. Default `"deno task docs"`.

interface DocLintReport
  One package's `deno doc --lint` output plus the type names it imports from
  other `@zuke/*` packages, fed into {@link DocsTasksApi.checkDocLint}. The
  caller runs the linter and scans the package's imports, so `@zuke/docs` never
  runs `deno`.

  pkg: string
    The package identifier, surfaced in violations (e.g. `@zuke/kubectl`).
  output: string
    The raw `deno doc --lint` output for the package's entrypoints.
  crossPackageTypes: string[]
    The local names the package imports from another `@zuke/*` package. A
    `private-type-ref` to one of these is the accepted residual (guideline 4);
    a ref to any other type is a defect (the type is first-party and must be
    exported).

interface DocLintViolation
  A documentation-lint defect, tied to the package it was found in.

  pkg: string
    The package the defect is in.
  kind: string
    The lint rule, e.g. `"missing-jsdoc"` or `"private-type-ref"`.
  message: string
    The diagnostic's headline message.

interface DocsTasksApi
  The shape of {@link DocsTasks}.

  apiDocs(docs: PackageDoc[], options?: ApiDocsOptions): Promise<string[]>
    From the supplied per-package docs, generate the index, the full reference,
    and (unless disabled) each package README's API block, writing only the
    files whose content changed. Returns the paths written.
  checkApiDocs(docs: PackageDoc[], options?: ApiDocsOptions): Promise<string[]>
    Recompute every artifact and return the paths that are out of date on disk
    (empty when everything is current). Writes nothing.
  checkDocLint(reports: DocLintReport[]): DocLintViolation[]
    Classify `deno doc --lint` output across packages into real defects: every
    `missing-jsdoc`, plus every `private-type-ref` whose referenced type is not
    an accepted cross-package import (in the report's `crossPackageTypes`).
    Fails safe — any other referenced type is treated as a first-party leak.
    Pure: the caller runs the linter; this classifies. Empty when clean.

interface PackageDoc
  One package's already-generated documentation, fed into the tasks.

  name: string
    The published name, e.g. `@zuke/deno`.
  dir: string
    The directory under `packagesDir` whose README receives the API block.
  doc: string
    The package's API documentation text — typically the output of
    `deno doc <entry>` (machine-specific `Defined in …` lines are stripped for
    you). Produced by the caller, so this package never has to run `deno`.

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
  guidance?: string[]
    Extra bullet lines appended to the "do not guess" list.
  cli?: string
    An optional pre-rendered markdown block describing the `zuke` command
    surface, rendered under a `## CLI` heading in the index. The caller builds
    it (e.g. from the build's command/flag registry) so this package stays
    agnostic about CLI specifics.
````

</details>

<!-- ZUKE:API:END -->

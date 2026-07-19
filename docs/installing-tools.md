# Installing tools

A Zuke build can **fetch the command-line tools it drives** rather than assume
they are already installed on the machine. That makes a build **hermetic** — a
fresh clone or a bare CI runner has everything it needs — and **reproducible**:
versions are pinned, downloads are verified, and every machine runs the same
binary.

Tools are provisioned in Zuke's fluent settings-lambda style — the same
`(s) => s.method(...)` shape the [tool wrappers](./tools.md) use — through two
entry points in `@zuke/core`:

| API                                                          | Installs      | Reach for it when                    |
| ------------------------------------------------------------ | ------------- | ------------------------------------ |
| [`ToolTasks.install((s) => …)`](#tooltasksinstall--one-tool) | one binary    | you need a single release binary     |
| [`toolchain()`](#toolchain--many-tools)                      | many tools    | a build depends on several tools     |
| [`ToolTasks.npm(...)` / `.npm(...)`](#npm-package-tools)      | an npm package | the tool ships on the npm registry   |

Both return the installed binary's [`AbsolutePath`](./paths.md); hand it to a
**[wrapper](./tools.md)** (`.toolPath(...)`), to `CmdTasks`, or to `defineTool`
— see [Working with an installed tool](#working-with-an-installed-tool).

> This page is about **acquiring** tool binaries. For the typed `*Tasks`
> wrappers that **run** them (and the full package catalog), see
> [Tools](./tools.md).

## Why install tools from the build

- **No "install these first" prose.** The build file _is_ the setup — nothing to
  document in a README, nothing to forget on a new laptop.
- **Pinned and verified.** A `checksum` ties the build to an exact artifact and
  fails loudly if the download is corrupt or tampered with.
- **CI equals local.** The same fetch runs everywhere; no separate "setup tool
  X" CI step that drifts from what developers use.
- **Cached.** A pinned tool is downloaded once and reused, so provisioning adds
  no ongoing cost.

## `ToolTasks.install()` — one tool

`ToolTasks.install((s) => …)` fetches a single tool, configured through a
`ToolInstallSettings` lambda, and resolves to the installed binary's path.

```ts
import { ToolTasks } from "jsr:@zuke/core";
import { CmdTasks } from "jsr:@zuke/cmd";

const bin = await ToolTasks.install((s) =>
  s
    .name("codecov")
    .destDir(".zuke/bin")
    // `p.os` is "linux" | "macos" | "windows" — exactly Codecov's dir names.
    .url((p) => `https://cli.codecov.io/latest/${p.os}/codecov`)
);
await CmdTasks.exec(String(bin), (s) => s.args("--version"));
```

### Settings

| Method                       | Purpose                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `.name(name)`                | The tool name, and the installed filename (`.exe` is appended on Windows). **Required.**                           |
| `.url((platform) => string)` | Resolve the download URL for the target platform (see [platforms](#cross-platform-url-resolution)). **Required.**  |
| `.destDir(dir)`              | Directory to install into (created if missing). Defaults to `.zuke/tools`.                                         |
| `.archive("tar.gz")`         | Unpack a gzipped tarball; the default `"raw"` treats the download as the binary.                                   |
| `.binaryPath(path)`          | For a `tar.gz`, the binary's path _inside_ the archive. Defaults to the name.                                      |
| `.checksum(sha256)`          | Expected SHA-256, or a `(platform) => string` resolver — [verifies and caches](#pinning-verification-and-caching). |
| `.platform({ os, arch })`    | Resolve for a specific platform instead of the host.                                                               |
| `.download(fn)`              | Override the downloader (defaults to an HTTPS download); mainly a test seam.                                       |

### Raw binaries vs. tarballs

- **`"raw"`** (default) — the URL points straight at the executable; it's saved
  as `<destDir>/<name>` and `chmod +x`'d.
- **`.archive("tar.gz")`** — the URL points at a gzipped tarball; Zuke unpacks
  it to a scratch directory, copies `.binaryPath(...)` (default the name) out to
  `<destDir>/<name>`, then discards the scratch. Set `.binaryPath(...)` when the
  binary lives in a subdirectory of the archive (e.g. Helm ships it under
  `linux-amd64/helm`).

Zip archives are not yet supported, so this targets the Unix runners where most
release tarballs are published. On Windows the installed filename gains an
`.exe` suffix and the executable bit is skipped.

## Pinning, verification, and caching

Set a **`.checksum(...)`** — the lowercase-hex **SHA-256** that release pages
publish — and it does three jobs at once:

1. **Pins** the build to an exact artifact.
2. **Verifies** the download: the fetched bytes are hashed and compared _before_
   anything is installed. A mismatch throws

   ```
   checksum mismatch for "helm": expected f43e1c3…, got 9a2b0e1….
   The download may be corrupt or tampered with; nothing was installed.
   ```

   and leaves nothing behind (a `raw` binary that fails is removed). A value
   that isn't a 64-character hex SHA-256 is rejected up front with a clear
   error, before any download.
3. **Caches** the install: a sidecar marker (`<destDir>/<name>.install.json`)
   records the checksum and the installed binary's own hash. A later run is a
   **cache hit that skips the download** only when the pin matches _and_ the
   binary on disk still hashes to what was installed — so a swapped or corrupted
   binary (e.g. in a cache directory shared across trust boundaries) is
   re-downloaded and re-verified, never silently reused. Bumping the checksum
   for a new version is a natural miss that re-fetches.

What the checksum covers depends on the format: for `"tar.gz"` it's the SHA-256
of the **archive** (what projects list in their `checksums.txt`/`sha256sum`
files); for `"raw"` it's the SHA-256 of the **binary** itself.

Without a checksum, the tool is downloaded every run and left unverified — fine
for a quick spike, but pin one for anything real.

> **Checksums are per-artifact, so they're per-platform.** `.url(...)` resolves
> a _different_ download for each OS/arch, and each has its own hash. When a
> build runs on more than one platform, pass `.checksum(...)` a resolver — just
> like `.url(...)` — so the right hash is picked for whatever's downloaded:
>
> ```ts
> const sums: Record<string, string> = {
>   "linux-x86_64": "…",
>   "linux-aarch64": "…",
>   "macos-aarch64": "…",
> };
> await ToolTasks.install((s) =>
>   s.name("helm").url(helmUrl).checksum(({ os, arch }) => sums[`${os}-${arch}`])
> );
> ```
>
> A plain string is the shorthand when a single artifact is installed.

### Where installed tools live

Everything lands under the `.destDir(...)` you choose — conventionally
`.zuke/bin` for a one-off and `.zuke/tools` (the default) for a
[`toolchain()`](#toolchain--many-tools). The `.zuke/` directory is git-ignored,
so installed binaries and their `.install.json` markers are never committed.

## `toolchain()` — many tools

When a build needs several tools, `toolchain()` declares them in one place so
the build file fully describes its environment. Add tools with `.tool((s) => …)`
(the same settings-lambda), then `install()` fetches them all **concurrently** —
pinned, verified, and cached — and returns a `Map<name, AbsolutePath>`.

```ts
import { Build, target, toolchain } from "jsr:@zuke/core";
import { HelmTasks } from "jsr:@zuke/helm";
import { KubectlTasks } from "jsr:@zuke/kubectl";

const arches = { x86_64: "amd64", aarch64: "arm64" } as const;

class Deploy extends Build {
  tools = toolchain((t) =>
    t
      .tool((s) =>
        s
          .name("helm")
          .archive("tar.gz")
          .binaryPath(`linux-${arches[Deno.build.arch]}/helm`)
          .checksum(helmSum)
          .url(({ arch }) =>
            `https://get.helm.sh/helm-v3.15.2-linux-${arches[arch]}.tar.gz`
          )
      )
      .tool((s) =>
        s
          .name("kubectl")
          .checksum(kubectlSum)
          .url(({ arch }) =>
            `https://dl.k8s.io/release/v1.30.2/bin/linux/${
              arches[arch]
            }/kubectl`
          )
      )
  );

  deploy = target().executes(async () => {
    const bin = await this.tools.install();
    await HelmTasks.version((s) => s.toolPath(bin.get("helm")));
    await KubectlTasks.version((s) => s.toolPath(bin.get("kubectl")));
  });
}
```

- **Install directory.** Tools default to `.zuke/tools` (the exported
  `DEFAULT_TOOLS_DIR`). Override it for all tools with `install({ destDir })`,
  or for a single tool with `.destDir(...)` on its settings.
- **Custom downloader.** `install({ download })` swaps the downloader for every
  tool — a test seam — and a per-tool `.download(...)` applies when the
  toolchain sets none.
- **Introspection.** `chain.tools` returns the configured release settings in
  order; `chain.npmTools` the [npm-package tools](#npm-package-tools).
- **Cheap to re-run.** Because a matching checksum is a cache hit, calling
  `install()` again (locally or on CI) is a no-op once the tools are present.

Build a toolchain inline with the callback shown above, or by chaining:

```ts
const tools = toolchain()
  .tool((s) => s.name("helm").url(helmUrl))
  .tool((s) => s.name("kubectl").url(kubectlUrl));
```

## npm-package tools

Not every tool ships a release binary — many (`vitest`, `dprint`,
`@nestjs/cli`, …) are published on the **npm registry**. `Toolchain.npm(...)`
provisions one as a version-pinned, cached tool without an ambient `npm ci`:

```ts
import { Build, target, toolchain } from "jsr:@zuke/core";
import { VitestTasks } from "jsr:@zuke/vitest";

class Test extends Build {
  tools = toolchain((t) => t.npm({ name: "vitest", version: "4.1.9" }));

  test = target().executes(async () => {
    const bins = await this.tools.install();
    await VitestTasks.run((s) => s.toolPath(bins.get("vitest")));
  });
}
```

Each package installs under `<destDir>/npm/<name>@<version>` via
`npm install --prefix <dir> --no-save <name>@<version>`, and `install()` returns
its bin under the same `Map<name, AbsolutePath>` as the release tools. For a
one-off outside a toolchain, `ToolTasks.npm(spec, options?)` (or the underlying
`installNpmTool`) does the same for a single package.

- **npm is the one ambient requirement.** It resolves and downloads the package;
  everything else is Zuke's. Nothing else needs to be on `PATH`.
- **Pinned and cached.** A marker file records the `{ name, version }`, so a
  later `install()` whose marker matches — and whose bin is still present — skips
  npm entirely.
- **Different bin name.** When a package's bin differs from its name, set `bin`:
  `{ name: "@nestjs/cli", version: "10.4.0", bin: "nest" }` resolves the `nest`
  bin.
- **Hermetic pins compose with `node_modules` resolution.** An explicit
  `.toolPath(bins.get(...))` always wins over
  [`node_modules/.bin` resolution](./tools.md#resolving-from-node_modulesbin),
  so a `toolchain()` pin stays authoritative even inside a Node workspace.

## Working with an installed tool

Both `ToolTasks.install` and `toolchain().install()` hand you an `AbsolutePath`.
Point a tool at it three ways:

```ts
import { HelmTasks } from "jsr:@zuke/helm";
import { CmdTasks } from "jsr:@zuke/cmd";
import { defineTool } from "jsr:@zuke/core/tooling";

const bin = await ToolTasks.install((s) => s.name("helm").url(helmUrl));

// 1. A typed wrapper — pass the path to .toolPath(...)
await HelmTasks.template((s) => s.toolPath(bin).args("./chart"));

// 2. The generic CmdTasks fallback
await CmdTasks.exec(String(bin), (s) => s.args("version"));

// 3. A one-off typed tool bound to the installed path
const helm = defineTool(String(bin));
await helm((s) => s.arg("version"));
```

`AbsolutePath` stringifies to the path, so `String(bin)` (or `bin.path`) works
anywhere a string is expected. See [Tools](./tools.md) for the full wrapper
catalog and `defineTool`.

## Cross-platform URL resolution

The `.url(...)` (and `.checksum(...)`) callback receives a `Platform`. Its `os`
is a **Zuke `OperatingSystem`** — the union `"linux" | "macos" | "windows"`,
normalised from Deno's raw values (`darwin` → `macos`) — so the common case
needs no mapping at all. `osLabel`/`archLabel` remain for tools that spell
things differently, and there's no `os === "darwin" ? …` ternary in sight:

```ts
type OperatingSystem = "linux" | "macos" | "windows";
type Architecture = "x86_64" | "aarch64";

interface Platform {
  os: OperatingSystem;
  arch: Architecture;
  osLabel(aliases?: Partial<Record<OperatingSystem, string>>): string;
  archLabel(aliases?: Partial<Record<Architecture, string>>): string;
}
```

`osLabel`/`archLabel` map the os/arch to a tool's naming, **falling back to the
value itself** for anything not aliased — so you only list the differences.
Helm, for example, spells macOS `darwin` and uses `amd64`/`arm64`:

```ts
// helm-v3.15.2-darwin-arm64.tar.gz on an Apple Silicon Mac, etc.
s.url((p) =>
  `https://get.helm.sh/helm-v3.15.2-${p.osLabel({ macos: "darwin" })}-${
    p.archLabel({ x86_64: "amd64", aarch64: "arm64" })
  }.tar.gz`
);
```

By default the callback reflects the host; set `.platform({ os, arch })` to
resolve a foreign one (e.g. to pre-stage a Linux binary from a Mac). Outside a
callback, **`hostPlatform()`** returns the same `Platform` for the running
machine, and **`operatingSystem()`** returns just the OS union — the
counterparts of `isCI()` for "what am I running on":

```ts
import { hostPlatform, operatingSystem } from "jsr:@zuke/core";

if (operatingSystem() === "macos") { /* … */ }
const cpu = hostPlatform().archLabel({ x86_64: "amd64", aarch64: "arm64" });
```

## On CI

The [`./zuke` launcher](./getting-started.md) bootstraps Deno, and the build
fetches its tools on demand inside the target that needs them — so a CI job
needs no "set up tool X" step:

```yaml
steps:
  - uses: actions/checkout@v4
  - run: ./zuke deploy # installs helm + kubectl on first use, then runs
```

- **Egress.** If the runner restricts network egress, allow the tools' download
  hosts (e.g. `get.helm.sh`, `dl.k8s.io`) alongside Deno's.
- **Re-downloads.** An ephemeral runner starts with an empty `.zuke/`, so tools
  are fetched each run — safe and verified thanks to the checksum. To skip the
  download, persist the install directory between runs (e.g. `actions/cache`
  keyed on the tool versions/checksums).

## Security

- **Pin a `.checksum(...)`.** It makes the download tamper-evident; an unpinned
  install trusts whatever the URL serves.
- **Get the hash from the source.** Use the SHA-256 the project publishes (a
  release `checksums.txt`, `*.sha256`, or the GitHub release assets), and match
  it to the exact artifact your platform downloads.
- **Restrict egress** on CI to the hosts a build legitimately fetches from, so a
  compromised URL can't pull an arbitrary binary.

## Troubleshooting

| Symptom                                                  | Likely cause & fix                                                                                                                                                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checksum mismatch … expected X, got Y`                  | The pin doesn't match the downloaded bytes. Confirm you used the hash for **this platform's** artifact (they differ per OS/arch), and that the version in the URL matches the version the checksum came from.       |
| `invalid checksum … expected a 64-character hex SHA-256` | The checksum isn't a well-formed SHA-256 — a typo, a truncated value, a different algorithm, or a per-platform resolver that returned nothing for the current OS/arch. Supply the 64-hex SHA-256 for this platform. |
| `a tool install requires .name(...)` / `.url(...)`       | A settings-lambda didn't set a required field. Every tool needs `.name(...)` and `.url(...)`.                                                                                                                       |
| The install "works" but the tool is a different version  | No checksum, so a stale cached binary from a previous `destDir` may be in use — pin a checksum (the version bump becomes a cache miss) or clear `.zuke/`.                                                           |
| `No such file` when copying from a `tar.gz`              | `.binaryPath(...)` doesn't match the archive layout. Unpack the tarball locally to see where the binary sits (e.g. `linux-amd64/helm`).                                                                             |
| Wrapper still reports the tool missing                   | Pass the returned path to `.toolPath(String(bin))` — without it, the wrapper looks on `PATH`.                                                                                                                       |

## The `installRelease` primitive

`ToolTasks.install` and `toolchain()` are built on
**`installRelease(options)`**, the lower-level function that takes the same
fields as a plain options object
(`{ name, url, destDir, archive?, binaryPath?, checksum?, platform?, download? }`)
and returns the installed `AbsolutePath`. Reach for the fluent surface above in
a build; use `installRelease` directly if you already have an options object in
hand.

## API reference

The exact signatures live in the generated [`llms-full.txt`](../llms-full.txt)
and on the [`@zuke/core` JSR page](https://jsr.io/@zuke/core): `ToolTasks`,
`ToolInstallSettings`, `toolchain`, `Toolchain`, `ToolchainInstallOptions`,
`DEFAULT_TOOLS_DIR`, `installRelease`, `InstallReleaseOptions`,
`InstallPlatform`, and `hostPlatform`.

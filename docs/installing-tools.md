# Installing tools

A Zuke build can **fetch the command-line tools it drives** rather than assume
they are already installed on the machine. That makes a build **hermetic** — a
fresh clone or a bare CI runner has everything it needs — and **reproducible**:
versions are pinned, downloads are verified, and every machine runs the same
binary.

There are two entry points, both in `@zuke/core`:

| API                                             | Installs   | Reach for it when                |
| ----------------------------------------------- | ---------- | -------------------------------- |
| [`installRelease()`](#installrelease--one-tool) | one tool   | you need a single binary         |
| [`toolchain()`](#toolchain--many-tools)         | many tools | a build depends on several tools |

Once a tool is installed you get its path and hand it to a
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

## `installRelease()` — one tool

`installRelease(options)` resolves a per-platform download URL, fetches it,
optionally unpacks it, marks it executable, and returns the installed binary's
[`AbsolutePath`](./paths.md).

```ts
import { installRelease } from "jsr:@zuke/core";
import { CmdTasks } from "jsr:@zuke/cmd";

const bin = await installRelease({
  name: "codecov",
  destDir: ".zuke/bin",
  url: ({ os }) => {
    const platform = os === "darwin"
      ? "macos"
      : os === "windows"
      ? "windows"
      : "linux";
    return `https://cli.codecov.io/latest/${platform}/codecov`;
  },
});
await CmdTasks.exec(String(bin), (s) => s.args("--version"));
```

### Options

| Field        | Type                           | Purpose                                                                                               |
| ------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `name`       | `string`                       | The tool name, and the installed filename (`.exe` is appended on Windows).                            |
| `url`        | `(platform) => string`         | Resolve the download URL for the target platform (see [platforms](#cross-platform-url-resolution)).   |
| `destDir`    | `PathLike`                     | Directory to install into (created if missing). Relative paths resolve against the working directory. |
| `archive`    | `"raw"` \| `"tar.gz"`          | `"raw"` (default) treats the download as the binary; `"tar.gz"` unpacks it.                           |
| `binaryPath` | `string`                       | For a `tar.gz`, the binary's path _inside_ the archive. Defaults to `name`.                           |
| `checksum`   | `string`                       | Expected SHA-256 of the download — [verifies and caches](#pinning-verification-and-caching).          |
| `platform`   | `InstallPlatform`              | Resolve the URL for a specific `{ os, arch }` instead of the host.                                    |
| `download`   | `(url, dest) => Promise<void>` | Override the downloader (defaults to `httpDownload`); mainly a test seam.                             |

### Raw binaries vs. tarballs

- **`"raw"`** (default) — the URL points straight at the executable; it's saved
  as `<destDir>/<name>` and `chmod +x`'d.
- **`"tar.gz"`** — the URL points at a gzipped tarball; Zuke unpacks it to a
  scratch directory, copies `binaryPath` (default `name`) out to
  `<destDir>/<name>`, then discards the scratch. Set `binaryPath` when the
  binary lives in a subdirectory of the archive (e.g. Helm ships it under
  `linux-amd64/helm`).

Zip archives are not yet supported, so this targets the Unix runners where most
release tarballs are published. On Windows the installed filename gains an
`.exe` suffix and the executable bit is skipped.

## Pinning, verification, and caching

Pass a **`checksum`** — the lowercase-hex **SHA-256** that release pages publish
— and it does three jobs at once:

1. **Pins** the build to an exact artifact.
2. **Verifies** the download: the fetched bytes are hashed and compared _before_
   anything is installed. A mismatch throws

   ```
   checksum mismatch for "helm": expected f43e1c3…, got 9a2b0e1….
   The download may be corrupt or tampered with; nothing was installed.
   ```

   and leaves nothing behind (a `raw` binary that fails is removed).
3. **Caches** the install: the verified checksum is written to a sidecar marker
   (`<destDir>/<name>.sha256`), so a later run whose pin matches the marker (and
   whose binary still exists) is a **cache hit that skips the download
   entirely**. Bumping the checksum for a new version is a natural miss that
   re-fetches and rewrites the marker.

What the checksum covers depends on the format: for `"tar.gz"` it's the SHA-256
of the **archive** (what projects list in their `checksums.txt`/`sha256sum`
files); for `"raw"` it's the SHA-256 of the **binary** itself.

Without a `checksum`, the tool is downloaded every run and left unverified —
fine for a quick spike, but pin one for anything real.

> **Checksums are per-artifact, so they're per-platform.** `url` resolves a
> _different_ download for each OS/arch, and each has its own hash. If your
> build runs on more than one platform, select the checksum the same way you
> select the URL:
>
> ```ts
> const key = `${Deno.build.os}-${Deno.build.arch}`;
> const sums: Record<string, string> = {
>   "linux-x86_64": "…",
>   "linux-aarch64": "…",
>   "darwin-aarch64": "…",
> };
> await installRelease({
>   name: "helm",
>   checksum: sums[key],
>   url: helmUrl, /* … */
> });
> ```

### Where installed tools live

Everything lands under the `destDir` you choose — conventionally `.zuke/bin` for
`installRelease` and `.zuke/tools` for a
[`toolchain()`](#toolchain--many-tools). The `.zuke/` directory is git-ignored,
so installed binaries and their `.sha256` markers are never committed.

## `toolchain()` — many tools

When a build needs several tools, `toolchain()` declares them in one place so
the build file fully describes its environment. Add tools with `.tool(spec)`
(each an `installRelease` spec), then `install()` fetches them all
**concurrently** — pinned, verified, and cached — and returns a
`Map<name, AbsolutePath>`.

```ts
import { Build, target, toolchain } from "jsr:@zuke/core";
import { HelmTasks } from "jsr:@zuke/helm";
import { KubectlTasks } from "jsr:@zuke/kubectl";

const arches = { x86_64: "amd64", aarch64: "arm64" } as const;

class Deploy extends Build {
  tools = toolchain((t) =>
    t
      .tool({
        name: "helm",
        archive: "tar.gz",
        binaryPath: `linux-${arches[Deno.build.arch]}/helm`,
        checksum: helmSum,
        url: ({ arch }) =>
          `https://get.helm.sh/helm-v3.15.2-linux-${arches[arch]}.tar.gz`,
      })
      .tool({
        name: "kubectl",
        checksum: kubectlSum,
        url: ({ arch }) =>
          `https://dl.k8s.io/release/v1.30.2/bin/linux/${arches[arch]}/kubectl`,
      })
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
  or for a single tool with `destDir` on its spec.
- **Custom downloader.** `install({ download })` swaps the downloader for every
  tool — a test seam, mirroring `installRelease`.
- **Introspection.** `chain.tools` returns the declared specs in order.
- **Cheap to re-run.** Because a matching checksum is a cache hit, calling
  `install()` again (locally or on CI) is a no-op once the tools are present.

You can build a toolchain inline with the callback shown above, or by chaining:

```ts
const tools = toolchain().tool(helmSpec).tool(kubectlSpec);
```

## Working with an installed tool

`installRelease` and `toolchain().install()` hand you an `AbsolutePath`. Point a
tool at it three ways:

```ts
import { HelmTasks } from "jsr:@zuke/helm";
import { CmdTasks } from "jsr:@zuke/cmd";
import { defineTool } from "jsr:@zuke/core/tooling";

const bin = await installRelease({ name: "helm" /* … */ });

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

The `url` (and `platform`) callback receives an `InstallPlatform`:

```ts
interface InstallPlatform {
  os: typeof Deno.build.os; // "linux" | "darwin" | "windows" | …
  arch: typeof Deno.build.arch; // "x86_64" | "aarch64"
}
```

By default it reflects the host (`hostPlatform()`); pass `platform` to resolve a
foreign one (e.g. to pre-stage a Linux binary from a Mac). Most tools name their
artifacts with their own conventions, so map Zuke's values to theirs:

```ts
const os = { darwin: "darwin", linux: "linux", windows: "windows" } as const;
const arch = { x86_64: "amd64", aarch64: "arm64" } as const;
url: ((p) => `https://example.com/tool-${os[p.os]}-${arch[p.arch]}.tar.gz`);
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

- **Pin a `checksum`.** It makes the download tamper-evident; an unpinned
  install trusts whatever the URL serves.
- **Get the hash from the source.** Use the SHA-256 the project publishes (a
  release `checksums.txt`, `*.sha256`, or the GitHub release assets), and match
  it to the exact artifact your platform downloads.
- **Restrict egress** on CI to the hosts a build legitimately fetches from, so a
  compromised URL can't pull an arbitrary binary.

## Troubleshooting

| Symptom                                                 | Likely cause & fix                                                                                                                                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checksum mismatch … expected X, got Y`                 | The pin doesn't match the downloaded bytes. Confirm you used the hash for **this platform's** artifact (they differ per OS/arch), and that the version in the URL matches the version the checksum came from. |
| The install "works" but the tool is a different version | No `checksum`, so a stale cached binary from a previous `destDir` may be in use — pin a checksum (the version bump becomes a cache miss) or clear `.zuke/`.                                                   |
| `No such file` when copying from a `tar.gz`             | `binaryPath` doesn't match the archive layout. Unpack the tarball locally to see where the binary sits (e.g. `linux-amd64/helm`).                                                                             |
| Zip download fails to unpack                            | Only `raw` and `tar.gz` are supported today. For a `.zip`-only release, download the raw binary if one is published, or unpack it yourself in the target.                                                     |
| Wrapper still reports the tool missing                  | Pass the returned path to `.toolPath(String(bin))` — without it, the wrapper looks on `PATH`.                                                                                                                 |

## API reference

The exact signatures live in the generated [`llms-full.txt`](../llms-full.txt)
and on the [`@zuke/core` JSR page](https://jsr.io/@zuke/core): `installRelease`,
`InstallReleaseOptions`, `InstallPlatform`, `hostPlatform`, `toolchain`,
`Toolchain`, `ToolSpec`, `ToolchainInstallOptions`, and `DEFAULT_TOOLS_DIR`.

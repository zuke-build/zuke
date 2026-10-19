# Installing the `zuke` command

<!-- cspell:ignore slsaprovenance spctl -->

The global `zuke` command (`@zuke/cli`) scaffolds projects (`zuke setup`,
`zuke import`), shows package docs (`zuke doc`), and forwards everything else to
the build of the project you are in. There are three supported ways to install
it. All of them install the same program, from the same release.

A machine without the CLI — a CI runner — can still run a project's build: the
committed `./zuke` launcher (`.\zuke.ps1` on Windows) that `zuke setup` writes
bootstraps a pinned, checksum-verified Deno on its own.

## From JSR (recommended)

```sh
deno install -A -g -n zuke jsr:@zuke/cli
```

This needs [Deno](https://deno.com/) 2.x. The CLI runs on the Deno you already
have, and `zuke upgrade` moves it to the latest release, or to a given one.

## With Homebrew (macOS and Linux)

```sh
brew install zuke-build/tap/zuke
```

This installs a standalone binary, so it needs **no Deno up front**.
`zuke setup` runs right away, and the `./zuke` launcher it writes installs Deno
the first time the build runs; from then on `zuke <target>` forwards to that
Deno. Upgrade with `brew upgrade zuke`. `zuke upgrade` refuses to run from a
Homebrew install, because reinstalling from JSR would leave this one as it was.

The binaries are built for Apple silicon and Intel Macs, and for arm64 and
x86_64 Linux.

## With Chocolatey (Windows)

```powershell
choco install zuke
```

The same standalone binary for x86_64 Windows, installed from the release's
`.zip` with its SHA-256 checked against the one the package pins. It needs **no
Deno up front**, exactly as the Homebrew binary does. Upgrade with
`choco upgrade zuke`; `zuke upgrade` refuses to run from a Chocolatey install,
for the same reason as from Homebrew.

> [!IMPORTANT]
> `zuke.exe` is **not Authenticode-signed yet**, so Windows SmartScreen may warn
> the first time it runs. Signing is on its way (see the
> [code signing policy](#code-signing-policy)). Until then, the checksum and the
> build-provenance attestation in [Verifying a download](#verifying-a-download)
> are what prove the binary is the one Zuke's release built. If you would rather
> not run an unsigned executable, install from JSR instead.

## Which one am I running?

They can be installed side by side. On a terminal, `zuke --version` names the
install that answered:

```text
┌ zuke ──────────────────────────────────────────────────────────────┐
│ ◆ cli       1.14.0                                                 │
│ ◆ install   Homebrew (/opt/homebrew/Cellar/zuke/1.14.0/bin/zuke)   │
│ ◆ deno      2.8.3                                                  │
│ ◆ platform  darwin-aarch64                                         │
└────────────────────────────────────────────────────────────────────┘
```

The row reads `JSR (jsr:@zuke/cli@…)`, `Homebrew (…)`, `Chocolatey (…)`,
`standalone binary (…)` (a binary installed some other way), or `source (…)` (a
local checkout). Piped or under `--plain`, `zuke --version` prints only the bare
version, for scripts.

## Verifying a download

Every binary release, `cli-v<version>` on the
[releases page](https://github.com/zuke-build/zuke/releases), carries:

| Asset                                       | What it is                                                      |
| ------------------------------------------- | --------------------------------------------------------------- |
| `zuke-<version>-<target>.tar.gz`            | The macOS or Linux binary, alone, as `zuke` (mode `0755`)       |
| `zuke-<version>-x86_64-pc-windows-msvc.zip` | The Windows binary, alone, as `zuke.exe`                        |
| `SHA256SUMS`                                | The SHA-256 of every archive, in `sha256sum --check` format     |
| `zuke-<version>.sigstore.json`              | The build-provenance attestation covering the archives and sums |

Homebrew and Chocolatey check the SHA-256 they pin for each archive on every
install. To verify a download yourself:

```sh
# The archive is one the release lists, byte for byte:
sha256sum --ignore-missing --check SHA256SUMS

# It was built by Zuke's release workflow, from this repository — the
# attestation is signed through Sigstore with the workflow's own identity:
gh attestation verify zuke-1.14.0-x86_64-unknown-linux-gnu.tar.gz \
  --repo zuke-build/zuke \
  --signer-workflow zuke-build/zuke/.github/workflows/release.yml \
  --source-ref refs/heads/master
```

Without the GitHub CLI, the published bundle verifies with
[cosign](https://docs.sigstore.dev/cosign/) 2.4 or later instead:

```sh
cosign verify-blob-attestation \
  --bundle zuke-1.14.0.sigstore.json \
  --new-bundle-format \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity 'https://github.com/zuke-build/zuke/.github/workflows/release.yml@refs/heads/master' \
  --type slsaprovenance1 \
  zuke-1.14.0-x86_64-unknown-linux-gnu.tar.gz
```

The macOS binaries are also signed with Zuke's Developer ID under the hardened
runtime and notarized by Apple. After extracting one:

```sh
codesign --verify --strict --verbose=2 zuke
codesign --display --verbose=4 zuke 2>&1 | grep Authority   # Developer ID Application: …
spctl --assess --type execute --verbose zuke                # source=Notarized Developer ID
```

On Windows, the same checks in PowerShell, with the GitHub CLI:

```powershell
(Get-FileHash zuke-1.15.0-x86_64-pc-windows-msvc.zip).Hash   # compare with SHA256SUMS
gh attestation verify zuke-1.15.0-x86_64-pc-windows-msvc.zip `
  --repo zuke-build/zuke `
  --signer-workflow zuke-build/zuke/.github/workflows/release.yml `
  --source-ref refs/heads/master
```

How the release is built — compiled from the published `jsr:@zuke/cli`, signed
and notarized on a macOS runner, attested, then checked with a real
`brew install` on macOS and Linux and a real `choco install` on Windows before
the formula and the package are published — is in
[`build/cli_release.ts`](../build/cli_release.ts) and the `cli*` jobs of
[`release.yml`](../.github/workflows/release.yml).

## Code signing policy

The Windows binary is **not Authenticode-signed yet**. Zuke has applied to the
[SignPath Foundation](https://signpath.org)'s programme for open-source
projects, which provides free code signing through
[SignPath.io](https://about.signpath.io). Until a signing service is in place,
`zuke.exe` ships unsigned, and the checksum and build-provenance attestation
above are what vouch for it.

Once signing is in place, the policy is this: only the release workflow on
`master` submits a signing request, and the signing service checks that the
artifact came from that workflow run before it signs anything.

Team roles:

- **Committers and reviewers:**
  [members of the zuke-build organization](https://github.com/orgs/zuke-build/people)
  with write access to [`zuke-build/zuke`](https://github.com/zuke-build/zuke).
  Every change reaches `master` through a reviewed pull request.
- **Approvers:** [@totollygeek](https://github.com/totollygeek), who approves
  each release's signing request.

Privacy: this program will not transfer any information to other networked
systems unless specifically requested by the user or the person installing or
operating it. The `zuke` CLI collects no telemetry. It reaches the network only
for what you ask of it: `zuke upgrade` reads the latest release from JSR, and a
build downloads Deno and the packages it imports, plus whatever its own targets
call.

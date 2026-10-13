# Installing the `zuke` command

<!-- cspell:ignore slsaprovenance spctl -->

The global `zuke` command (`@zuke/cli`) scaffolds projects (`zuke setup`,
`zuke import`), shows package docs (`zuke doc`), and forwards everything else to
the build of the project you are in. There are two supported ways to install it.
Both install the same program, from the same release.

You do not need either one to _run_ a project's build: `./zuke` (or
`.\zuke.ps1`) in a scaffolded project bootstraps a pinned, checksum-verified
Deno on its own.

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
`zuke
setup` runs right away, and the `./zuke` launcher it writes installs Deno
the first time the build runs; from then on `zuke <target>` forwards to that
Deno. Upgrade with `brew upgrade zuke`. `zuke upgrade` refuses to run from a
Homebrew install, because reinstalling from JSR would leave this one as it was.

The binaries are built for Apple silicon and Intel Macs, and for arm64 and
x86_64 Linux.

## Which one am I running?

Both can be installed side by side. On a terminal, `zuke --version` names the
install that answered:

```text
┌ zuke ──────────────────────────────────────────────────────────────┐
│ ◆ cli       1.14.0                                                 │
│ ◆ install   Homebrew (/opt/homebrew/Cellar/zuke/1.14.0/bin/zuke)   │
│ ◆ deno      2.8.3                                                  │
│ ◆ platform  darwin-aarch64                                         │
└────────────────────────────────────────────────────────────────────┘
```

The row reads `JSR (jsr:@zuke/cli@…)`, `Homebrew (…)`, `standalone binary (…)`
(a binary installed some other way), or `source (…)` (a local checkout). Piped
or under `--plain`, `zuke --version` prints only the bare version, for scripts.

## Verifying a download

Every binary release, `cli-v<version>` on the
[releases page](https://github.com/zuke-build/zuke/releases), carries:

| Asset                            | What it is                                                      |
| -------------------------------- | --------------------------------------------------------------- |
| `zuke-<version>-<target>.tar.gz` | The binary, alone, as `zuke` (mode `0755`)                      |
| `SHA256SUMS`                     | The SHA-256 of every archive, in `sha256sum --check` format     |
| `zuke-<version>.sigstore.json`   | The build-provenance attestation covering the archives and sums |

Homebrew checks the SHA-256 it pins for each archive on every install. To verify
a download yourself:

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

How the release is built — compiled from the published `jsr:@zuke/cli`, signed
and notarized on a macOS runner, attested, then checked with a real
`brew install` on macOS and Linux before the formula is published — is in
[`build/cli_release.ts`](../build/cli_release.ts) and the `cli*` jobs of
[`release.yml`](../.github/workflows/release.yml).

## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io),
certificate by [SignPath Foundation](https://signpath.org).

The Windows binary is Authenticode-signed through the SignPath Foundation's
programme for open-source projects. Only the release workflow on `master`
submits a signing request, and SignPath checks that the artifact came from that
workflow run before it signs anything.

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

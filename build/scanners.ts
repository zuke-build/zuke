/**
 * The supply-chain scanners behind the `security` target, declared as pinned
 * toolchain entries so the build provisions them itself.
 *
 * This exists so the security workflow needs **no install step**. It used to
 * run `pipx install zizmor`, `go install actionlint`, and `go install gitleaks`
 * and then patch `$GITHUB_PATH` — six lines of YAML that only CI had, so
 * `./zuke security` could not run locally and had to stay out of the `ci` gate.
 * Declaring each scanner here makes the build describe its own environment: the
 * binary is fetched on demand, verified against a pinned SHA-256, and cached
 * (see {@link "jsr:@zuke/core".installRelease}), on a laptop exactly as on a runner.
 *
 * Every entry pins an exact version and every artifact's hash. A bump is a
 * deliberate edit here: change the version, then re-record the checksums from
 * the release's published checksum file (zizmor publishes none, so its hashes
 * are recorded from the downloaded artifacts).
 *
 * @module
 */

import type { Platform, ToolInstallSettings } from "@zuke/core";

/** The pinned `zizmor` version (GitHub Actions workflow static analysis). */
export const ZIZMOR_VERSION = "1.25.2";

/** The pinned `actionlint` version (workflow YAML and embedded shell linting). */
export const ACTIONLINT_VERSION = "1.7.12";

/** The pinned `gitleaks` version (committed-secret scanning). */
export const GITLEAKS_VERSION = "8.30.1";

/**
 * SHA-256 of each pinned `zizmor` artifact, keyed by its cargo-dist target
 * triple. zizmor publishes no checksum file, so these are recorded from the
 * downloaded artifacts.
 */
const ZIZMOR_SHA256: Record<string, string> = {
  "x86_64-unknown-linux-gnu":
    "aa1facd105f0d83fe5c55b1adcd9d7417de5d83aa27471f91dc0b66cf3803577",
  "aarch64-unknown-linux-gnu":
    "4b4b9491112c2a09b318101c0d3349b73af1c4f532e097dd6d0164f2abda760d",
  "x86_64-apple-darwin":
    "353271b9ec301dd4ba158af481323c831c6e9b494d5ac3f5aa58cf4b207699cc",
  "aarch64-apple-darwin":
    "624ef0e09521aecd862126be0f6d7754669af2646750d68ac48a114be33c3146",
  "x86_64-pc-windows-msvc":
    "65d46a8144f701200621b580f632076d80d082d60856de9f88793a95fb5882d7",
};

/**
 * SHA-256 of each pinned `actionlint` artifact, keyed by its `os_arch` asset
 * suffix, from `actionlint_1.7.12_checksums.txt`.
 */
const ACTIONLINT_SHA256: Record<string, string> = {
  linux_amd64:
    "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8",
  linux_arm64:
    "325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6",
  darwin_amd64:
    "5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644",
  darwin_arm64:
    "aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f",
  windows_amd64:
    "6e7241b51e6817ea6a047693d8e6fed13b31819c9a0dd6c5a726e1592d22f6e9",
  windows_arm64:
    "cadcf7ea4efe3a68728893813643cebe1185e5b1d4be5b96245f65c9a4d5ea41",
};

/**
 * SHA-256 of each pinned `gitleaks` artifact, keyed by its `os_arch` asset
 * suffix, from `gitleaks_8.30.1_checksums.txt`.
 */
const GITLEAKS_SHA256: Record<string, string> = {
  linux_x64: "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
  linux_arm64:
    "e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080",
  darwin_x64:
    "dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709",
  darwin_arm64:
    "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5",
  windows_x64:
    "d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e",
  windows_arm64:
    "b95f5e4f5c425cedca7ee203d9afd29597e692c4924a12ed42f970537c72cc0f",
};

/**
 * Look up a pinned checksum, naming the platform that has none. A tool that
 * publishes no artifact for a platform (zizmor ships no Windows-on-ARM build)
 * should say so rather than fail later as an opaque download error.
 */
function pinned(
  tool: string,
  table: Record<string, string>,
  key: string,
): string {
  const sha = table[key];
  if (sha === undefined) {
    throw new Error(
      `${tool} publishes no pinned artifact for "${key}" — install it on ` +
        `PATH and point the wrapper at it with .toolPath(...), or add the ` +
        `platform's checksum to build/scanners.ts.`,
    );
  }
  return sha;
}

/** The cargo-dist target triple `zizmor` names its release artifacts with. */
function zizmorTriple(platform: Platform): string {
  const arch = platform.archLabel({ x86_64: "x86_64", aarch64: "aarch64" });
  const os = platform.osLabel({
    linux: "unknown-linux-gnu",
    macos: "apple-darwin",
    windows: "pc-windows-msvc",
  });
  return `${arch}-${os}`;
}

/** Whether a platform's release artifacts are `.zip` rather than `.tar.gz`. */
function packedAsZip(platform: Platform): "zip" | "tar.gz" {
  return platform.os === "windows" ? "zip" : "tar.gz";
}

/** The binary's name inside its archive — `.exe` only in the Windows one. */
function inArchive(name: string): (platform: Platform) => string {
  return (platform) => platform.os === "windows" ? `${name}.exe` : name;
}

/**
 * Declare `zizmor` on a toolchain: the Rust workflow analyzer, published by
 * cargo-dist as one flat archive per target triple.
 */
export function zizmorTool(s: ToolInstallSettings): ToolInstallSettings {
  return s
    .name("zizmor")
    .archive(packedAsZip)
    .binaryPath(inArchive("zizmor"))
    .checksum((p) => pinned("zizmor", ZIZMOR_SHA256, zizmorTriple(p)))
    .url((p) =>
      `https://github.com/zizmorcore/zizmor/releases/download/v${ZIZMOR_VERSION}/zizmor-${
        zizmorTriple(p)
      }.${packedAsZip(p)}`
    );
}

/**
 * Declare `actionlint` on a toolchain: the Go workflow linter, whose assets are
 * named `actionlint_<version>_<os>_<arch>`.
 */
export function actionlintTool(s: ToolInstallSettings): ToolInstallSettings {
  const slug = (p: Platform) =>
    `${p.osLabel({ macos: "darwin" })}_${
      p.archLabel({ x86_64: "amd64", aarch64: "arm64" })
    }`;
  return s
    .name("actionlint")
    .archive(packedAsZip)
    .binaryPath(inArchive("actionlint"))
    .checksum((p) => pinned("actionlint", ACTIONLINT_SHA256, slug(p)))
    .url((p) =>
      `https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_${
        slug(p)
      }.${packedAsZip(p)}`
    );
}

/**
 * Declare `gitleaks` on a toolchain. Same asset shape as actionlint, but it
 * spells x86-64 `x64` rather than `amd64`.
 */
export function gitleaksTool(s: ToolInstallSettings): ToolInstallSettings {
  const slug = (p: Platform) =>
    `${p.osLabel({ macos: "darwin" })}_${
      p.archLabel({ x86_64: "x64", aarch64: "arm64" })
    }`;
  return s
    .name("gitleaks")
    .archive(packedAsZip)
    .binaryPath(inArchive("gitleaks"))
    .checksum((p) => pinned("gitleaks", GITLEAKS_SHA256, slug(p)))
    .url((p) =>
      `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_${
        slug(p)
      }.${packedAsZip(p)}`
    );
}

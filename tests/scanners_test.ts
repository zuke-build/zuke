/**
 * Unit tests for `build/scanners.ts` — the pinned toolchain declarations the
 * `security` target provisions its scanners from. Everything here is pure URL
 * and checksum resolution, so it runs with no network and no scanner installed:
 * the assertion is that each declaration names the artifact a given platform's
 * release actually publishes, and pins its hash.
 *
 * @module
 */

import {
  type InstallPlatform,
  type Platform,
  ToolInstallSettings,
} from "@zuke/core";
import { assertEquals, assertThrows } from "../packages/core/tests/_assert.ts";
import {
  ACTIONLINT_VERSION,
  actionlintTool,
  GITLEAKS_VERSION,
  gitleaksTool,
  ZIZMOR_VERSION,
  zizmorTool,
} from "../build/scanners.ts";

/** Enrich `{ os, arch }` into the {@link Platform} the resolvers are called with. */
function platformFor(data: InstallPlatform): Platform {
  return {
    ...data,
    osLabel: (aliases) => aliases?.[data.os] ?? data.os,
    archLabel: (aliases) => aliases?.[data.arch] ?? data.arch,
  };
}

/** The install spec a declaration produces, with its resolvers applied. */
function resolve(
  declare: (s: ToolInstallSettings) => ToolInstallSettings,
  data: InstallPlatform,
): { url: string; checksum: string; archive: string; binaryPath: string } {
  const spec = declare(new ToolInstallSettings()).options_(".tools");
  const platform = platformFor(data);
  const archive = spec.archive ?? "raw";
  const binaryPath = spec.binaryPath ?? spec.name;
  const checksum = spec.checksum;
  if (checksum === undefined) throw new Error(`${spec.name} pins no checksum`);
  return {
    url: spec.url(platform),
    checksum: typeof checksum === "function" ? checksum(platform) : checksum,
    archive: typeof archive === "function" ? archive(platform) : archive,
    binaryPath: typeof binaryPath === "function"
      ? binaryPath(platform)
      : binaryPath,
  };
}

const LINUX = { os: "linux", arch: "x86_64" } as const;
const MAC_ARM = { os: "macos", arch: "aarch64" } as const;
const WINDOWS = { os: "windows", arch: "x86_64" } as const;

Deno.test("zizmor resolves its cargo-dist target triple per platform", () => {
  // The Ubuntu runner the security workflow uses.
  const linux = resolve(zizmorTool, LINUX);
  assertEquals(
    linux.url,
    `https://github.com/zizmorcore/zizmor/releases/download/v${ZIZMOR_VERSION}/zizmor-x86_64-unknown-linux-gnu.tar.gz`,
  );
  assertEquals(linux.archive, "tar.gz");
  assertEquals(linux.binaryPath, "zizmor");

  // An Apple-silicon laptop — the same declaration, a different triple.
  const mac = resolve(zizmorTool, MAC_ARM);
  assertEquals(
    mac.url,
    `https://github.com/zizmorcore/zizmor/releases/download/v${ZIZMOR_VERSION}/zizmor-aarch64-apple-darwin.tar.gz`,
  );

  // Windows ships a zip, with the binary named `.exe` inside it.
  const win = resolve(zizmorTool, WINDOWS);
  assertEquals(win.archive, "zip");
  assertEquals(win.binaryPath, "zizmor.exe");
  assertEquals(win.url.endsWith("zizmor-x86_64-pc-windows-msvc.zip"), true);
});

Deno.test("actionlint resolves its os_arch asset name per platform", () => {
  const linux = resolve(actionlintTool, LINUX);
  assertEquals(
    linux.url,
    `https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz`,
  );
  // macOS is "darwin" and aarch64 is "arm64" in actionlint's own naming.
  const mac = resolve(actionlintTool, MAC_ARM);
  assertEquals(
    mac.url.endsWith(`actionlint_${ACTIONLINT_VERSION}_darwin_arm64.tar.gz`),
    true,
  );
  const win = resolve(actionlintTool, WINDOWS);
  assertEquals(
    win.url.endsWith(`actionlint_${ACTIONLINT_VERSION}_windows_amd64.zip`),
    true,
  );
  assertEquals(win.binaryPath, "actionlint.exe");
});

Deno.test("gitleaks spells x86-64 x64, unlike actionlint's amd64", () => {
  const linux = resolve(gitleaksTool, LINUX);
  assertEquals(
    linux.url,
    `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz`,
  );
  const mac = resolve(gitleaksTool, MAC_ARM);
  assertEquals(
    mac.url.endsWith(`gitleaks_${GITLEAKS_VERSION}_darwin_arm64.tar.gz`),
    true,
  );
});

Deno.test("every scanner pins a 64-hex SHA-256 for each supported platform", () => {
  const platforms: InstallPlatform[] = [
    { os: "linux", arch: "x86_64" },
    { os: "linux", arch: "aarch64" },
    { os: "macos", arch: "x86_64" },
    { os: "macos", arch: "aarch64" },
    { os: "windows", arch: "x86_64" },
  ];
  for (const declare of [zizmorTool, actionlintTool, gitleaksTool]) {
    for (const platform of platforms) {
      const { checksum } = resolve(declare, platform);
      assertEquals(
        /^[0-9a-f]{64}$/.test(checksum),
        true,
        `${platform.os}/${platform.arch}: ${checksum}`,
      );
    }
  }
});

Deno.test("an unpublished platform is named, not left to fail as a 404", () => {
  // zizmor publishes no Windows-on-ARM build. The checksum resolver is what
  // notices, so the message has to say which tool and which platform.
  assertThrows(
    () => resolve(zizmorTool, { os: "windows", arch: "aarch64" }),
    Error,
    "zizmor publishes no pinned artifact for",
  );
});

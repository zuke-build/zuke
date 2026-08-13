// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../packages/core/tests/_assert.ts";
import { defaultHost, runSetup } from "../packages/cli/src/setup.ts";

/**
 * Guards against the launchers' Deno bootstrap regressing back to an
 * unverified `curl | sh` install, and against the pinned per-platform
 * checksums silently drifting out of shape. The download-and-verify path
 * itself needs the network (fetching a real Deno release), so it is exercised
 * manually (see `docs/installing-tools.md`) and by CI, which bootstraps every
 * job through these same launchers. These tests stay hermetic: they check the
 * committed source text, and run the real bash launcher only down paths that
 * exit before any download.
 */

const BASH_LAUNCHER = "zuke";
const PS_LAUNCHER = "zuke.ps1";

/** A well-formed lowercase 64-character hex SHA-256. */
const SHA256_RE = /^[0-9a-f]{64}$/;

Deno.test("the bash launcher no longer pipes an unverified install script", async () => {
  const script = await Deno.readTextFile(BASH_LAUNCHER);
  assertEquals(
    script.includes("deno.land/install.sh"),
    false,
    "zuke must not fall back to the unverified `curl | sh` Deno installer",
  );
});

Deno.test("the PowerShell launcher no longer pipes an unverified install script", async () => {
  const script = await Deno.readTextFile(PS_LAUNCHER);
  assertEquals(
    script.includes("deno.land/install.ps1"),
    false,
    "zuke.ps1 must not fall back to the unverified Invoke-RestMethod installer",
  );
});

Deno.test("the bash launcher pins well-formed per-platform checksums", async () => {
  const script = await Deno.readTextFile(BASH_LAUNCHER);
  const hashes = [...script.matchAll(/echo "([0-9a-f]+)" ;;/g)].map((m) =>
    m[1]
  );
  // Four platforms: linux x86_64/aarch64, macOS x86_64/aarch64.
  assertEquals(hashes.length, 4, "expected 4 pinned checksums in zuke");
  for (const hash of hashes) {
    assertEquals(
      SHA256_RE.test(hash),
      true,
      `"${hash}" is not a well-formed 64-character hex SHA-256`,
    );
  }
});

Deno.test("the PowerShell launcher pins well-formed per-platform checksums", async () => {
  const script = await Deno.readTextFile(PS_LAUNCHER);
  const hashes = [...script.matchAll(/=\s*"([0-9a-f]{64})"/g)].map((m) => m[1]);
  // Two platforms: windows x86_64/aarch64.
  assertEquals(hashes.length, 2, "expected 2 pinned checksums in zuke.ps1");
  for (const hash of hashes) {
    assertEquals(
      SHA256_RE.test(hash),
      true,
      `"${hash}" is not a well-formed 64-character hex SHA-256`,
    );
  }
});

Deno.test("the bash launcher rejects DENO_VERSION=latest instead of fetching vlatest", async () => {
  // `latest` used to be normalised to the non-existent tag "vlatest" and 404 on
  // every retry. There is nothing to pin a checksum to, so it must fail fast
  // with an explanation. Runs the real script — but exits before any network
  // call, so the test stays hermetic.
  if (Deno.build.os === "windows") return; // bash script; see the ps1 test below
  const home = await Deno.makeTempDir({ prefix: "zuke-launcher-" });
  try {
    const command = new Deno.Command("/bin/bash", {
      args: ["./zuke", "--help"],
      clearEnv: true,
      env: {
        // No Deno on this PATH, and an empty DENO_INSTALL, so the script takes
        // the bootstrap branch.
        PATH: "/usr/bin:/bin",
        HOME: home,
        DENO_INSTALL: `${home}/deno`,
        DENO_VERSION: "latest",
        DENO_SHA256: "deadbeef",
      },
    });
    const { code, stderr } = await command.output();
    const err = new TextDecoder().decode(stderr);
    assertEquals(code, 1, `expected a fail-fast exit; stderr: ${err}`);
    assertEquals(
      err.includes("DENO_VERSION=latest is not supported"),
      true,
      `expected a friendly rejection of DENO_VERSION=latest; got: ${err}`,
    );
    assertEquals(
      err.includes("vlatest"),
      false,
      'the launcher must not build a download URL for the tag "vlatest"',
    );
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("the PowerShell launcher rejects DENO_VERSION=latest", async () => {
  // pwsh is not guaranteed on every runner, so assert on the committed source:
  // the guard must sit in zuke.ps1 too, or Windows keeps fetching "vlatest".
  const script = await Deno.readTextFile(PS_LAUNCHER);
  assertEquals(
    script.includes(`if ($denoVersion -eq "latest")`),
    true,
    "zuke.ps1 must reject DENO_VERSION=latest before building a download URL",
  );
  assertEquals(
    script.includes("DENO_VERSION=latest is not supported"),
    true,
    "zuke.ps1 must explain why DENO_VERSION=latest is rejected",
  );
});

Deno.test("a scaffolded launcher fails closed when Deno is missing", async () => {
  // `zuke setup` stamps its own launchers into every new project, so they must
  // not reintroduce the unverified `curl | sh` bootstrap either. Scaffold for
  // real and run the generated script with no Deno on PATH: it must explain
  // itself and exit non-zero rather than download anything.
  if (Deno.build.os === "windows") return; // the generated bash launcher
  for (const path of ["/usr/bin/deno", "/bin/deno"]) {
    try {
      await Deno.lstat(path);
      return; // a Deno on the bare PATH would make the check meaningless
    } catch {
      // expected: nothing to skip for
    }
  }
  const dir = await Deno.makeTempDir({ prefix: "zuke-scaffold-" });
  try {
    await runSetup({ dir, force: false, name: "Scaffolded" }, {
      ...defaultHost,
      log: () => {},
    });
    const { code, stderr } = await new Deno.Command("/bin/bash", {
      args: [`${dir}/zuke`, "--help"],
      clearEnv: true,
      env: { PATH: "/usr/bin:/bin", HOME: dir },
    }).output();
    const err = new TextDecoder().decode(stderr);
    assertEquals(code, 1, `expected a fail-fast exit; stderr: ${err}`);
    assertEquals(
      err.includes("Deno not found on PATH"),
      true,
      `expected the scaffolded launcher to report missing Deno; got: ${err}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("both launchers pin the same default Deno version", async () => {
  const bash = await Deno.readTextFile(BASH_LAUNCHER);
  const ps = await Deno.readTextFile(PS_LAUNCHER);
  const bashMatch = bash.match(/DEFAULT_DENO_VERSION="v([0-9.]+)"/);
  const psMatch = ps.match(/\$DefaultDenoVersion = "([0-9.]+)"/);
  if (bashMatch === null) {
    throw new Error("could not find DEFAULT_DENO_VERSION in zuke");
  }
  if (psMatch === null) {
    throw new Error("could not find $DefaultDenoVersion in zuke.ps1");
  }
  assertEquals(
    bashMatch[1],
    psMatch[1],
    "zuke and zuke.ps1 must pin the same default Deno version",
  );
});

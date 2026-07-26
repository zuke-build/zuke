import { assertEquals } from "../packages/core/tests/_assert.ts";

/**
 * Guards against the launchers' Deno bootstrap regressing back to an
 * unverified `curl | sh` install, and against the pinned per-platform
 * checksums silently drifting out of shape. The download-and-verify path
 * itself needs the network (fetching a real Deno release), so it is exercised
 * manually (see `docs/installing-tools.md`) and by CI, which bootstraps every
 * job through these same launchers — these tests only check the committed
 * source text, hermetically.
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

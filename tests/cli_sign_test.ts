// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for signing and notarizing the CLI's macOS binaries, against fakes
 * of the Apple tools that record the argv each step would run.
 *
 * @module
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "../packages/core/tests/_assert.ts";
import { withTemp } from "../packages/core/tests/_temp.ts";
import {
  CodesignSignSettings,
  CodesignVerifySettings,
  DittoSettings,
  type NotarytoolSubmission,
  NotarytoolSubmitSettings,
  TemporaryKeychainSettings,
} from "@zuke/apple";
import {
  SIGNING_ENV,
  signingCredentials,
  type SigningTools,
  signMacBinaries,
} from "../build/cli_sign.ts";
import { binaryPath } from "../build/cli_package.ts";
import { CLI_TARGETS, MACOS_TARGETS } from "../build/cli_release.ts";

const CREDENTIALS = {
  certificate: "cDEy",
  certificatePassword: "p12-password",
  notaryKey: "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n",
  notaryKeyId: "ABCD123456",
  notaryIssuer: "00000000-0000-0000-0000-000000000000",
};

Deno.test("signingCredentials reads all five variables", () => {
  const env: Record<string, string> = {
    APPLE_CERTIFICATE_P12: CREDENTIALS.certificate,
    APPLE_CERTIFICATE_PASSWORD: CREDENTIALS.certificatePassword,
    APPLE_NOTARY_KEY: CREDENTIALS.notaryKey,
    APPLE_NOTARY_KEY_ID: CREDENTIALS.notaryKeyId,
    APPLE_NOTARY_ISSUER: CREDENTIALS.notaryIssuer,
  };
  assertEquals(signingCredentials((name) => env[name]), CREDENTIALS);
  assertEquals(Object.values(SIGNING_ENV).sort(), Object.keys(env).sort());
});

Deno.test("signingCredentials fails closed, naming every missing variable", () => {
  // An empty secret is how Actions renders one that is not configured.
  const env: Record<string, string> = {
    APPLE_CERTIFICATE_P12: CREDENTIALS.certificate,
    APPLE_CERTIFICATE_PASSWORD: "",
    APPLE_NOTARY_KEY_ID: CREDENTIALS.notaryKeyId,
  };
  const error = assertThrows(
    () => signingCredentials((name) => env[name]),
    Error,
    "never published unsigned",
  );
  assertStringIncludes(
    error.message,
    "APPLE_CERTIFICATE_PASSWORD, APPLE_NOTARY_KEY, APPLE_NOTARY_ISSUER",
  );
  assertEquals(error.message.includes("APPLE_CERTIFICATE_P12"), false);
  // No value ever reaches the message.
  assertEquals(error.message.includes(CREDENTIALS.certificate), false);
});

/** Recording fakes of the Apple tools; `verdict` is what notarization says. */
function fakeTools(
  calls: string[],
  verdict: () => Promise<NotarytoolSubmission> = () =>
    Promise.resolve({ id: "sub-1", status: "Accepted" }),
  onSubmit: (argv: string[]) => Promise<void> = () => Promise.resolve(),
): SigningTools {
  return {
    temporaryKeychain: async (configure, use) => {
      configure(new TemporaryKeychainSettings());
      calls.push("keychain:open");
      try {
        await use({
          keychain: "/tmp/k/zuke.keychain-db",
          identity: {
            hash: "ABCDEF0123456789ABCDEF0123456789ABCDEF01",
            name: "Developer ID Application: Zuke (TEAM123456)",
          },
        });
      } finally {
        calls.push("keychain:close");
      }
    },
    sign: (configure) => {
      calls.push(configure(new CodesignSignSettings()).argv().join(" "));
      return Promise.resolve();
    },
    verify: (configure) => {
      calls.push(configure(new CodesignVerifySettings()).argv().join(" "));
      return Promise.resolve();
    },
    archive: (configure) => {
      calls.push(configure(new DittoSettings()).argv().join(" "));
      return Promise.resolve();
    },
    submit: async (configure) => {
      const argv = configure(new NotarytoolSubmitSettings()).argv();
      calls.push(argv.join(" "));
      await onSubmit(argv);
      return await verdict();
    },
  };
}

/** A binaries directory holding a stand-in binary for every target. */
async function binaries(dir: string): Promise<string> {
  const bin = `${dir}/bin`;
  for (const target of CLI_TARGETS) {
    await Deno.mkdir(`${bin}/${target.triple}`, { recursive: true });
    await Deno.writeTextFile(binaryPath(bin, target.triple), target.triple);
  }
  return bin;
}

Deno.test("signMacBinaries signs and verifies each macOS binary inside the keychain, then notarizes", async () => {
  await withTemp(async (dir) => {
    const bin = await binaries(dir);
    const calls: string[] = [];
    let keyFile = "";
    await signMacBinaries(
      bin,
      CREDENTIALS,
      fakeTools(calls, undefined, async (argv) => {
        keyFile = argv[argv.indexOf("--key") + 1];
        // Written owner-only, holding the key text as given.
        assertEquals(await Deno.readTextFile(keyFile), CREDENTIALS.notaryKey);
        if (Deno.build.os !== "windows") {
          assertEquals(((await Deno.stat(keyFile)).mode ?? 0) & 0o777, 0o600);
        }
      }),
    );
    const [open, ...rest] = calls;
    assertEquals(open, "keychain:open");
    for (const [i, target] of MACOS_TARGETS.entries()) {
      const binary = binaryPath(bin, target.triple);
      const sign = rest[i * 2];
      for (
        const part of [
          "codesign --sign ABCDEF0123456789ABCDEF0123456789ABCDEF01",
          "--keychain /tmp/k/zuke.keychain-db",
          "--options runtime",
          "--timestamp",
          "cli_entitlements.plist",
          "--identifier build.zuke.cli",
          "--force",
        ]
      ) {
        assertStringIncludes(sign, part);
      }
      assertEquals(sign.endsWith(binary), true, sign);
      assertStringIncludes(rest[i * 2 + 1], "--verify --strict");
      assertEquals(rest[i * 2 + 1].endsWith(binary), true);
    }
    // Signing finishes inside the keychain's lifetime; notarizing after it.
    assertEquals(rest[MACOS_TARGETS.length * 2], "keychain:close");
    const [archive, submit] = rest.slice(MACOS_TARGETS.length * 2 + 1);
    // `archive` itself adds `-c -k`; the step chooses what is zipped.
    assertEquals(
      /^ditto --keepParent \S+\/zuke \S+\/zuke\.zip$/.test(archive),
      true,
      archive,
    );
    for (
      const part of [
        "notarytool submit",
        "--key-id ABCD123456",
        `--issuer ${CREDENTIALS.notaryIssuer}`,
        "--wait",
        "--timeout 30m",
      ]
    ) {
      assertStringIncludes(submit, part);
    }
    // The key file does not outlive the run.
    await assertRejects(() => Deno.stat(keyFile), Deno.errors.NotFound);
    // Only the macOS binaries were touched.
    assertEquals(calls.some((c) => c.includes("linux")), false);
  });
});

Deno.test("signMacBinaries restores the execute bit an artifact download drops", async () => {
  if (Deno.build.os === "windows") return;
  await withTemp(async (dir) => {
    const bin = await binaries(dir);
    for (const target of MACOS_TARGETS) {
      await Deno.chmod(binaryPath(bin, target.triple), 0o644);
    }
    await signMacBinaries(bin, CREDENTIALS, fakeTools([]));
    for (const target of MACOS_TARGETS) {
      const { mode } = await Deno.stat(binaryPath(bin, target.triple));
      assertEquals((mode ?? 0) & 0o777, 0o755);
    }
  });
});

Deno.test("signMacBinaries fails on a missing binary before opening a keychain", async () => {
  await withTemp(async (dir) => {
    const calls: string[] = [];
    await assertRejects(
      () => signMacBinaries(`${dir}/none`, CREDENTIALS, fakeTools(calls)),
      Deno.errors.NotFound,
    );
    assertEquals(calls, []);
  });
});

Deno.test("signMacBinaries removes the key file even when notarization fails", async () => {
  await withTemp(async (dir) => {
    const bin = await binaries(dir);
    let keyFile = "";
    await assertRejects(
      () =>
        signMacBinaries(
          bin,
          CREDENTIALS,
          fakeTools(
            [],
            () => Promise.reject(new Error("notarization: Invalid")),
            (argv) => {
              keyFile = argv[argv.indexOf("--key") + 1];
              return Promise.resolve();
            },
          ),
        ),
      Error,
      "notarization: Invalid",
    );
    await assertRejects(() => Deno.stat(keyFile), Deno.errors.NotFound);
  });
});

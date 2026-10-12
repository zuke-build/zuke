// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Signing and notarizing the macOS `zuke` binaries.
 *
 * Each binary is signed with the Developer ID certificate under the hardened
 * runtime, with a secure timestamp and the entitlements V8 needs to run
 * (`build/cli_entitlements.plist`), then verified. Both are then submitted to
 * Apple's notary service in one zip and the run waits for the verdict:
 * anything but `Accepted` fails it, so an unsigned or rejected binary never
 * reaches the release.
 *
 * A bare executable cannot have a notarization ticket stapled to it — only
 * bundles, disk images and installer packages can. Gatekeeper looks the
 * ticket up online instead, which is how every notarized command-line tool
 * ships.
 *
 * The credentials come from the `cli-signing` environment. Every one is
 * required: a release is never signed with part of them, or not at all.
 *
 * @module
 */

import {
  type CodesignSignSettings,
  CodesignTasks,
  type CodesignVerifySettings,
  type DittoSettings,
  DittoTasks,
  type NotarytoolSubmission,
  type NotarytoolSubmitSettings,
  NotarytoolTasks,
  SecurityTasks,
  type TemporaryKeychain,
  type TemporaryKeychainSettings,
} from "@zuke/apple";
import { ConsoleTasks } from "@zuke/console";
import { binaryPath } from "./cli_package.ts";
import { MACOS_TARGETS } from "./cli_release.ts";

/** The signing identity's kind: a Developer ID for distribution outside the App Store. */
const IDENTITY = "Developer ID Application";

/** The code-signing identifier the binaries carry. */
const IDENTIFIER = "build.zuke.cli";

/** The entitlements every signed binary carries. */
const ENTITLEMENTS = `${import.meta.dirname}/cli_entitlements.plist`;

/** The environment variables {@link signingCredentials} reads. */
export const SIGNING_ENV: Readonly<Record<keyof SigningCredentials, string>> = {
  certificate: "APPLE_CERTIFICATE_P12",
  certificatePassword: "APPLE_CERTIFICATE_PASSWORD",
  notaryKey: "APPLE_NOTARY_KEY",
  notaryKeyId: "APPLE_NOTARY_KEY_ID",
  notaryIssuer: "APPLE_NOTARY_ISSUER",
};

/** The signing credentials, every one present. */
export interface SigningCredentials {
  /** The Developer ID Application certificate and key, a base64 `.p12`. */
  readonly certificate: string;
  /** The `.p12`'s export password. */
  readonly certificatePassword: string;
  /** The App Store Connect API key: the text of its `.p8` file. */
  readonly notaryKey: string;
  /** That key's id. */
  readonly notaryKeyId: string;
  /** The issuer id of the team the key belongs to. */
  readonly notaryIssuer: string;
}

/**
 * The signing credentials from `env`.
 *
 * @throws {Error} naming every missing variable, so a release fails closed
 * rather than shipping unsigned when the environment is not configured.
 */
export function signingCredentials(
  env: (name: string) => string | undefined,
): SigningCredentials {
  const read = (name: string) => {
    const value = env(name);
    return value === undefined || value === "" ? undefined : value;
  };
  const certificate = read(SIGNING_ENV.certificate);
  const certificatePassword = read(SIGNING_ENV.certificatePassword);
  const notaryKey = read(SIGNING_ENV.notaryKey);
  const notaryKeyId = read(SIGNING_ENV.notaryKeyId);
  const notaryIssuer = read(SIGNING_ENV.notaryIssuer);
  if (
    certificate === undefined || certificatePassword === undefined ||
    notaryKey === undefined || notaryKeyId === undefined ||
    notaryIssuer === undefined
  ) {
    const missing = Object.values(SIGNING_ENV).filter((name) =>
      read(name) === undefined
    );
    throw new Error(
      `cannot sign the macOS binaries: ${missing.join(", ")} not set. They ` +
        "belong in the repository's cli-signing environment; a release is " +
        "never published unsigned.",
    );
  }
  return {
    certificate,
    certificatePassword,
    notaryKey,
    notaryKeyId,
    notaryIssuer,
  };
}

/** The Apple tools {@link signMacBinaries} drives, injectable for tests. */
export interface SigningTools {
  /** Run `use` with the certificate imported into a throwaway keychain. */
  temporaryKeychain(
    configure: (s: TemporaryKeychainSettings) => TemporaryKeychainSettings,
    use: (keychain: TemporaryKeychain) => Promise<void>,
  ): Promise<void>;
  /** Sign one binary. */
  sign(
    configure: (s: CodesignSignSettings) => CodesignSignSettings,
  ): Promise<unknown>;
  /** Verify one binary's signature. */
  verify(
    configure: (s: CodesignVerifySettings) => CodesignVerifySettings,
  ): Promise<unknown>;
  /** Zip the binaries for the notary service. */
  archive(configure: (s: DittoSettings) => DittoSettings): Promise<unknown>;
  /** Submit the zip and wait for the verdict. */
  submit(
    configure: (s: NotarytoolSubmitSettings) => NotarytoolSubmitSettings,
  ): Promise<NotarytoolSubmission>;
}

/** The real {@link SigningTools}: `@zuke/apple`'s tasks. */
export const APPLE_TOOLS: SigningTools = {
  temporaryKeychain: (configure, use) =>
    SecurityTasks.temporaryKeychain(configure, use),
  sign: (configure) => CodesignTasks.sign(configure),
  verify: (configure) => CodesignTasks.verify(configure),
  archive: (configure) => DittoTasks.archive(configure),
  submit: (configure) => NotarytoolTasks.submit(configure),
};

/**
 * Sign, verify and notarize the macOS binaries under `binDir`, in place.
 *
 * @throws {Error} when a binary is missing, signing or verification fails, or
 * notarization is anything but `Accepted`.
 */
export async function signMacBinaries(
  binDir: string,
  credentials: SigningCredentials,
  tools: SigningTools = APPLE_TOOLS,
): Promise<void> {
  const binaries = MACOS_TARGETS.map((t) => binaryPath(binDir, t.triple));
  // Artifacts do not keep file modes, so the binaries arrive here without
  // their execute bit; the signed binary is run once signing is done.
  for (const binary of binaries) await Deno.chmod(binary, 0o755);

  await tools.temporaryKeychain(
    (s) =>
      s.certificate(credentials.certificate)
        .certificatePassword(credentials.certificatePassword)
        .identity(IDENTITY),
    async ({ keychain, identity }) => {
      for (const binary of binaries) {
        await tools.sign((s) =>
          s.identity(identity.hash).keychain(keychain).options("runtime")
            .timestamp().entitlements(ENTITLEMENTS).identifier(IDENTIFIER)
            .force().file(binary)
        );
        await tools.verify((s) => s.strict().verbose(2).file(binary));
      }
    },
  );

  // The key file and the zip live in a private directory removed on every
  // path; the key is written exclusive and owner-only.
  const scratch = await Deno.makeTempDir({ prefix: "zuke-notary-" });
  try {
    await Deno.chmod(scratch, 0o700);
    const key = `${scratch}/AuthKey.p8`;
    await Deno.writeTextFile(key, credentials.notaryKey, {
      createNew: true,
      mode: 0o600,
    });
    // One submission for both binaries: notarization tickets are per binary
    // (by code hash), not per upload.
    const staged = `${scratch}/zuke`;
    await Deno.mkdir(staged);
    for (const target of MACOS_TARGETS) {
      await Deno.copyFile(
        binaryPath(binDir, target.triple),
        `${staged}/zuke-${target.triple}`,
      );
    }
    const zip = `${scratch}/zuke.zip`;
    await tools.archive((s) => s.keepParent().source(staged).destination(zip));
    const submission = await tools.submit((s) =>
      s.key(key).keyId(credentials.notaryKeyId)
        .issuer(credentials.notaryIssuer).file(zip).wait().timeout("30m")
    );
    // `submit` with `.wait()` throws on anything but Accepted.
    ConsoleTasks.info(
      `Notarized ${binaries.length} binaries: submission ${submission.id} ` +
        "accepted.",
    );
  } finally {
    await Deno.remove(scratch, { recursive: true });
  }
}

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A throwaway signing keychain for the length of one callback — the setup
 * every macOS CI job that signs code repeats by hand, and gets subtly wrong
 * when a step fails halfway and leaves a keychain on the search list.
 *
 * ```ts
 * import { CodesignTasks, SecurityTasks } from "@zuke/apple";
 * await SecurityTasks.temporaryKeychain(
 *   (s) => s.certificate(p12Base64).certificatePassword(p12Password),
 *   async ({ keychain, identity }) => {
 *     await CodesignTasks.sign((s) =>
 *       s.identity(identity.hash).keychain(keychain).options("runtime")
 *         .timestamp().file("dist/MyApp.app")
 *     );
 *   },
 * );
 * ```
 *
 * Setup, in order: read the user search list; create a uniquely named
 * keychain in a fresh private temp directory with a random password; turn its
 * auto-lock off; unlock it; write the decoded `.p12` to a `0600` file, import
 * it, and delete the file at once; allow Apple's tools to use the key without
 * a prompt (`set-key-partition-list`); put the keychain first on the search
 * list; and find the one codesigning identity it holds.
 *
 * Cleanup always runs, whether setup or the callback failed: the keychain is
 * deleted, the search list put back as it was, and the temp directory
 * removed. Every step is attempted even when an earlier one fails, and any
 * that fail are reported together as a {@link KeychainCleanupError}.
 *
 * The user keychain search list is one per user, not one per build, and each
 * keychain restores the list it read. So within one process the keychain
 * lifetimes are serialized: a second `temporaryKeychain` — say from a parallel
 * target in a `group()` — waits until the first has been torn down, and two
 * overlapping calls can neither drop each other's keychain from the list nor
 * leave a deleted one on it. Separate processes running as the same user — two
 * builds, or two jobs on one self-hosted runner account — cannot see that
 * lock, so they must not sign at the same time.
 *
 * Under a deep dry run (`--dry-run`) commands are echoed rather than run, and
 * core exposes no way for a wrapper to tell. The certificate is still decoded
 * and written to its private file (and deleted again), and then the setup
 * fails with "no valid codesigning identity", because the echoed
 * `find-identity` prints nothing. Leave signing targets out of a dry run.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";
import {
  KeychainCleanupError,
  type KeychainCleanupFailure,
  KeychainError,
} from "./errors.ts";
import { defaultKeychainHost, type KeychainHost } from "./keychain_host.ts";
import {
  SecurityCreateKeychainSettings,
  SecurityDeleteKeychainSettings,
  SecuritySetKeychainSettings,
  SecurityUnlockKeychainSettings,
} from "./security_keychain.ts";
import {
  SecurityImportSettings,
  SecuritySetKeyPartitionListSettings,
} from "./security_import.ts";
import {
  parseIdentities,
  parseKeychainList,
  SecurityFindIdentitySettings,
  type SecurityIdentity,
  SecurityListKeychainsSettings,
} from "./security_search.ts";
import type { SecuritySettings } from "./security_settings.ts";
import { decodeBase64 } from "./base64.ts";
import { messageOf, printable } from "./text.ts";

/** What the callback of `SecurityTasks.temporaryKeychain` is handed. */
export interface TemporaryKeychain {
  /** The keychain's absolute path — pass it to `codesign --keychain`. */
  keychain: string;
  /** The codesigning identity imported into it. */
  identity: SecurityIdentity;
}

/** A cleanup step: what it does, and doing it. */
interface CleanupStep {
  step: string;
  run: () => Promise<unknown>;
}

/**
 * The tail of the process's keychain lifetimes: each `open_` waits for it, so
 * no two keychains are set up, used or torn down at the same time.
 */
let lifetimes: Promise<void> = Promise.resolve();

/** Ignore how a lifetime ended — the next one waits only for it to end. */
function settle(): void {}

/** The applications allowed to use the key when none are named. */
const DEFAULT_APPLICATIONS = ["/usr/bin/codesign"];

/** The partition ids that let Apple's signing tools use the key unprompted. */
const APPLE_PARTITIONS = ["apple-tool:", "apple:"];

/** `base64` decoded, or a {@link KeychainError} that does not echo it. */
function decodeCertificate(base64: string | undefined): Uint8Array {
  if (base64 === undefined) {
    throw new KeychainError(
      "SecurityTasks.temporaryKeychain: no certificate — add " +
        ".certificate(base64P12), e.g. from a secret parameter.",
    );
  }
  const bytes = decodeBase64(base64);
  if (bytes === undefined || bytes.length === 0) {
    throw new KeychainError(
      "SecurityTasks.temporaryKeychain: the certificate is not base64. " +
        "Encode the .p12 with `base64 -i cert.p12` and pass that text.",
    );
  }
  return bytes;
}

/** Settings for `SecurityTasks.temporaryKeychain`. */
export class TemporaryKeychainSettings {
  #certificate?: string;
  #certificatePassword = "";
  #identity?: string;
  #applications: string[] = [];
  #toolPath?: string;
  #host: KeychainHost = defaultKeychainHost;

  /**
   * The signing certificate and its private key, as a base64-encoded `.p12`
   * — the form CI secrets hold it in. Whitespace is ignored. Required. It is
   * decoded only into a `0600` file that is deleted straight after import,
   * and never appears in a command line or an error message.
   */
  certificate(base64P12: string): this {
    this.#certificate = base64P12;
    return this;
  }

  /**
   * The `.p12`'s export password, handed to `security import -P`. A secret:
   * masked in every rendering of that command. Defaults to empty, for a
   * `.p12` exported without one — `security` would otherwise prompt.
   */
  certificatePassword(value: string): this {
    this.#certificatePassword = value;
    return this;
  }

  /**
   * Pick the identity whose name contains `filter`, or whose SHA-1 hash it
   * is. Needed only when the `.p12` holds more than one codesigning identity.
   */
  identity(filter: string): this {
    this.#identity = filter;
    return this;
  }

  /**
   * An application allowed to use the imported key (`security import -T`);
   * repeatable. Defaults to `/usr/bin/codesign` when none is named.
   */
  application(...paths: PathLike[]): this {
    this.#applications.push(...paths.map(String));
    return this;
  }

  /** Run this `security` binary instead of the one on `PATH`. */
  toolPath(path: PathLike): this {
    this.#toolPath = String(path);
    return this;
  }

  /**
   * Replace the machine the keychain is set up on — the seam a test uses to
   * record the steps without macOS. Production code leaves the default.
   */
  host(value: KeychainHost): this {
    this.#host = value;
    return this;
  }

  /**
   * Set the keychain up, run `use` with it, and tear it down — what
   * `SecurityTasks.temporaryKeychain` calls. Returns what `use` returns.
   *
   * @throws {KeychainError} When the certificate is missing or not base64
   * (before anything is created), or holds no matching codesigning identity.
   * @throws {KeychainCleanupError} When any cleanup step failed; the error of
   * a failed setup or callback is its `cause`.
   */
  open_<T>(use: (keychain: TemporaryKeychain) => Promise<T>): Promise<T> {
    const p12 = decodeCertificate(this.#certificate);
    // One keychain lifetime at a time in this process: each restores the
    // search list it read, so two that overlapped would corrupt it.
    const turn = lifetimes.then(() => this.#lifetime(p12, use));
    lifetimes = turn.then(settle, settle);
    return turn;
  }

  /** Set up, run `use`, and tear down — one serialized keychain lifetime. */
  async #lifetime<T>(
    p12: Uint8Array,
    use: (keychain: TemporaryKeychain) => Promise<T>,
  ): Promise<T> {
    const dir = await this.#host.makeTempDir();
    const cleanup: CleanupStep[] = [{
      step: "remove the keychain directory",
      run: () => this.#host.remove(dir),
    }];
    let outcome: { ok: true; value: T } | { ok: false; error: unknown };
    try {
      const keychain = await this.#setUp(dir, p12, cleanup);
      outcome = { ok: true, value: await use(keychain) };
    } catch (error) {
      outcome = { ok: false, error };
    }
    const failures = await runCleanup(cleanup);
    if (failures.length > 0) {
      throw new KeychainCleanupError(
        failures,
        outcome.ok ? undefined : { cause: outcome.error },
      );
    }
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  }

  /**
   * Every setup step, registering the undo for each change before or as it
   * is made, so a failure part-way leaves `cleanup` holding exactly what
   * needs undoing.
   */
  async #setUp(
    dir: string,
    p12: Uint8Array,
    cleanup: CleanupStep[],
  ): Promise<TemporaryKeychain> {
    const password = this.#host.randomHex(32);
    const keychain = `${dir}/zuke-${this.#host.randomHex(8)}.keychain-db`;
    // Read before create-keychain, which may itself add the new keychain to
    // the list; the restore is registered first, because putting back the
    // list as read is right whatever happens next.
    const previous = parseKeychainList(
      (await this.#run(new SecurityListKeychainsSettings().domain("user")))
        .stdout,
    );
    cleanup.unshift({
      step: "restore the keychain search list",
      run: () =>
        this.#run(
          new SecurityListKeychainsSettings().domain("user").set(...previous),
        ),
    });
    await this.#run(
      new SecurityCreateKeychainSettings().password(password).keychain(
        keychain,
      ),
    );
    cleanup.unshift({
      step: "delete the keychain",
      run: () =>
        this.#run(new SecurityDeleteKeychainSettings().keychain(keychain)),
    });
    await this.#run(new SecuritySetKeychainSettings().keychain(keychain));
    await this.#run(
      new SecurityUnlockKeychainSettings().password(password).keychain(
        keychain,
      ),
    );
    await this.#import(dir, keychain, p12);
    await this.#run(
      new SecuritySetKeyPartitionListSettings()
        .partitionList(...APPLE_PARTITIONS).privateKeys().password(password)
        .keychain(keychain),
    );
    await this.#run(
      new SecurityListKeychainsSettings().domain("user").set(
        keychain,
        ...previous,
      ),
    );
    const listed = await this.#run(
      new SecurityFindIdentitySettings().valid().policy("codesigning")
        .keychain(keychain),
    );
    return { keychain, identity: this.#pick(parseIdentities(listed.stdout)) };
  }

  /** Write the `.p12` to a private file, import it, and delete the file. */
  async #import(dir: string, keychain: string, p12: Uint8Array): Promise<void> {
    const file = `${dir}/certificate.p12`;
    try {
      await this.#host.writePrivateFile(file, p12);
      const applications = this.#applications.length > 0
        ? this.#applications
        : DEFAULT_APPLICATIONS;
      await this.#run(
        new SecurityImportSettings().file(file).keychain(keychain)
          .passphrase(this.#certificatePassword)
          .application(...applications).format("pkcs12"),
      );
    } finally {
      await this.#host.remove(file);
    }
  }

  /** The one identity matching the filter, or a {@link KeychainError}. */
  #pick(identities: SecurityIdentity[]): SecurityIdentity {
    const filter = this.#identity;
    const matches = filter === undefined
      ? identities
      : identities.filter((i) =>
        i.hash === filter.toUpperCase() || i.name.includes(filter)
      );
    if (matches.length === 1) return matches[0];
    const scope = filter === undefined
      ? ""
      : ` matching "${printable(filter)}"`;
    if (matches.length === 0) {
      throw new KeychainError(
        `SecurityTasks.temporaryKeychain: the certificate holds no valid ` +
          `codesigning identity${scope}. Check that the .p12 includes the ` +
          `private key and that the certificate is a signing certificate ` +
          `that has not expired.`,
      );
    }
    throw new KeychainError(
      `SecurityTasks.temporaryKeychain: the certificate holds ` +
        `${matches.length} codesigning identities${scope} — pick one with ` +
        `.identity(nameOrHash):\n` +
        matches.map((i) => `  - ${i.hash} ${printable(i.name)}`).join("\n"),
    );
  }

  /** Run one `security` command through the host, on the configured binary. */
  #run(settings: SecuritySettings): Promise<CommandOutput> {
    return this.#host.security(
      this.#toolPath === undefined
        ? settings
        : settings.toolPath(this.#toolPath),
    );
  }
}

/** Run every step, newest first, collecting each that throws. */
async function runCleanup(
  steps: CleanupStep[],
): Promise<KeychainCleanupFailure[]> {
  const failures: KeychainCleanupFailure[] = [];
  for (const { step, run } of steps) {
    try {
      await run();
    } catch (error) {
      failures.push({
        step,
        message: messageOf(error),
      });
    }
  }
  return failures;
}

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `SecurityTasks` — typed task functions for macOS `security`, the keychain
 * tool: the subcommands a signing job needs, named after the real ones, plus
 * {@link SecurityTasksApi.temporaryKeychain}, which strings them together into
 * a throwaway CI keychain that is always cleaned up.
 *
 * ```ts
 * import { SecurityTasks } from "@zuke/apple";
 * const identities = await SecurityTasks.findIdentity((s) =>
 *   s.valid().policy("codesigning")
 * );
 * ```
 *
 * Every password these settings take is a secret: masked in every rendering
 * of the command and in any error the run raises.
 *
 * @module
 */

import { type Configure, runSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";
import {
  type TemporaryKeychain,
  TemporaryKeychainSettings,
} from "./keychain.ts";
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

/** The shape of {@link SecurityTasks}. */
export interface SecurityTasksApi {
  /** Create a keychain with `security create-keychain`. */
  createKeychain(
    configure: Configure<SecurityCreateKeychainSettings>,
  ): Promise<CommandOutput>;
  /** Delete a keychain with `security delete-keychain`. */
  deleteKeychain(
    configure: Configure<SecurityDeleteKeychainSettings>,
  ): Promise<CommandOutput>;
  /** Unlock a keychain with `security unlock-keychain`. */
  unlockKeychain(
    configure: Configure<SecurityUnlockKeychainSettings>,
  ): Promise<CommandOutput>;
  /** Change a keychain's lock settings with `security set-keychain-settings`. */
  setKeychainSettings(
    configure: Configure<SecuritySetKeychainSettings>,
  ): Promise<CommandOutput>;
  /** Import a certificate or key with `security import`. */
  import(configure: Configure<SecurityImportSettings>): Promise<CommandOutput>;
  /** Set which tools may use a key with `security set-key-partition-list`. */
  setKeyPartitionList(
    configure: Configure<SecuritySetKeyPartitionListSettings>,
  ): Promise<CommandOutput>;
  /**
   * Read — or, with `.set(...)`, replace — the keychain search list with
   * `security list-keychains`. Returns the listed paths; empty after a set,
   * which prints nothing.
   */
  listKeychains(
    configure?: Configure<SecurityListKeychainsSettings>,
  ): Promise<string[]>;
  /** List signing identities with `security find-identity`, parsed. */
  findIdentity(
    configure?: Configure<SecurityFindIdentitySettings>,
  ): Promise<SecurityIdentity[]>;
  /**
   * Import a base64 `.p12` into a fresh keychain, run `use` with the keychain
   * and its codesigning identity, and always tear the keychain down after.
   * See {@link TemporaryKeychainSettings}.
   */
  temporaryKeychain<T>(
    configure: Configure<TemporaryKeychainSettings>,
    use: (keychain: TemporaryKeychain) => Promise<T>,
  ): Promise<T>;
}

/** Typed task functions for macOS `security`. */
export const SecurityTasks: SecurityTasksApi = {
  createKeychain(
    configure: Configure<SecurityCreateKeychainSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new SecurityCreateKeychainSettings(), configure);
  },
  deleteKeychain(
    configure: Configure<SecurityDeleteKeychainSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new SecurityDeleteKeychainSettings(), configure);
  },
  unlockKeychain(
    configure: Configure<SecurityUnlockKeychainSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new SecurityUnlockKeychainSettings(), configure);
  },
  setKeychainSettings(
    configure: Configure<SecuritySetKeychainSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new SecuritySetKeychainSettings(), configure);
  },
  import(configure: Configure<SecurityImportSettings>): Promise<CommandOutput> {
    return runSettings(new SecurityImportSettings(), configure);
  },
  setKeyPartitionList(
    configure: Configure<SecuritySetKeyPartitionListSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new SecuritySetKeyPartitionListSettings(), configure);
  },
  async listKeychains(
    configure?: Configure<SecurityListKeychainsSettings>,
  ): Promise<string[]> {
    const output = await runSettings(
      new SecurityListKeychainsSettings(),
      configure,
    );
    return parseKeychainList(output.stdout);
  },
  async findIdentity(
    configure?: Configure<SecurityFindIdentitySettings>,
  ): Promise<SecurityIdentity[]> {
    const output = await runSettings(
      new SecurityFindIdentitySettings(),
      configure,
    );
    return parseIdentities(output.stdout);
  },
  temporaryKeychain<T>(
    configure: Configure<TemporaryKeychainSettings>,
    use: (keychain: TemporaryKeychain) => Promise<T>,
  ): Promise<T> {
    return configure(new TemporaryKeychainSettings()).open_(use);
  },
};

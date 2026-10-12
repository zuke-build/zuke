// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The side effects of `SecurityTasks.temporaryKeychain`, behind a narrow seam.
 *
 * Setting up a signing keychain runs `security` and touches the filesystem —
 * a temp directory, a short-lived `.p12` file — none of which a test runner
 * off macOS can do for real. The orchestration (the order of the steps, and
 * that every cleanup step runs whatever failed) is what needs proving, so it
 * depends on this interface rather than on `Deno.*` directly, and a test hands
 * in a fake that records what was asked of it.
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import type { SecuritySettings } from "./security_settings.ts";

/** What `SecurityTasks.temporaryKeychain` asks of the machine it runs on. */
export interface KeychainHost {
  /** Run one configured `security` command and return its output. */
  security(settings: SecuritySettings): Promise<CommandOutput>;
  /**
   * Create a fresh private directory and return its absolute, canonical path
   * — symlinks resolved, so it is spelled the way `security list-keychains`
   * prints it (on macOS the temp dir is under the `/var` → `/private/var`
   * link).
   */
  makeTempDir(): Promise<string>;
  /**
   * Write `data` to a new file at `path` readable by the owner only (mode
   * `0600`), refusing to overwrite or follow anything already there.
   */
  writePrivateFile(path: string, data: Uint8Array): Promise<void>;
  /** Remove `path` and anything under it; a path that is already gone is fine. */
  remove(path: string): Promise<void>;
  /** `bytes` cryptographically random bytes, as lower-case hex. */
  randomHex(bytes: number): string;
}

/** The real, `Deno`-backed {@link KeychainHost}. */
export const defaultKeychainHost: KeychainHost = {
  security: (settings) => settings.quiet().run(),
  makeTempDir: async () =>
    await Deno.realPath(await Deno.makeTempDir({ prefix: "zuke-keychain-" })),
  writePrivateFile: (path, data) =>
    Deno.writeFile(path, data, { mode: 0o600, createNew: true }),
  async remove(path) {
    try {
      await Deno.remove(path, { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  },
  randomHex(bytes) {
    const buffer = crypto.getRandomValues(new Uint8Array(bytes));
    return Array.from(buffer, (b) => b.toString(16).padStart(2, "0")).join("");
  },
};

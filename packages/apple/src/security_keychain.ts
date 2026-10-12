// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `security` subcommands that manage a keychain's lifecycle:
 * `create-keychain`, `delete-keychain`, `unlock-keychain` and
 * `set-keychain-settings`.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { operand } from "./operand.ts";
import { SecuritySettings } from "./security_settings.ts";

/** Settings for `security create-keychain`. */
export class SecurityCreateKeychainSettings extends SecuritySettings {
  #password?: string;
  #keychains: string[] = [];

  /** `create-keychain`. */
  protected override subcommand(): string {
    return "create-keychain";
  }

  /**
   * The new keychain's password (`-p`). A secret: masked in every rendering
   * of the command. Without it `security` prompts for one.
   */
  password(value: string): this {
    this.#password = this.secret(value);
    return this;
  }

  /** The keychain(s) to create (positional); repeatable. Required. */
  keychain(...paths: PathLike[]): this {
    this.#keychains.push(...paths.map(operand));
    return this;
  }

  /** Assemble the create-keychain arguments. */
  protected override subcommandArgs(): string[] {
    if (this.#keychains.length === 0) {
      throw new Error(
        "security create-keychain: no keychain — add .keychain(path).",
      );
    }
    const argv: string[] = [];
    if (this.#password !== undefined) argv.push("-p", this.#password);
    argv.push(...this.#keychains);
    return argv;
  }
}

/** Settings for `security delete-keychain`. */
export class SecurityDeleteKeychainSettings extends SecuritySettings {
  #keychains: string[] = [];

  /** `delete-keychain`. */
  protected override subcommand(): string {
    return "delete-keychain";
  }

  /** The keychain(s) to delete (positional); repeatable. Required. */
  keychain(...paths: PathLike[]): this {
    this.#keychains.push(...paths.map(operand));
    return this;
  }

  /** Assemble the delete-keychain arguments. */
  protected override subcommandArgs(): string[] {
    if (this.#keychains.length === 0) {
      throw new Error(
        "security delete-keychain: no keychain — add .keychain(path).",
      );
    }
    return [...this.#keychains];
  }
}

/** Settings for `security unlock-keychain`. */
export class SecurityUnlockKeychainSettings extends SecuritySettings {
  #password?: string;
  #keychain?: string;

  /** `unlock-keychain`. */
  protected override subcommand(): string {
    return "unlock-keychain";
  }

  /**
   * The keychain's password (`-p`). A secret: masked in every rendering of
   * the command. Without it `security` prompts for one.
   */
  password(value: string): this {
    this.#password = this.secret(value);
    return this;
  }

  /** The keychain to unlock (positional); the default keychain when omitted. */
  keychain(path: PathLike): this {
    this.#keychain = operand(path);
    return this;
  }

  /** Assemble the unlock-keychain arguments. */
  protected override subcommandArgs(): string[] {
    const argv: string[] = [];
    if (this.#password !== undefined) argv.push("-p", this.#password);
    if (this.#keychain !== undefined) argv.push(this.#keychain);
    return argv;
  }
}

/**
 * Settings for `security set-keychain-settings`. With no flags, the keychain
 * never locks on its own — no timeout, and no lock on sleep — which is what a
 * CI keychain wants for the length of a build.
 */
export class SecuritySetKeychainSettings extends SecuritySettings {
  #lockOnSleep = false;
  #lockAfterTimeout = false;
  #timeout?: number;
  #keychain?: string;

  /** `set-keychain-settings`. */
  protected override subcommand(): string {
    return "set-keychain-settings";
  }

  /** Lock the keychain when the machine sleeps (`-l`). */
  lockOnSleep(): this {
    this.#lockOnSleep = true;
    return this;
  }

  /** Lock the keychain after {@link timeout} seconds of inactivity (`-u`). */
  lockAfterTimeout(): this {
    this.#lockAfterTimeout = true;
    return this;
  }

  /** The inactivity timeout, in seconds (`-t`). */
  timeout(seconds: number): this {
    this.#timeout = seconds;
    return this;
  }

  /** The keychain to configure (positional); the default keychain when omitted. */
  keychain(path: PathLike): this {
    this.#keychain = operand(path);
    return this;
  }

  /** Assemble the set-keychain-settings arguments. */
  protected override subcommandArgs(): string[] {
    const argv: string[] = [];
    if (this.#lockOnSleep) argv.push("-l");
    if (this.#lockAfterTimeout) argv.push("-u");
    if (this.#timeout !== undefined) argv.push("-t", String(this.#timeout));
    if (this.#keychain !== undefined) argv.push(this.#keychain);
    return argv;
  }
}

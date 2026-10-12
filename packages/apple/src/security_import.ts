// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `security` subcommands that put a signing identity into a keychain and
 * make it usable without a prompt: `import` and `set-key-partition-list`.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { operand } from "./operand.ts";
import { SecuritySettings } from "./security_settings.ts";

/** An item type `security import` accepts (`-t`). */
export type SecurityItemType = "pub" | "priv" | "session" | "cert" | "agg";

/** A file format `security import` accepts (`-f`). */
export type SecurityImportFormat =
  | "openssl"
  | "openssh1"
  | "openssh2"
  | "bsafe"
  | "raw"
  | "pkcs7"
  | "pkcs8"
  | "pkcs12"
  | "netscape"
  | "x509"
  | "pemseq";

/** Settings for `security import`. */
export class SecurityImportSettings extends SecuritySettings {
  #file?: string;
  #keychain?: string;
  #passphrase?: string;
  #applications: string[] = [];
  #type?: SecurityItemType;
  #format?: SecurityImportFormat;
  #nonExtractable = false;

  /** `import`. */
  protected override subcommand(): string {
    return "import";
  }

  /** The file to import, e.g. a `.p12` (positional). Required. */
  file(path: PathLike): this {
    this.#file = operand(path);
    return this;
  }

  /** The keychain to import into (`-k`); the default keychain when omitted. */
  keychain(path: PathLike): this {
    this.#keychain = String(path);
    return this;
  }

  /**
   * The file's passphrase (`-P`), e.g. a `.p12`'s export password. A secret:
   * masked in every rendering of the command.
   */
  passphrase(value: string): this {
    this.#passphrase = this.secret(value);
    return this;
  }

  /**
   * An application allowed to use the imported key without a prompt (`-T`),
   * e.g. `/usr/bin/codesign`; repeatable.
   */
  application(...paths: PathLike[]): this {
    this.#applications.push(...paths.map(String));
    return this;
  }

  /** The type of item in the file (`-t`). */
  type(value: SecurityItemType): this {
    this.#type = value;
    return this;
  }

  /** The file's format (`-f`), e.g. `pkcs12`. */
  format(value: SecurityImportFormat): this {
    this.#format = value;
    return this;
  }

  /** Make the imported private key non-extractable (`-x`). */
  nonExtractable(): this {
    this.#nonExtractable = true;
    return this;
  }

  /** Assemble the import arguments: the file, then its options. */
  protected override subcommandArgs(): string[] {
    if (this.#file === undefined) {
      throw new Error("security import: no file — add .file(path).");
    }
    const argv = [this.#file];
    if (this.#keychain !== undefined) argv.push("-k", this.#keychain);
    if (this.#passphrase !== undefined) argv.push("-P", this.#passphrase);
    for (const app of this.#applications) argv.push("-T", app);
    if (this.#type !== undefined) argv.push("-t", this.#type);
    if (this.#format !== undefined) argv.push("-f", this.#format);
    if (this.#nonExtractable) argv.push("-x");
    return argv;
  }
}

/**
 * Settings for `security set-key-partition-list`, which lets Apple's signing
 * tools use a key without the "allow access" prompt that hangs a headless
 * build.
 */
export class SecuritySetKeyPartitionListSettings extends SecuritySettings {
  #partitions: string[] = [];
  #privateKeys = false;
  #password?: string;
  #keychain?: string;

  /** `set-key-partition-list`. */
  protected override subcommand(): string {
    return "set-key-partition-list";
  }

  /**
   * Partition ids to allow (`-S`, comma-joined); repeatable. `apple-tool:`
   * and `apple:` cover `codesign` and the other Apple tools.
   */
  partitionList(...ids: string[]): this {
    this.#partitions.push(...ids);
    return this;
  }

  /** Match private keys only (`-s`). */
  privateKeys(): this {
    this.#privateKeys = true;
    return this;
  }

  /**
   * The keychain's password (`-k`). A secret: masked in every rendering of
   * the command. Without it `security` prompts for one.
   */
  password(value: string): this {
    this.#password = this.secret(value);
    return this;
  }

  /** The keychain to modify (positional); the default keychain when omitted. */
  keychain(path: PathLike): this {
    this.#keychain = operand(path);
    return this;
  }

  /** Assemble the set-key-partition-list arguments. */
  protected override subcommandArgs(): string[] {
    const argv: string[] = [];
    if (this.#partitions.length > 0) {
      argv.push("-S", this.#partitions.join(","));
    }
    if (this.#privateKeys) argv.push("-s");
    if (this.#password !== undefined) argv.push("-k", this.#password);
    if (this.#keychain !== undefined) argv.push(this.#keychain);
    return argv;
  }
}

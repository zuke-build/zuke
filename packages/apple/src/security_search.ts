// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `security` subcommands that read and change where signing identities
 * are looked up: `list-keychains` and `find-identity`, with the parsers that
 * read their output.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { operand } from "./operand.ts";
import { SecuritySettings } from "./security_settings.ts";

/** A preference domain `security list-keychains` reads or sets (`-d`). */
export type SecurityDomain = "user" | "system" | "common" | "dynamic";

/** Settings for `security list-keychains`. */
export class SecurityListKeychainsSettings extends SecuritySettings {
  #domain?: SecurityDomain;
  #set?: string[];

  /** `list-keychains`. */
  protected override subcommand(): string {
    return "list-keychains";
  }

  /** The preference domain to read or set (`-d`). */
  domain(value: SecurityDomain): this {
    this.#domain = value;
    return this;
  }

  /**
   * Replace the search list with these keychains (`-s`), in order. Called
   * with none, it empties the list. Repeat calls append.
   */
  set(...keychains: PathLike[]): this {
    this.#set = [...(this.#set ?? []), ...keychains.map(operand)];
    return this;
  }

  /** Assemble the list-keychains arguments. */
  protected override subcommandArgs(): string[] {
    const argv: string[] = [];
    if (this.#domain !== undefined) argv.push("-d", this.#domain);
    if (this.#set !== undefined) argv.push("-s", ...this.#set);
    return argv;
  }
}

/**
 * Parse `security list-keychains` output — one double-quoted path per line —
 * into the paths, in order.
 */
export function parseKeychainList(stdout: string): string[] {
  const keychains: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    keychains.push(trimmed.replace(/^"(.*)"$/, "$1"));
  }
  return keychains;
}

/** A signing identity as `security find-identity` lists it. */
export interface SecurityIdentity {
  /** The certificate's SHA-1 hash, 40 upper-case hex digits. */
  hash: string;
  /** The certificate's common name, e.g. `Developer ID Application: … (TEAMID)`. */
  name: string;
}

/** Settings for `security find-identity`. */
export class SecurityFindIdentitySettings extends SecuritySettings {
  #policy?: string;
  #search?: string;
  #valid = false;
  #keychains: string[] = [];

  /** `find-identity`. */
  protected override subcommand(): string {
    return "find-identity";
  }

  /** Only identities usable under this policy (`-p`), e.g. `codesigning`. */
  policy(name: string): this {
    this.#policy = name;
    return this;
  }

  /** Only identities whose name contains this string (`-s`). */
  search(value: string): this {
    this.#search = value;
    return this;
  }

  /** Only valid identities (`-v`) — not expired, revoked or untrusted. */
  valid(): this {
    this.#valid = true;
    return this;
  }

  /** The keychain(s) to search (positional); the search list when omitted. */
  keychain(...paths: PathLike[]): this {
    this.#keychains.push(...paths.map(operand));
    return this;
  }

  /** Assemble the find-identity arguments. */
  protected override subcommandArgs(): string[] {
    const argv: string[] = [];
    if (this.#valid) argv.push("-v");
    if (this.#policy !== undefined) argv.push("-p", this.#policy);
    if (this.#search !== undefined) argv.push("-s", this.#search);
    argv.push(...this.#keychains);
    return argv;
  }
}

/** One `find-identity` entry: `  1) <40 hex digits> "<name>"`, maybe with a status after. */
const IDENTITY_LINE =
  /^\s*\d+\)\s+([0-9A-Fa-f]{40})\s+"(.*)"(?:\s+\(.*\))?\s*$/;

/**
 * Parse `security find-identity` output into its identities, in order. Each
 * hash appears once: `find-identity` lists a policy's matching identities and
 * then, without `-v`, all of them again, so the second listing is dropped.
 */
export function parseIdentities(stdout: string): SecurityIdentity[] {
  const identities: SecurityIdentity[] = [];
  const seen = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    const match = IDENTITY_LINE.exec(line);
    if (match === null) continue;
    const upper = match[1].toUpperCase();
    const name = match[2];
    if (seen.has(upper)) continue;
    seen.add(upper);
    identities.push({ hash: upper, name });
  }
  return identities;
}

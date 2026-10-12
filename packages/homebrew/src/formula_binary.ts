// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link FormulaBinarySettings} — one prebuilt archive of a formula: the
 * platform it is for, where to download it, and its checksum.
 *
 * @module
 */

/** The operating systems a formula's `on_<os>` blocks name. */
export type FormulaOs = "macos" | "linux";

/** The CPU families a formula's `on_<arch>` blocks name. */
export type FormulaArch = "arm" | "intel";

/** A SHA-256 as Homebrew writes it: 64 lowercase hex digits. */
const SHA256 = /^[0-9a-f]{64}$/;

/** A validated binary, as the formula renders it. */
export interface FormulaBinary {
  /** The operating system. */
  os: FormulaOs;
  /** The CPU family. */
  arch: FormulaArch;
  /** The `https` download URL. */
  url: string;
  /** The archive's SHA-256, 64 lowercase hex digits. */
  sha256: string;
}

/**
 * Settings for one prebuilt binary of a formula, rendered as
 * `on_<os> do on_<arch> do url "…" sha256 "…" end end`.
 *
 * ```ts
 * s.binary((b) =>
 *   b.os("macos").arch("arm").url("https://…/app-aarch64-apple-darwin.tar.gz")
 *     .sha256("…")
 * )
 * ```
 */
export class FormulaBinarySettings {
  /** The operating system. Set by {@link os}. */
  os_?: FormulaOs;
  /** The CPU family. Set by {@link arch}. */
  arch_?: FormulaArch;
  /** The download URL. Set by {@link url}. */
  url_?: string;
  /** The archive's SHA-256. Set by {@link sha256}. */
  sha256_?: string;

  /** The operating system the archive runs on (required). */
  os(value: FormulaOs): this {
    this.os_ = value;
    return this;
  }

  /** The CPU family the archive runs on (required). */
  arch(value: FormulaArch): this {
    this.arch_ = value;
    return this;
  }

  /** Where Homebrew downloads the archive (required; must be `https`). */
  url(value: string): this {
    this.url_ = value;
    return this;
  }

  /** The archive's SHA-256 (required; 64 lowercase hex digits). */
  sha256(value: string): this {
    this.sha256_ = value;
    return this;
  }

  /**
   * Validate the settings into a {@link FormulaBinary}.
   *
   * @throws {Error} naming the missing or malformed field.
   */
  resolve_(): FormulaBinary {
    const { os_: os, arch_: arch, url_: url, sha256_: sha256 } = this;
    if (os === undefined) throw new Error("formula binary requires .os(...).");
    if (arch === undefined) {
      throw new Error("formula binary requires .arch(...).");
    }
    if (url === undefined) {
      throw new Error("formula binary requires .url(...).");
    }
    if (sha256 === undefined) {
      throw new Error("formula binary requires .sha256(...).");
    }
    assertHttpsUrl(url, `${os}/${arch} binary .url(...)`);
    if (!SHA256.test(sha256)) {
      throw new Error(
        `the ${os}/${arch} binary .sha256(...) must be 64 lowercase hex ` +
          `digits, got ${JSON.stringify(sha256)}.`,
      );
    }
    return { os, arch, url, sha256 };
  }
}

/**
 * Refuse anything but a well-formed `https` URL.
 *
 * Homebrew downloads and runs what the URL serves, so a plaintext URL is an
 * archive anyone on the path can replace — the checksum catches that, but only
 * after the download, and a formula that asks for it is wrong either way.
 * Whitespace and control characters are refused too: the URL parser would
 * quietly strip some of them, so the URL that was checked would not be the one
 * written into the formula. And a URL carrying a user name or password is
 * refused without being echoed, since a published formula would publish it.
 */
export function assertHttpsUrl(value: string, field: string): void {
  let parsed: URL | undefined;
  try {
    parsed = new URL(value);
  } catch {
    parsed = undefined;
  }
  const clean = [...value].every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code > 0x20 && code !== 0x7f;
  });
  // The value itself is never echoed: a URL can carry a credential, in its
  // userinfo or its query, and an error message is a log line.
  if (parsed === undefined || !clean) {
    throw new Error(
      `${field} must be a well-formed https:// URL with no whitespace or ` +
        `control characters.`,
    );
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      `${field} must be an https:// URL, not ${parsed.protocol}//.`,
    );
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error(
      `${field} must not carry a user name or password: a formula is ` +
        `published, so anything in its URL is published with it.`,
    );
  }
}

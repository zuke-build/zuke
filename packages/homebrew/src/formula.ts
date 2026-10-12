// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link FormulaSettings} and the renderer behind `HomebrewTasks.formula`: the
 * Ruby source of a Homebrew formula that installs prebuilt binaries.
 *
 * ```ts
 * const ruby = HomebrewTasks.formula((s) =>
 *   s.name("app").description("Build automation for Deno")
 *     .homepage("https://example.com").license("MIT")
 *     .binary((b) => b.os("macos").arch("arm").url(macArm).sha256(macArmSha))
 *     .binary((b) => b.os("linux").arch("intel").url(linux).sha256(linuxSha))
 *     .install("app")
 *     .test((t) => t.command("--version").expectVersion())
 * );
 * ```
 *
 * Every value reaches the Ruby through {@link rubyString}, and every value is
 * validated first, so what comes out is deterministic, passes `brew style`'s
 * layout, and holds nothing but the literals it was given.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import {
  assertHttpsUrl,
  type FormulaArch,
  type FormulaBinary,
  FormulaBinarySettings,
  type FormulaOs,
} from "./formula_binary.ts";
import { formulaClassName } from "./formula_name.ts";
import { FormulaTestSettings } from "./formula_test_block.ts";
import { rubyString } from "./ruby.ts";

/** The longest description `brew audit` accepts. */
const MAX_DESCRIPTION = 80;

/** An installable file name: no directory part, no `.`/`..`. */
const FILE_NAME = /^[A-Za-z0-9_+-][A-Za-z0-9._+-]*$/;

/** A version: no whitespace, starting with a letter or digit. */
const VERSION = /^[0-9A-Za-z][0-9A-Za-z._+~-]*$/;

/** An SPDX license identifier (or `LicenseRef-…`), as one token. */
const LICENSE = /^[A-Za-z0-9][A-Za-z0-9.+-]*$/;

/** The render order of the `on_<os>` blocks. */
const OS_ORDER: readonly FormulaOs[] = ["macos", "linux"];

/** The render order of the `on_<arch>` blocks inside each. */
const ARCH_ORDER: readonly FormulaArch[] = ["arm", "intel"];

/** Settings for a formula that installs prebuilt binaries. */
export class FormulaSettings {
  /** The formula name. Set by {@link name}. */
  name_?: string;
  /** The one-line description. Set by {@link description}. */
  description_?: string;
  /** The project's homepage. Set by {@link homepage}. */
  homepage_?: string;
  /** The version. Set by {@link version}. */
  version_?: string;
  /** The SPDX license. Set by {@link license}. */
  license_?: string;
  /** The binaries, one per platform. Added by {@link binary}. */
  binaries_: FormulaBinarySettings[] = [];
  /** The files `bin.install` places. Added by {@link install}. */
  install_: string[] = [];
  /** The caveats text. Set by {@link caveats}. */
  caveats_?: string;
  /** The `test do` block. Set by {@link test}. */
  test_?: FormulaTestSettings;

  /**
   * The formula name (required), e.g. `app` or `app@2`: a lowercase letter,
   * then lowercase letters, digits, `-`, `_`, `.`, `+` or `@`. The Ruby class
   * name is derived from it exactly as Homebrew does — `app-cli` defines
   * `AppCli`, `app@2` defines `AppAT2`.
   */
  name(value: string): this {
    this.name_ = value;
    return this;
  }

  /**
   * The one-line description (`desc`, required), held to `brew audit`'s rules:
   * at most 80 characters, starting with a capital letter, not with an
   * article or the formula's name, and with no trailing period.
   */
  description(text: string): this {
    this.description_ = text;
    return this;
  }

  /** The project's homepage (required; must be `https`). */
  homepage(url: string): this {
    this.homepage_ = url;
    return this;
  }

  /**
   * The version, e.g. `1.2.3` — set it only when Homebrew cannot read it from
   * the archive URLs.
   *
   * Homebrew detects a formula's version from its URL, and `brew audit`
   * rejects a `version` line that repeats what it detected ("version … is
   * redundant with version scanned from URL"). A GitHub release asset such as
   * `…/releases/download/v1.2.3/app-aarch64-apple-darwin.tar.gz` carries it, so
   * leave this unset there; `expectVersion()` in the test still works, against
   * the detected version. Set it for a URL with no version in it, such as a
   * `…/releases/latest/download/…` link or a content-addressed store.
   */
  version(value: string): this {
    this.version_ = value;
    return this;
  }

  /** The SPDX license identifier, e.g. `MIT`. */
  license(spdx: string): this {
    this.license_ = spdx;
    return this;
  }

  /**
   * Add a prebuilt archive for one OS and CPU family. Call once per platform;
   * at least one is required, and each OS/arch pair at most once.
   */
  binary(configure: Configure<FormulaBinarySettings>): this {
    this.binaries_.push(configure(new FormulaBinarySettings()));
    return this;
  }

  /**
   * Files from the archive to place in the formula's `bin` (`bin.install`);
   * at least one is required. Plain file names only — no directory part.
   */
  install(...files: string[]): this {
    this.install_.push(...files);
    return this;
  }

  /** Text Homebrew prints after installing (`def caveats`). */
  caveats(text: string): this {
    this.caveats_ = text;
    return this;
  }

  /**
   * The formula's `test do` block, which `brew test` runs. Without one,
   * `brew test` (and so `HomebrewTasks.verify`) fails.
   */
  test(configure: Configure<FormulaTestSettings>): this {
    this.test_ = configure(new FormulaTestSettings());
    return this;
  }
}

/** A required field's value, or a friendly error naming its setter. */
function required(value: string | undefined, setter: string): string {
  if (value === undefined) {
    throw new Error(`a formula requires .${setter}(...).`);
  }
  return value;
}

/** Whether `text` opens with `word` as a whole word, ignoring case. */
function startsWithWord(text: string, word: string): boolean {
  const lower = text.toLowerCase();
  return lower.startsWith(word) && !/[a-z0-9]/.test(lower.charAt(word.length));
}

/**
 * Hold a description to the rules `brew audit` enforces on `desc`.
 *
 * Enforced rather than documented because a tap formula that fails audit is
 * still installable — so nothing else would catch it until a reviewer did.
 */
function assertDescription(text: string, name: string): void {
  const problem = text.trim() !== text
    ? "must not start or end with whitespace"
    : text.length > MAX_DESCRIPTION
    ? `is ${text.length} characters; brew audit allows ${MAX_DESCRIPTION}`
    : !/^[A-Z0-9]/.test(text)
    ? "must start with a capital letter"
    : /^(a|an|the)\b/i.test(text)
    ? 'must not start with an article ("A", "An", "The")'
    : startsWithWord(text, name)
    ? `must not start with the formula's name (${JSON.stringify(name)})`
    : text.endsWith(".")
    ? "must not end with a period"
    : undefined;
  if (problem !== undefined) {
    throw new Error(
      `formula .description(${JSON.stringify(text)}) ${problem}.`,
    );
  }
}

/** Validate a value against `pattern`, naming the setter when it fails. */
function assertPattern(
  value: string,
  pattern: RegExp,
  setter: string,
  expected: string,
): void {
  if (!pattern.test(value)) {
    throw new Error(
      `formula .${setter}(${JSON.stringify(value)}) must be ${expected}.`,
    );
  }
}

/** Resolve the binaries, refusing none and any duplicated platform. */
function resolveBinaries(
  settings: readonly FormulaBinarySettings[],
): FormulaBinary[] {
  if (settings.length === 0) {
    throw new Error(
      "a formula requires at least one .binary((b) => b.os(...).arch(...)" +
        ".url(...).sha256(...)).",
    );
  }
  const seen = new Set<string>();
  return settings.map((entry) => {
    const binary = entry.resolve_();
    const key = `${binary.os}/${binary.arch}`;
    if (seen.has(key)) {
      throw new Error(
        `a formula has two ${key} binaries; declare each OS/arch pair once.`,
      );
    }
    seen.add(key);
    return binary;
  });
}

/** The `on_<os>` blocks, macOS before Linux and ARM before Intel. */
function platformLines(binaries: readonly FormulaBinary[]): string[] {
  const lines: string[] = [];
  for (const os of OS_ORDER) {
    const forOs = ARCH_ORDER.flatMap((arch) =>
      binaries.filter((binary) => binary.os === os && binary.arch === arch)
    );
    if (forOs.length === 0) continue;
    lines.push("", `  on_${os} do`);
    forOs.forEach((binary, index) => {
      if (index > 0) lines.push("");
      lines.push(
        `    on_${binary.arch} do`,
        `      url ${rubyString(binary.url)}`,
        `      sha256 ${rubyString(binary.sha256)}`,
        "    end",
      );
    });
    lines.push("  end");
  }
  return lines;
}

/**
 * Render the configured formula as Ruby source.
 *
 * @throws {Error} naming the setter whose value is missing or invalid.
 */
export function renderFormula(configure: Configure<FormulaSettings>): string {
  const settings = configure(new FormulaSettings());
  const name = required(settings.name_, "name");
  const className = formulaClassName(name);
  const description = required(settings.description_, "description");
  assertDescription(description, name);
  const homepage = required(settings.homepage_, "homepage");
  assertHttpsUrl(homepage, "formula .homepage(...)");
  const version = settings.version_;
  if (version !== undefined) {
    assertPattern(version, VERSION, "version", "a version such as 1.2.3");
  }
  const license = settings.license_;
  if (license !== undefined) {
    assertPattern(
      license,
      LICENSE,
      "license",
      "an SPDX identifier such as MIT",
    );
  }
  const binaries = resolveBinaries(settings.binaries_);
  if (settings.install_.length === 0) {
    throw new Error(
      'a formula requires .install("<binary>") — the file to place in bin.',
    );
  }
  for (const file of settings.install_) {
    assertPattern(file, FILE_NAME, "install", "a plain file name, no '/'");
  }

  const lines = [
    `class ${className} < Formula`,
    `  desc ${rubyString(description)}`,
    `  homepage ${rubyString(homepage)}`,
    ...(version === undefined ? [] : [`  version ${rubyString(version)}`]),
    ...(license === undefined ? [] : [`  license ${rubyString(license)}`]),
    ...platformLines(binaries),
    "",
    "  def install",
    ...settings.install_.map((file) => `    bin.install ${rubyString(file)}`),
    "  end",
  ];
  if (settings.caveats_ !== undefined) {
    lines.push(
      "",
      "  def caveats",
      `    ${rubyString(settings.caveats_)}`,
      "  end",
    );
  }
  if (settings.test_ !== undefined) {
    lines.push(
      "",
      "  test do",
      ...settings.test_.render_(settings.install_).map((line) => `    ${line}`),
      "  end",
    );
  }
  lines.push("end", "");
  return lines.join("\n");
}

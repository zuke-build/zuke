// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link ChocolateyPackageSettings} and the renderer behind
 * `ChocolateyTasks.package`: the source of a Chocolatey package that installs
 * a prebuilt Windows binary from a zip hosted on a release.
 *
 * ```ts
 * const pkg = ChocolateyTasks.package((s) =>
 *   s.id("app").version("1.2.3").title("App")
 *     .authors("Acme").projectUrl("https://example.com")
 *     .licenseUrl("https://example.com/LICENSE")
 *     .description("Command-line tool that builds and ships widgets")
 *     .tags("cli", "widgets")
 *     .url64bit(winUrl).checksum64(winSha)
 * );
 * // pkg.files: { "app.nuspec": "…", "tools/chocolateyinstall.ps1": "…" }
 * ```
 *
 * Every value is validated first, every nuspec value reaches the XML through
 * one escaper and every script value the PowerShell through another, so what
 * comes out is deterministic and holds nothing but the literals it was given.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { renderInstallScript } from "./install_script.ts";
import { type NuspecMetadata, renderNuspec } from "./nuspec.ts";
import { assertPackageId, assertPackageVersion } from "./package_identity.ts";
import { assertHttpsUrl } from "./url.ts";

/** The shortest description the community repository accepts (CPMR0032). */
const MIN_DESCRIPTION = 30;

/** The longest description the community repository accepts (CPMR0026). */
const MAX_DESCRIPTION = 4000;

/** A SHA-256: 64 hex digits, either case. */
const SHA256 = /^[0-9A-Fa-f]{64}$/;

/** The path of the install script inside a rendered package. */
export const INSTALL_SCRIPT = "tools/chocolateyinstall.ps1";

/**
 * A rendered Chocolatey package: its identity, and the files that make it up,
 * keyed by their path relative to the package directory —
 * `<id>.nuspec` and `tools/chocolateyinstall.ps1`.
 *
 * Plain data, so it can be written to disk, compared, or handed to
 * `ChocolateyTasks.verify` and `ChocolateyTasks.publish`, which write it to a
 * temporary directory and pack it there.
 */
export interface ChocolateyPackage {
  /** The package id. */
  readonly id: string;
  /** The package version. */
  readonly version: string;
  /** Each file's content, keyed by its `/`-separated relative path. */
  readonly files: Readonly<Record<string, string>>;
}

/** Settings for a package that installs a prebuilt binary from a zip. */
export class ChocolateyPackageSettings {
  /** The package id. Set by {@link id}. */
  id_?: string;
  /** The package version. Set by {@link version}. */
  version_?: string;
  /** The display title. Set by {@link title}. */
  title_?: string;
  /** The software's authors. Added by {@link authors}. */
  authors_: string[] = [];
  /** The package's maintainers. Added by {@link owners}. */
  owners_: string[] = [];
  /** The software's homepage. Set by {@link projectUrl}. */
  projectUrl_?: string;
  /** The license's URL. Set by {@link licenseUrl}. */
  licenseUrl_?: string;
  /** The icon's URL. Set by {@link iconUrl}. */
  iconUrl_?: string;
  /** The copyright notice. Set by {@link copyright}. */
  copyright_?: string;
  /** Where the package's source lives. Set by {@link packageSourceUrl}. */
  packageSourceUrl_?: string;
  /** The software's documentation. Set by {@link docsUrl}. */
  docsUrl_?: string;
  /** The software's issue tracker. Set by {@link bugTrackerUrl}. */
  bugTrackerUrl_?: string;
  /** The search tags. Added by {@link tags}. */
  tags_: string[] = [];
  /** The one-line summary. Set by {@link summary}. */
  summary_?: string;
  /** The description. Set by {@link description}. */
  description_?: string;
  /** The release notes. Set by {@link releaseNotes}. */
  releaseNotes_?: string;
  /** The 64-bit zip's URL. Set by {@link url64bit}. */
  url64bit_?: string;
  /** The 64-bit zip's SHA-256. Set by {@link checksum64}. */
  checksum64_?: string;

  /**
   * The package id (required), e.g. `app`: lowercase letters and digits,
   * joined by single `.`, `-` or `_`, at most 100 characters. It is also the
   * nuspec's file name, `<id>.nuspec`.
   */
  id(value: string): this {
    this.id_ = value;
    return this;
  }

  /**
   * The package version (required), a NuGet version such as `1.2.3`,
   * `1.2.3.4` or `1.2.3-beta.1` — usually the release's own version.
   */
  version(value: string): this {
    this.version_ = value;
    return this;
  }

  /** The display title (`<title>`), e.g. `App (Portable)`. */
  title(value: string): this {
    this.title_ = value;
    return this;
  }

  /** The software's authors (`<authors>`, required); repeatable. */
  authors(...names: string[]): this {
    this.authors_.push(...names);
    return this;
  }

  /**
   * The package's maintainers (`<owners>`) — on the community repository,
   * the user names that may push it; repeatable.
   */
  owners(...names: string[]): this {
    this.owners_.push(...names);
    return this;
  }

  /** The software's homepage (`<projectUrl>`, required; must be `https`). */
  projectUrl(url: string): this {
    this.projectUrl_ = url;
    return this;
  }

  /**
   * The license's URL (`<licenseUrl>`, `https`) — the community repository
   * requires it whenever the software has one.
   */
  licenseUrl(url: string): this {
    this.licenseUrl_ = url;
    return this;
  }

  /** The package icon's URL (`<iconUrl>`, `https`). */
  iconUrl(url: string): this {
    this.iconUrl_ = url;
    return this;
  }

  /**
   * Where the package's own source lives (`<packageSourceUrl>`, `https`) —
   * typically the repository whose build renders it.
   */
  packageSourceUrl(url: string): this {
    this.packageSourceUrl_ = url;
    return this;
  }

  /** The software's documentation (`<docsUrl>`, `https`). */
  docsUrl(url: string): this {
    this.docsUrl_ = url;
    return this;
  }

  /** The software's issue tracker (`<bugTrackerUrl>`, `https`). */
  bugTrackerUrl(url: string): this {
    this.bugTrackerUrl_ = url;
    return this;
  }

  /** Search tags (`<tags>`), each one word; repeatable. */
  tags(...values: string[]): this {
    this.tags_.push(...values);
    return this;
  }

  /**
   * The software's copyright notice (`<copyright>`), one line — e.g. the
   * line in its LICENSE, `Copyright (c) 2026 Acme`. The community
   * repository's moderators ask for it whenever the software has one.
   */
  copyright(text: string): this {
    this.copyright_ = text;
    return this;
  }

  /** A one-line summary (`<summary>`). */
  summary(text: string): this {
    this.summary_ = text;
    return this;
  }

  /**
   * The description (`<description>`, required; Markdown is fine), held to
   * the community repository's length rules: 30 to 4000 characters.
   */
  description(text: string): this {
    this.description_ = text;
    return this;
  }

  /** The release notes (`<releaseNotes>`): text, Markdown, or a URL. */
  releaseNotes(text: string): this {
    this.releaseNotes_ = text;
    return this;
  }

  /**
   * The 64-bit zip on the release (required; must be `https`) — what the
   * install script downloads (`url64bit`) and unpacks into the package's
   * `tools` directory, where choco shims every `.exe` it holds.
   */
  url64bit(url: string): this {
    this.url64bit_ = url;
    return this;
  }

  /**
   * The zip's SHA-256 (required; 64 hex digits) — checked by choco before
   * anything is unpacked (`checksum64`, with `checksumType64 = 'sha256'`).
   */
  checksum64(sha256: string): this {
    this.checksum64_ = sha256;
    return this;
  }
}

/** A required field's value, or a friendly error naming its setter. */
function required(value: string | undefined, setter: string): string {
  if (value === undefined) {
    throw new Error(`a Chocolatey package requires .${setter}(...).`);
  }
  return value;
}

/** Refuse an empty value, or one holding a control character or line break. */
function assertSingleLine(value: string, setter: string): void {
  if (value.trim() === "" || /\p{Cc}/u.test(value)) {
    throw new Error(
      `package .${setter}(${JSON.stringify(value)}) must be non-empty text ` +
        `on one line, with no control characters.`,
    );
  }
}

/** Validate a list of names that render comma-separated. */
function assertNames(names: readonly string[], setter: string): void {
  for (const name of names) {
    assertSingleLine(name, setter);
    if (name.includes(",")) {
      throw new Error(
        `package .${setter}(${JSON.stringify(name)}) must not contain a ` +
          `comma — the nuspec separates names with commas; pass each name ` +
          `as its own argument.`,
      );
    }
  }
}

/** Validate an optional `https` URL, naming its setter. */
function optionalUrl(
  value: string | undefined,
  setter: string,
): string | undefined {
  if (value !== undefined) assertHttpsUrl(value, `package .${setter}(...)`);
  return value;
}

/** Validate an optional single-line text, naming its setter. */
function optionalLine(
  value: string | undefined,
  setter: string,
): string | undefined {
  if (value !== undefined) assertSingleLine(value, setter);
  return value;
}

/** Hold the description to the community repository's length rules. */
function assertDescription(text: string): void {
  const length = [...text].length;
  if (text.trim() !== text || length < MIN_DESCRIPTION) {
    throw new Error(
      `package .description(...) must be at least ${MIN_DESCRIPTION} ` +
        `characters with no leading or trailing whitespace, got ${length}.`,
    );
  }
  if (length > MAX_DESCRIPTION) {
    throw new Error(
      `package .description(...) is ${length} characters; the community ` +
        `repository allows ${MAX_DESCRIPTION}.`,
    );
  }
}

/** Validate the settings into the nuspec's metadata. */
function nuspecMetadata(settings: ChocolateyPackageSettings): NuspecMetadata {
  const id = required(settings.id_, "id");
  assertPackageId(id);
  const version = required(settings.version_, "version");
  assertPackageVersion(version);
  if (settings.authors_.length === 0) {
    throw new Error("a Chocolatey package requires .authors(...).");
  }
  assertNames(settings.authors_, "authors");
  assertNames(settings.owners_, "owners");
  const projectUrl = required(settings.projectUrl_, "projectUrl");
  assertHttpsUrl(projectUrl, "package .projectUrl(...)");
  for (const tag of settings.tags_) {
    if (!/^[^\s\p{Cc}]+$/u.test(tag)) {
      throw new Error(
        `package .tags(${JSON.stringify(tag)}) must be one word — the ` +
          `nuspec separates tags with spaces.`,
      );
    }
  }
  const description = required(settings.description_, "description");
  assertDescription(description);
  return {
    id,
    version,
    packageSourceUrl: optionalUrl(
      settings.packageSourceUrl_,
      "packageSourceUrl",
    ),
    owners: settings.owners_,
    title: optionalLine(settings.title_, "title"),
    authors: settings.authors_,
    projectUrl,
    iconUrl: optionalUrl(settings.iconUrl_, "iconUrl"),
    copyright: optionalLine(settings.copyright_, "copyright"),
    licenseUrl: optionalUrl(settings.licenseUrl_, "licenseUrl"),
    docsUrl: optionalUrl(settings.docsUrl_, "docsUrl"),
    bugTrackerUrl: optionalUrl(settings.bugTrackerUrl_, "bugTrackerUrl"),
    tags: settings.tags_,
    summary: optionalLine(settings.summary_, "summary"),
    description,
    releaseNotes: settings.releaseNotes_,
  };
}

/**
 * Render the configured package.
 *
 * @throws {Error} naming the setter whose value is missing or invalid.
 */
export function renderPackage(
  configure: Configure<ChocolateyPackageSettings>,
): ChocolateyPackage {
  const settings = configure(new ChocolateyPackageSettings());
  const metadata = nuspecMetadata(settings);
  const url64bit = required(settings.url64bit_, "url64bit");
  assertHttpsUrl(url64bit, "package .url64bit(...)");
  const checksum64 = required(settings.checksum64_, "checksum64");
  if (!SHA256.test(checksum64)) {
    throw new Error(
      `package .checksum64(...) must be a SHA-256 — 64 hex digits — got ` +
        `${JSON.stringify(checksum64)}.`,
    );
  }
  const { id, version } = metadata;
  return {
    id,
    version,
    files: {
      [`${id}.nuspec`]: renderNuspec(metadata),
      [INSTALL_SCRIPT]: renderInstallScript({
        id,
        url64bit,
        checksum64: checksum64.toLowerCase(),
      }),
    },
  };
}

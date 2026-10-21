// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `.nuspec` half of a rendered package: the XML manifest `choco pack`
 * reads, laid out like the nuspec `choco new` generates.
 *
 * Internal: not re-exported from `mod.ts`. Its input is validated by the
 * package renderer; every value still goes through {@link xmlText} here.
 *
 * @module
 */

import { xmlText } from "./xml.ts";

/** The nuspec schema `choco new` writes, which choco v2 packs. */
const NUSPEC_SCHEMA =
  "http://schemas.microsoft.com/packaging/2015/06/nuspec.xsd";

/** The validated metadata a nuspec renders, in nuspec element order. */
export interface NuspecMetadata {
  /** `<id>`. */
  id: string;
  /** `<version>`. */
  version: string;
  /** `<packageSourceUrl>`, when set. */
  packageSourceUrl?: string;
  /** `<owners>`, comma-separated, when any. */
  owners: readonly string[];
  /** `<title>`, when set. */
  title?: string;
  /** `<authors>`, comma-separated. */
  authors: readonly string[];
  /** `<projectUrl>`. */
  projectUrl: string;
  /** `<iconUrl>`, when set. */
  iconUrl?: string;
  /** `<copyright>`, when set. */
  copyright?: string;
  /** `<licenseUrl>`, when set. */
  licenseUrl?: string;
  /** `<docsUrl>`, when set. */
  docsUrl?: string;
  /** `<bugTrackerUrl>`, when set. */
  bugTrackerUrl?: string;
  /** `<tags>`, space-separated, when any. */
  tags: readonly string[];
  /** `<summary>`, when set. */
  summary?: string;
  /** `<description>`. */
  description: string;
  /** `<releaseNotes>`, when set. */
  releaseNotes?: string;
}

/** One `<name>value</name>` line, or nothing for an unset value. */
function element(name: string, value: string | undefined): string[] {
  if (value === undefined) return [];
  return [`    <${name}>${xmlText(value, `the nuspec <${name}>`)}</${name}>`];
}

/** A list rendered with `separator`, or unset when it is empty. */
function joined(
  values: readonly string[],
  separator: string,
): string | undefined {
  return values.length === 0 ? undefined : values.join(separator);
}

/**
 * Render the nuspec. `requireLicenseAcceptance` is always `false`: the package
 * installs unattended, and a license that must be accepted would stop it.
 */
export function renderNuspec(metadata: NuspecMetadata): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<package xmlns="${NUSPEC_SCHEMA}">`,
    "  <metadata>",
    ...element("id", metadata.id),
    ...element("version", metadata.version),
    ...element("packageSourceUrl", metadata.packageSourceUrl),
    ...element("owners", joined(metadata.owners, ", ")),
    ...element("title", metadata.title),
    ...element("authors", joined(metadata.authors, ", ")),
    ...element("projectUrl", metadata.projectUrl),
    ...element("iconUrl", metadata.iconUrl),
    ...element("copyright", metadata.copyright),
    ...element("licenseUrl", metadata.licenseUrl),
    "    <requireLicenseAcceptance>false</requireLicenseAcceptance>",
    ...element("docsUrl", metadata.docsUrl),
    ...element("bugTrackerUrl", metadata.bugTrackerUrl),
    ...element("tags", joined(metadata.tags, " ")),
    ...element("summary", metadata.summary),
    ...element("description", metadata.description),
    ...element("releaseNotes", metadata.releaseNotes),
    "  </metadata>",
    "  <files>",
    '    <file src="tools\\**" target="tools" />',
    "  </files>",
    "</package>",
    "",
  ].join("\n");
}

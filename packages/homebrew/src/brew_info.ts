// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `brew info --json=v2`, and the parser that turns what it prints into a
 * typed {@link BrewInfo}.
 *
 * Only what a build asks of a formula is typed — its name, its versions and
 * the versions installed — and every field is read with a check rather than
 * asserted, so a Homebrew that renames one fails with the field's name instead
 * of an `undefined` flowing on.
 *
 * @module
 */

import { BrewCommandSettings } from "./brew_settings.ts";

/** A formula's available versions, as `brew info` reports them. */
export interface BrewFormulaVersions {
  /** The stable version, or `null` for a HEAD-only formula. */
  stable: string | null;
  /** The HEAD version, or `null` when the formula has no HEAD spec. */
  head: string | null;
  /** Whether a bottle (a prebuilt package) exists for this platform. */
  bottle: boolean;
}

/** One formula, as `brew info --json=v2` describes it. */
export interface BrewFormulaInfo {
  /** The short name, e.g. `app`. */
  name: string;
  /** The fully qualified name, e.g. `acme/tap/app`. */
  fullName: string;
  /** The tap it comes from, e.g. `acme/tap`, or `null` for a path formula. */
  tap: string | null;
  /** The one-line description, or `null` when it has none. */
  desc: string | null;
  /** The homepage, or `null` when it has none. */
  homepage: string | null;
  /** The available versions. */
  versions: BrewFormulaVersions;
  /** The installed versions, oldest first as brew lists them; empty when none. */
  installed: string[];
  /** The linked keg's version, or `null` when none is linked. */
  linkedKeg: string | null;
  /** Whether an installed version is older than the current one. */
  outdated: boolean;
}

/** What `brew info --json=v2` reported. */
export interface BrewInfo {
  /** The formulae, in the order brew printed them. */
  formulae: BrewFormulaInfo[];
}

/**
 * Settings for `brew info`, which always runs with `--json=v2` — the
 * documented, machine-readable form — so the task can hand back a
 * {@link BrewInfo}.
 */
export class BrewInfoSettings extends BrewCommandSettings {
  #formula = false;
  #installed = false;

  /** Formulae to describe; repeatable. */
  formulae(...names: string[]): this {
    this.addOperands(names);
    return this;
  }

  /** Treat every name as a formula, not a cask (`--formula`). */
  formula(): this {
    this.#formula = true;
    return this;
  }

  /** Describe every installed formula (`--installed`), instead of naming them. */
  installed(): this {
    this.#installed = true;
    return this;
  }

  /** The subcommand: `info`. */
  protected verb(): string {
    return "info";
  }

  /** `--json=v2`, then the flags set. */
  protected commandFlags(): string[] {
    const argv = ["--json=v2"];
    if (this.#formula) argv.push("--formula");
    if (this.#installed) argv.push("--installed");
    return argv;
  }
}

/** Whether `value` is a plain JSON object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Fail naming the field `brew info` did not report as expected. */
function malformed(field: string): Error {
  return new Error(
    `brew info --json=v2 printed an unexpected document: ${field} is ` +
      `missing or has the wrong type.`,
  );
}

/** A required string field. */
function text(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw malformed(key);
  return value;
}

/** A string field that may be `null` (or absent). */
function nullableText(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw malformed(key);
  return value;
}

/** One formula entry. */
function parseFormula(entry: unknown): BrewFormulaInfo {
  if (!isObject(entry)) throw malformed("formulae[]");
  const versions = entry.versions;
  if (!isObject(versions)) throw malformed("versions");
  const installed = entry.installed;
  if (!Array.isArray(installed)) throw malformed("installed");
  return {
    name: text(entry, "name"),
    fullName: text(entry, "full_name"),
    tap: nullableText(entry, "tap"),
    desc: nullableText(entry, "desc"),
    homepage: nullableText(entry, "homepage"),
    versions: {
      stable: nullableText(versions, "stable"),
      head: nullableText(versions, "head"),
      bottle: versions.bottle === true,
    },
    installed: installed.map((keg) => {
      if (!isObject(keg)) throw malformed("installed[]");
      return text(keg, "version");
    }),
    linkedKeg: nullableText(entry, "linked_keg"),
    outdated: entry.outdated === true,
  };
}

/**
 * Parse what `brew info --json=v2` printed.
 *
 * @throws {Error} naming the field when the document is not the shape
 *   Homebrew documents.
 */
export function parseBrewInfo(stdout: string): BrewInfo {
  let document: unknown;
  try {
    document = JSON.parse(stdout);
  } catch {
    throw new Error(
      `brew info --json=v2 printed something that is not JSON: ` +
        `${stdout.slice(0, 200)}`,
    );
  }
  if (!isObject(document) || !Array.isArray(document.formulae)) {
    throw malformed("formulae");
  }
  return { formulae: document.formulae.map(parseFormula) };
}

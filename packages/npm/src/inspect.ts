// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The commands that report on the dependency tree rather than change it:
 * `npm ls`, `outdated`, `audit`, and `sbom`.
 *
 * ```ts
 * import { NpmTasks } from "jsr:@zuke/npm";
 * await NpmTasks.ls((s) => s.depth(0));
 * const stale = await NpmTasks.outdatedEntries();
 * const audit = await NpmTasks.auditSummary();
 * if (audit.high + audit.critical > 0) throw new Error("vulnerable deps");
 * ```
 *
 * {@link "./npm.ts".NpmTasks.outdatedEntries} and
 * {@link "./npm.ts".NpmTasks.auditSummary} hand back values: they pin
 * `--json` and narrow the payload with type guards, because npm's JSON is an
 * external input whose shape moves between versions. Both also treat a
 * non-zero exit as data — `npm outdated` exits 1 *because* something is
 * outdated, and `npm audit` exits 1 *because* it found a vulnerability, which
 * is the answer being asked for rather than a failure.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import {
  type NpmIncludeType,
  type NpmOmitType,
  NpmWorkspaceSettings,
} from "./settings.ts";
import {
  isJsonRecord,
  numberField,
  parseJsonRecord,
  stringField,
} from "./json.ts";
import { dependencyGroupArgs } from "./flags.ts";

/** Settings for `npm ls`. */
export class NpmLsSettings extends NpmWorkspaceSettings {
  #spec?: string;
  #depth?: number;
  #all = false;
  #long = false;
  #parseable = false;
  #omit: NpmOmitType[] = [];

  /** Limit the listing to one package spec (positional). */
  spec(value: string): this {
    this.#spec = value;
    return this;
  }

  /** How deep to walk the tree (`--depth=<n>`); `0` lists direct dependencies. */
  depth(levels: number): this {
    this.#depth = levels;
    return this;
  }

  /** Show every dependency, not just the top level (`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Include extended information (`--long`). */
  long(): this {
    this.#long = true;
    return this;
  }

  /** Emit one line per package, tab-separated (`--parseable`). */
  parseable(): this {
    this.#parseable = true;
    return this;
  }

  /** Skip a dependency group (`--omit=<group>`); repeatable. */
  omit(...types: NpmOmitType[]): this {
    this.#omit.push(...types);
    return this;
  }

  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "ls";

  /** Assemble the `npm ls` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["ls"];
    if (this.#all) argv.push("--all");
    if (this.#long) argv.push("--long");
    if (this.#parseable) argv.push("--parseable");
    if (this.#depth !== undefined) argv.push(`--depth=${this.#depth}`);
    argv.push(...dependencyGroupArgs(this.#omit, []));
    argv.push(...this.workspaceArgs());
    if (this.#spec !== undefined) argv.push(this.#spec);
    return argv;
  }
}

/** Settings for `npm outdated`. */
export class NpmOutdatedSettings extends NpmWorkspaceSettings {
  #specs: string[] = [];
  #all = false;
  #long = false;

  /** Limit the report to these package specs (positional); repeatable. */
  packages(...specs: string[]): this {
    this.#specs.push(...specs);
    return this;
  }

  /** Report transitive dependencies too (`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Include the package type and homepage (`--long`). */
  long(): this {
    this.#long = true;
    return this;
  }

  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "outdated";

  /** Assemble the `npm outdated` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["outdated"];
    if (this.#all) argv.push("--all");
    if (this.#long) argv.push("--long");
    argv.push(...this.workspaceArgs(), ...this.#specs);
    return argv;
  }
}

/** One dependency `npm outdated` reports as behind. */
export interface NpmOutdatedEntry {
  /** The package name. */
  name: string;
  /** The version installed now, absent when the package is missing entirely. */
  current?: string;
  /** The newest version the range in `package.json` allows. */
  wanted?: string;
  /** The newest version published. */
  latest?: string;
  /** Where in the tree it is installed. */
  location?: string;
  /** The package that depends on it. */
  dependent?: string;
}

/**
 * Parse `npm outdated --json`, whose payload maps each package name to its
 * versions. A malformed or empty payload yields no entries rather than a
 * throw: "nothing is outdated" and "npm printed nothing" look the same here,
 * and both mean there is nothing to act on.
 *
 * Not part of the package's public surface — exported for its unit test.
 */
export function parseOutdated(stdout: string): NpmOutdatedEntry[] {
  const record = parseJsonRecord(stdout);
  if (record === undefined) return [];
  const entries: NpmOutdatedEntry[] = [];
  for (const [name, value] of Object.entries(record)) {
    if (!isJsonRecord(value)) continue;
    const entry: NpmOutdatedEntry = { name };
    const current = stringField(value, "current");
    const wanted = stringField(value, "wanted");
    const latest = stringField(value, "latest");
    const location = stringField(value, "location");
    const dependent = stringField(value, "dependent");
    if (current !== undefined) entry.current = current;
    if (wanted !== undefined) entry.wanted = wanted;
    if (latest !== undefined) entry.latest = latest;
    if (location !== undefined) entry.location = location;
    if (dependent !== undefined) entry.dependent = dependent;
    entries.push(entry);
  }
  return entries;
}

/**
 * Run `npm outdated --json` and parse it. Backs
 * {@link "./npm.ts".NpmTasks.outdatedEntries}.
 */
export async function readOutdated(
  configure?: Configure<NpmOutdatedSettings>,
): Promise<NpmOutdatedEntry[]> {
  const settings = new NpmOutdatedSettings();
  const configured = configure ? configure(settings) : settings;
  // npm exits 1 when anything is outdated — the very case being asked about.
  const output = await configured.json().noThrow().run();
  return parseOutdated(output.stdout);
}

/** Settings for `npm audit`. */
export class NpmAuditSettings extends NpmWorkspaceSettings {
  #fix = false;
  #signatures = false;
  #auditLevel?: string;
  #omit: NpmOmitType[] = [];
  #include: NpmIncludeType[] = [];
  #packageLockOnly = false;
  #dryRun = false;

  /** Install compatible updates for what it finds (`npm audit fix`). */
  fix(): this {
    this.#fix = true;
    return this;
  }

  /** Verify the registry signatures of what is installed (`npm audit signatures`). */
  signatures(): this {
    this.#signatures = true;
    return this;
  }

  /**
   * The severity at which the command fails
   * (`--audit-level=<info|low|moderate|high|critical|none>`).
   */
  auditLevel(
    level: "info" | "low" | "moderate" | "high" | "critical" | "none",
  ): this {
    this.#auditLevel = level;
    return this;
  }

  /** Skip a dependency group (`--omit=<group>`); repeatable. */
  omit(...types: NpmOmitType[]): this {
    this.#omit.push(...types);
    return this;
  }

  /** Keep a dependency group npm would otherwise omit (`--include=<group>`); repeatable. */
  include(...types: NpmIncludeType[]): this {
    this.#include.push(...types);
    return this;
  }

  /** Audit the lockfile without touching `node_modules` (`--package-lock-only`). */
  packageLockOnly(): this {
    this.#packageLockOnly = true;
    return this;
  }

  /** Report what a fix would change without changing it (`--dry-run`). */
  dryRun(): this {
    this.#dryRun = true;
    return this;
  }

  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "audit";

  /** Assemble the `npm audit` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#fix && this.#signatures) {
      throw new Error(
        "NpmTasks.audit: .fix() installs updates and .signatures() verifies " +
          "what is installed — pick one.",
      );
    }
    const argv = ["audit"];
    if (this.#fix) argv.push("fix");
    if (this.#signatures) argv.push("signatures");
    if (this.#auditLevel !== undefined) {
      argv.push(`--audit-level=${this.#auditLevel}`);
    }
    if (this.#packageLockOnly) argv.push("--package-lock-only");
    if (this.#dryRun) argv.push("--dry-run");
    argv.push(...dependencyGroupArgs(this.#omit, this.#include));
    argv.push(...this.workspaceArgs());
    return argv;
  }
}

/** How many vulnerabilities `npm audit` found, by severity. */
export interface NpmAuditSummary {
  /** Informational findings. */
  info: number;
  /** Low-severity findings. */
  low: number;
  /** Moderate-severity findings. */
  moderate: number;
  /** High-severity findings. */
  high: number;
  /** Critical-severity findings. */
  critical: number;
  /** Every finding, whatever its severity. */
  total: number;
}

/** A summary with every count zeroed — what a clean audit reports. */
function emptySummary(): NpmAuditSummary {
  return { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
}

/**
 * Parse the vulnerability counts out of `npm audit --json`, which nests them
 * under `metadata.vulnerabilities`. A payload without them — an older npm, or
 * a registry that refused the request — reads as a clean audit, so callers
 * must treat {@link NpmAuditSummary} as "what npm reported", not as proof.
 *
 * Not part of the package's public surface — exported for its unit test.
 */
export function parseAuditSummary(stdout: string): NpmAuditSummary {
  const summary = emptySummary();
  const record = parseJsonRecord(stdout);
  if (record === undefined) return summary;
  const metadata = record["metadata"];
  if (!isJsonRecord(metadata)) return summary;
  const counts = metadata["vulnerabilities"];
  if (!isJsonRecord(counts)) return summary;
  for (const key of ["info", "low", "moderate", "high", "critical"] as const) {
    summary[key] = numberField(counts, key) ?? 0;
  }
  // npm reports its own `total`; fall back to the sum when it is absent.
  summary.total = numberField(counts, "total") ??
    summary.info + summary.low + summary.moderate + summary.high +
      summary.critical;
  return summary;
}

/**
 * Run `npm audit --json` and parse its counts. Backs
 * {@link "./npm.ts".NpmTasks.auditSummary}.
 */
export async function readAuditSummary(
  configure?: Configure<NpmAuditSettings>,
): Promise<NpmAuditSummary> {
  const settings = new NpmAuditSettings();
  const configured = configure ? configure(settings) : settings;
  // npm exits non-zero when it finds something — which is the answer, not a
  // failure; a target decides for itself what severity is worth failing on.
  const output = await configured.json().noThrow().run();
  return parseAuditSummary(output.stdout);
}

/** Settings for `npm sbom`. */
export class NpmSbomSettings extends NpmWorkspaceSettings {
  #format?: string;
  #type?: string;
  #omit: NpmOmitType[] = [];
  #packageLockOnly = false;

  /** Which document to emit (`--sbom-format=<cyclonedx|spdx>`), required by npm. */
  sbomFormat(format: "cyclonedx" | "spdx"): this {
    this.#format = format;
    return this;
  }

  /** What the project is (`--sbom-type=<library|application|framework>`). */
  sbomType(type: "library" | "application" | "framework"): this {
    this.#type = type;
    return this;
  }

  /** Skip a dependency group (`--omit=<group>`); repeatable. */
  omit(...types: NpmOmitType[]): this {
    this.#omit.push(...types);
    return this;
  }

  /** Build the document from the lockfile alone (`--package-lock-only`). */
  packageLockOnly(): this {
    this.#packageLockOnly = true;
    return this;
  }

  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "sbom";

  /** Assemble the `npm sbom` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#format === undefined) {
      throw new Error(
        "NpmTasks.sbom: .sbomFormat(...) is required — npm has no default " +
          "document format.",
      );
    }
    const argv = ["sbom", `--sbom-format=${this.#format}`];
    if (this.#type !== undefined) argv.push(`--sbom-type=${this.#type}`);
    if (this.#packageLockOnly) argv.push("--package-lock-only");
    argv.push(...dependencyGroupArgs(this.#omit, []));
    argv.push(...this.workspaceArgs());
    return argv;
  }
}

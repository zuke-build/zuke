// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `outdated` command: which JSR packages the lock resolves are behind
 * their latest release.
 *
 * It exists because nothing else answers that question for a build whose
 * specifiers are written inline (`jsr:@zuke/git@^1` in `zuke.ts`) rather than
 * in an import map. `deno outdated` reads manifests, so it says nothing about
 * them; the lock keeps resolving the versions recorded when the build was
 * written, and `--frozen` is perfectly happy with that, because a stale-but-
 * valid lock is exactly what `--frozen` is for. The result is a build that can
 * sit several minor versions behind a wrapper for months, still hand-rolling a
 * command the package has since typed, with no signal of any kind.
 *
 * The lock is the source of truth here rather than the import map: it records
 * what a run *actually resolves*, which is the number a stale pin hides.
 *
 * It needs the network, which is why it is a command a person runs rather than
 * a line in `--list` or the run summary — those must stay offline and instant.
 *
 * @module
 */

import { httpJson } from "./http.ts";
import { readTextOrNull } from "./internal.ts";

/** The default JSR registry origin; overridden in tests. */
export const JSR_REGISTRY = "https://jsr.io";

/** The lock file an unqualified run reads. */
export const DEFAULT_LOCK_PATH = "deno.lock";

/** A JSR package whose resolved version is behind the registry's latest. */
export interface OutdatedPackage {
  /** The package name, e.g. `@zuke/git`. */
  name: string;
  /** The specifier as written, e.g. `jsr:@zuke/git@^1`. */
  specifier: string;
  /** The version the lock resolves that specifier to. */
  resolved: string;
  /** The latest version the registry publishes. */
  latest: string;
}

/** Options for {@link findOutdated}. */
export interface OutdatedOptions {
  /** The lock file to read (default {@link DEFAULT_LOCK_PATH}). */
  lockPath?: string;
  /** The registry origin to query (default {@link JSR_REGISTRY}). */
  registry?: string;
  /** The `fetch` to use; injected so the command is testable without network. */
  fetch?: typeof fetch;
}

/** One `jsr:` entry of a lock file's `specifiers` map. */
interface LockedSpecifier {
  /** The specifier as written, e.g. `jsr:@zuke/git@^1`. */
  specifier: string;
  /** The package it names, e.g. `@zuke/git`. */
  name: string;
  /** The version the lock resolves it to. */
  resolved: string;
}

/** A `jsr:` specifier: the scoped name, then the range the author wrote. */
const JSR_SPECIFIER = /^jsr:(@[^/@]+\/[^@]+)(?:@(.*))?$/;

/** A version's numeric core, ignoring any prerelease or build suffix. */
const VERSION_CORE = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

/**
 * The `jsr:` specifiers a lock resolves, in the order the lock lists them.
 *
 * Tolerant by design: a lock whose shape is unfamiliar yields no entries
 * rather than throwing, because "I could not read your lock" is a worse answer
 * to `zuke outdated` than "nothing to report" only if it is silent — and the
 * caller distinguishes the two by the specifier count, not by an exception.
 */
export function lockedJsrSpecifiers(lockText: string): LockedSpecifier[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(lockText);
  } catch {
    return [];
  }
  if (parsed === null || typeof parsed !== "object") return [];
  const specifiers: unknown = Reflect.get(parsed, "specifiers");
  if (specifiers === null || typeof specifiers !== "object") return [];
  const entries: LockedSpecifier[] = [];
  for (const [specifier, resolved] of Object.entries(specifiers)) {
    if (typeof resolved !== "string") continue;
    const match = JSR_SPECIFIER.exec(specifier);
    if (match === null) continue;
    entries.push({ specifier, name: match[1], resolved });
  }
  return entries;
}

/**
 * Whether `resolved` is behind `latest`, comparing major, minor and patch
 * numerically — so `1.10.0` counts as newer than `1.9.0`, which a string
 * comparison gets wrong exactly once the tenth release lands.
 *
 * A version either side cannot parse as a numeric core is reported as *not*
 * behind: the honest answer to two versions this cannot order is silence, and
 * a wrong "you are behind" would send someone bumping a pin that is already
 * current. A prerelease sorts below the release it precedes.
 */
export function isBehind(resolved: string, latest: string): boolean {
  const a = VERSION_CORE.exec(resolved);
  const b = VERSION_CORE.exec(latest);
  if (a === null || b === null) return false;
  for (let i = 1; i <= 3; i++) {
    const mine = Number(a[i]);
    const theirs = Number(b[i]);
    if (mine !== theirs) return mine < theirs;
  }
  // Same numeric core: a prerelease (1.2.0-rc.1) is behind the release itself.
  return resolved !== latest && resolved.includes("-") && !latest.includes("-");
}

/** The `latest` field of a JSR package's `meta.json`, or `undefined`. */
function latestOf(meta: unknown): string | undefined {
  if (meta === null || typeof meta !== "object") return undefined;
  const latest: unknown = Reflect.get(meta, "latest");
  return typeof latest === "string" ? latest : undefined;
}

/**
 * The JSR packages the lock at `lockPath` resolves to a version older than the
 * registry's latest.
 *
 * One registry request per distinct package name, whatever the number of
 * specifiers pointing at it. A package the registry cannot answer for is
 * skipped rather than failing the whole report — one unpublished or renamed
 * dependency should not hide the news about the others.
 */
export async function findOutdated(
  options: OutdatedOptions = {},
): Promise<OutdatedPackage[]> {
  const lockPath = options.lockPath ?? DEFAULT_LOCK_PATH;
  const lockText = await readTextOrNull(lockPath);
  if (lockText === null) {
    throw new Error(
      `outdated: no lock file at "${lockPath}", so there are no resolved ` +
        "versions to compare. Run the build once, or `deno install`, to " +
        "write one.",
    );
  }
  const registry = options.registry ?? JSR_REGISTRY;
  const behind: OutdatedPackage[] = [];
  const latestByName = new Map<string, string | undefined>();
  for (const entry of lockedJsrSpecifiers(lockText)) {
    if (!latestByName.has(entry.name)) {
      latestByName.set(
        entry.name,
        await readLatest(registry, entry.name, options.fetch),
      );
    }
    const latest = latestByName.get(entry.name);
    if (latest === undefined || !isBehind(entry.resolved, latest)) continue;
    behind.push({
      name: entry.name,
      specifier: entry.specifier,
      resolved: entry.resolved,
      latest,
    });
  }
  return behind;
}

/** The registry's latest version for `name`, or `undefined` if it cannot say. */
async function readLatest(
  registry: string,
  name: string,
  fetchImpl?: typeof fetch,
): Promise<string | undefined> {
  try {
    const meta = await httpJson<unknown>(
      `${registry}/${name}/meta.json`,
      fetchImpl === undefined ? {} : { fetch: fetchImpl },
    );
    return latestOf(meta);
  } catch {
    // A 404, a rename, a private scope, or an offline runner. The command's
    // job is to surface the packages it *can* speak for.
    return undefined;
  }
}

/**
 * The report `zuke outdated` prints: one aligned line per package that is
 * behind, or a single line saying everything is current.
 */
export function formatOutdated(packages: readonly OutdatedPackage[]): string {
  if (packages.length === 0) {
    return "Every JSR package the lock resolves is at its latest release.";
  }
  const width = Math.max(...packages.map((p) => p.name.length));
  const lines = packages.map((p) =>
    `${p.name.padEnd(width)}  ${p.resolved}  →  ${p.latest}`
  );
  const count = packages.length === 1
    ? "1 package is"
    : `${packages.length} packages are`;
  lines.push(
    "",
    `${count} behind. Refresh the lock with a plain \`deno cache --reload\` ` +
      "— `--reload=jsr:` re-resolves from cached registry metadata and hands " +
      "back the same versions.",
  );
  return lines.join("\n");
}

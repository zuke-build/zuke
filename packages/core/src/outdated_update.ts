// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `outdated --update` half of the command: move the versions the lock
 * resolves up to the registry's latest.
 *
 * `outdated` finds what is behind and then tells a person to delete those
 * entries from the lock by hand, because nothing else will do it for them.
 * That is not an oversight in Deno: `deno outdated --update` reads manifests,
 * so it cannot see an inline `jsr:@zuke/git@^1` at all, and `deno install`
 * leaves an entry alone as long as it still satisfies the range — which a
 * stale-but-valid entry does, by definition. Removing the entry and resolving
 * again is the only thing that moves it, so that is what this automates.
 *
 * Two things shape the design. The rewrite is a pure string-to-string
 * function, so every shape of lock is testable without a filesystem or a
 * network. And the original text is restored if re-resolution fails, because
 * the alternative is leaving a lock with holes in it — every launcher and task
 * in this project runs `--frozen`, which such a lock fails.
 *
 * @module
 */

import { denoExecutable } from "./host.ts";
import { messageOf, readTextOrNull, writeTextEnsuringDir } from "./internal.ts";
import {
  DEFAULT_LOCK_PATH,
  findOutdated,
  lockedJsrSpecifiers,
  type OutdatedOptions,
} from "./outdated.ts";

/** A package whose resolved version moved. */
export interface UpdatedPackage {
  /** The package name, e.g. `@zuke/git`. */
  name: string;
  /** The version the lock resolved before. */
  from: string;
  /** The version it resolves now. */
  to: string;
}

/**
 * A package that is behind but did not move, because its specifier forbids the
 * newer release.
 *
 * Reported rather than counted as updated: the lock was never what pinned it,
 * so re-resolving cannot help and saying "updated" would be false. Widening
 * the range is an edit to the author's source, which this command does not
 * make on their behalf.
 */
export interface HeldPackage {
  /** The package name, e.g. `@std/yaml`. */
  name: string;
  /** The version it is still resolved to. */
  resolved: string;
  /** The version the registry publishes. */
  latest: string;
  /** The specifier that holds it there, e.g. `jsr:@std/yaml@1.0.5`. */
  specifier: string;
}

/** What {@link updateOutdated} did: what moved, and what could not. */
export interface UpdateReport {
  /** Packages whose resolved version moved up. */
  updated: UpdatedPackage[];
  /** Packages still behind, pinned by their specifier rather than the lock. */
  held: HeldPackage[];
  /** Packages the registry could not be asked about; see `OutdatedReport`. */
  unchecked: { name: string; resolved: string; reason: string }[];
}

/** Re-resolve the lock at `lockPath` after entries were dropped from it. */
export type ResolveLock = (lockPath: string) => Promise<void>;

/** Options for {@link updateOutdated}. */
export interface UpdateOptions extends OutdatedOptions {
  /**
   * Restrict the update to these package names; every behind package when
   * omitted. A name the lock does not resolve at all is an error rather than a
   * silent no-op, because a typo would otherwise read as "nothing to do".
   */
  only?: readonly string[];
  /**
   * How to re-resolve after the entries are dropped. Injected so the whole
   * command is testable without a network or a `deno` subprocess.
   */
  resolve?: ResolveLock;
}

/**
 * The lock text with every `jsr:` entry for `names` removed — both the
 * `specifiers` mapping and the `jsr` integrity records that back it.
 *
 * Pure, and strict where {@link lockedJsrSpecifiers} is tolerant: that one
 * answers a question and may reasonably say "nothing", while this one is about
 * to overwrite the file, and rewriting a lock whose shape was not understood
 * is how a working project gets broken.
 *
 * @throws If the text is not a JSON object, or has no `specifiers` map.
 */
export function dropLockEntries(
  lockText: string,
  names: readonly string[],
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(lockText);
  } catch (error) {
    throw new Error(`the lock file is not valid JSON: ${messageOf(error)}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("the lock file is not a JSON object.");
  }
  const specifiers: unknown = Reflect.get(parsed, "specifiers");
  if (
    specifiers === null || typeof specifiers !== "object" ||
    Array.isArray(specifiers)
  ) {
    throw new Error("the lock file has no `specifiers` map to update.");
  }
  const wanted = new Set(names);
  for (const entry of lockedJsrSpecifiers(lockText)) {
    if (wanted.has(entry.name)) {
      Reflect.deleteProperty(specifiers, entry.specifier);
    }
  }
  // The `jsr` block keys each resolved package as `@scope/name@version`. Drop
  // the ones being moved so their integrity is recorded afresh for whatever
  // version resolves next; anything still referenced is rewritten by the
  // resolver, and anything no longer referenced belongs gone anyway.
  const jsr: unknown = Reflect.get(parsed, "jsr");
  if (jsr !== null && typeof jsr === "object" && !Array.isArray(jsr)) {
    for (const key of Object.keys(jsr)) {
      const at = key.lastIndexOf("@");
      if (at > 0 && wanted.has(key.slice(0, at))) {
        Reflect.deleteProperty(jsr, key);
      }
    }
  }
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

/**
 * Re-resolve by running the Deno that is running this build.
 *
 * Each flag here was chosen against a real project rather than assumed, and
 * the obvious spelling is the one that does not work:
 *
 * - `--entrypoint` is what makes this see anything at all. A bare
 *   `deno install` resolves the *manifest's* dependencies, and a build's
 *   specifiers are written inline in `zuke.ts` — so without an entrypoint the
 *   dropped entries are simply never written back, and the lock is left short.
 *   {@link Deno.mainModule} is the module graph the lock describes, and a
 *   `file://` URL is accepted as-is, which avoids converting one to a path.
 * - `--reload=jsr:` is what makes it reach the *latest*. Deno caches the
 *   registry's version listing, so a plain re-resolution happily picks the
 *   newest version it already knew about — one release behind, silently, which
 *   is the failure this command exists to prevent. Scoped to `jsr:` rather
 *   than a full reload so npm and https dependencies are not re-fetched, and
 *   narrower still (`--reload=jsr:@scope/name`) does not refresh the listing.
 * - `--frozen=false` because a project may set `"frozen": true` in its config,
 *   and a frozen install refuses to write the lock at all.
 */
const denoResolve: ResolveLock = async (lockPath) => {
  const slash = lockPath.lastIndexOf("/");
  const cwd = slash > 0 ? lockPath.slice(0, slash) : ".";
  const command = new Deno.Command(denoExecutable(), {
    args: [
      "install",
      "--entrypoint",
      Deno.mainModule,
      "--reload=jsr:",
      "--frozen=false",
    ],
    cwd,
    stdout: "null",
    stderr: "piped",
  });
  const { code, stderr } = await command.output();
  if (code !== 0) {
    throw new Error(
      `re-resolving the lock failed (deno install exited ${code}): ` +
        new TextDecoder().decode(stderr).trim(),
    );
  }
};

/** The version each `jsr:` package name resolves to, by name. */
function resolvedByName(lockText: string): Map<string, string> {
  const byName = new Map<string, string>();
  for (const entry of lockedJsrSpecifiers(lockText)) {
    byName.set(entry.name, entry.resolved);
  }
  return byName;
}

/** The specifier each `jsr:` package name is written as, by name. */
function specifierByName(lockText: string): Map<string, string> {
  const byName = new Map<string, string>();
  for (const entry of lockedJsrSpecifiers(lockText)) {
    if (!byName.has(entry.name)) byName.set(entry.name, entry.specifier);
  }
  return byName;
}

/**
 * Move the lock's resolved versions up to the registry's latest, for every
 * package {@link findOutdated} reports as behind — or only those named.
 *
 * Touches the lock and nothing else. A specifier that forbids the newer
 * release is reported as holding its package back, never rewritten: widening a
 * range is a decision about the author's source, not a detail of resolution.
 */
export async function updateOutdated(
  options: UpdateOptions = {},
): Promise<UpdateReport> {
  const lockPath = options.lockPath ?? DEFAULT_LOCK_PATH;
  const report = await findOutdated(options);
  const before = await readTextOrNull(lockPath);
  if (before === null) {
    throw new Error(`outdated: no lock file at "${lockPath}".`);
  }
  if (options.only !== undefined) {
    const known = resolvedByName(before);
    const missing = options.only.filter((name) => !known.has(name));
    if (missing.length > 0) {
      throw new Error(
        `outdated: the lock resolves no package named ${missing.join(", ")}.`,
      );
    }
  }
  const wanted = options.only === undefined
    ? report.behind
    : report.behind.filter((p) => options.only?.includes(p.name) === true);
  if (wanted.length === 0) {
    return { updated: [], held: [], unchecked: report.unchecked };
  }

  const names = [...new Set(wanted.map((p) => p.name))];
  const wasResolved = resolvedByName(before);
  await writeTextEnsuringDir(lockPath, dropLockEntries(before, names));
  try {
    await (options.resolve ?? denoResolve)(lockPath);
  } catch (error) {
    // Put the lock back exactly as it was. A half-dropped lock fails every
    // `--frozen` run, which is every launcher and task in a Zuke project, so
    // leaving one behind would turn a failed update into a broken checkout.
    await writeTextEnsuringDir(lockPath, before);
    throw error;
  }
  const after = await readTextOrNull(lockPath) ?? before;
  const nowResolved = resolvedByName(after);
  const nowSpecifier = specifierByName(after);

  // Every dropped package must resolve again. Re-resolution is what puts the
  // entries back, and a lock missing one fails every `--frozen` run — so if
  // any is absent, put the original back rather than leave a hole behind.
  //
  // Checked by package *name*, not by the specifier key: a resolver may
  // normalise the range it writes (a dropped `jsr:@std/encoding@^1.0.0` comes
  // back as `jsr:@std/encoding@1`), and demanding the old key would fail on a
  // lock that is perfectly correct.
  const lost = names.filter((name) => !nowResolved.has(name));
  if (lost.length > 0) {
    await writeTextEnsuringDir(lockPath, before);
    throw new Error(
      `outdated: re-resolving left no entry for ${lost.join(", ")}; the lock ` +
        "was restored unchanged.",
    );
  }

  const updated: UpdatedPackage[] = [];
  const held: HeldPackage[] = [];
  for (const p of wanted) {
    const from = wasResolved.get(p.name) ?? p.resolved;
    const to = nowResolved.get(p.name);
    if (to !== undefined && to !== from) {
      updated.push({ name: p.name, from, to });
      continue;
    }
    held.push({
      name: p.name,
      resolved: to ?? from,
      latest: p.latest,
      specifier: nowSpecifier.get(p.name) ?? p.specifier,
    });
  }
  return { updated, held, unchecked: report.unchecked };
}

/** The report `zuke outdated --update` prints. */
export function formatUpdate(report: UpdateReport): string {
  const { updated, held, unchecked } = report;
  const lines: string[] = [];
  const width = Math.max(
    0,
    ...updated.map((p) => p.name.length),
    ...held.map((p) => p.name.length),
  );
  for (const p of updated) {
    lines.push(`${p.name.padEnd(width)}  ${p.from}  →  ${p.to}`);
  }
  for (const p of held) {
    lines.push(
      `${p.name.padEnd(width)}  ${p.resolved}     held at ${p.latest} by ` +
        `\`${p.specifier}\` — widen the range in your source to move it`,
    );
  }
  if (updated.length > 0) {
    const count = updated.length === 1
      ? "1 package"
      : `${updated.length} packages`;
    lines.push("", `${count} updated. Review the lock diff and commit it.`);
  } else if (held.length === 0) {
    lines.push("Nothing to update.");
  }
  if (unchecked.length > 0) {
    if (lines.length > 0) lines.push("");
    const count = unchecked.length === 1
      ? "1 package"
      : `${unchecked.length} packages`;
    lines.push(`${count} could not be checked:`);
    for (const p of unchecked) {
      lines.push(`  ${p.name} (${p.resolved}) — ${p.reason}`);
    }
  }
  return lines.join("\n");
}

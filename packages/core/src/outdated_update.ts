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
import { resolveDir } from "./path.ts";
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

/** What a {@link ResolveLock} is asked to resolve, beyond the lock itself. */
export interface ResolveRequest {
  /** The release age to pass on to Deno, when one was given. */
  minDepAge: string | undefined;
  /**
   * Further entrypoints whose module graphs share the lock, as absolute paths,
   * re-resolved alongside the build's own.
   */
  entrypoints: readonly string[];
}

/** Re-resolve the lock at `lockPath` after entries were dropped from it. */
export type ResolveLock = (
  lockPath: string,
  request: ResolveRequest,
) => Promise<void>;

/** Options for {@link updateOutdated}. */
export interface UpdateOptions extends OutdatedOptions {
  /**
   * Restrict the update to these package names; every behind package when
   * omitted. A name the lock does not resolve at all is an error rather than a
   * silent no-op, because a typo would otherwise read as "nothing to do".
   */
  only?: readonly string[];
  /**
   * Further entrypoints that share the lock — another build, a workspace
   * member's own `zuke.ts` — resolved against the working directory. A lock
   * serving several module graphs is only fully rewritten when every graph is
   * re-resolved; one left out keeps the dependency lists the update shortened,
   * and the update is refused rather than leave them so.
   */
  entrypoints?: readonly string[];
  /**
   * How to re-resolve after the entries are dropped. Injected so the whole
   * command is testable without a network or a `deno` subprocess.
   */
  resolve?: ResolveLock;
}

/**
 * Whether a lock `dependencies` entry points at package `name`. Deno writes
 * it as `jsr:@scope/name@<range>` when several ranges of one package are
 * locked, and as a bare `jsr:@scope/name` when there is only one, so an
 * exact match on the specifier key misses the second form.
 */
function namesPackage(dependency: unknown, name: string): boolean {
  return typeof dependency === "string" &&
    (dependency === `jsr:${name}` || dependency.startsWith(`jsr:${name}@`));
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
  //
  // A package that stays also lists, in its `dependencies`, the specifiers it
  // resolves through — and Deno refuses to load a lock where one of those has
  // no `specifiers` entry ("Invalid jsr dependency … Lockfile may be
  // corrupt"). So the dropped specifiers come out of those lists too; the
  // resolver writes them back alongside the entries they point at.
  const jsr: unknown = Reflect.get(parsed, "jsr");
  if (jsr !== null && typeof jsr === "object" && !Array.isArray(jsr)) {
    for (const key of Object.keys(jsr)) {
      const at = key.lastIndexOf("@");
      if (at > 0 && wanted.has(key.slice(0, at))) {
        Reflect.deleteProperty(jsr, key);
        continue;
      }
      const record: unknown = Reflect.get(jsr, key);
      if (record === null || typeof record !== "object") continue;
      const deps: unknown = Reflect.get(record, "dependencies");
      if (Array.isArray(deps)) {
        Reflect.set(
          record,
          "dependencies",
          deps.filter((d) => !names.some((name) => namesPackage(d, name))),
        );
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
 *   Any further entrypoints the caller named follow it, since one install
 *   takes several, and a lock serving several graphs needs them all.
 * - `--reload=jsr:` is what makes it reach the *latest*. Deno caches the
 *   registry's version listing, so a plain re-resolution happily picks the
 *   newest version it already knew about — one release behind, silently, which
 *   is the failure this command exists to prevent. Scoped to `jsr:` rather
 *   than a full reload so npm and https dependencies are not re-fetched, and
 *   narrower still (`--reload=jsr:@scope/name`) does not refresh the listing.
 * - `--frozen=false` because a project may set `"frozen": true` in its config,
 *   and a frozen install refuses to write the lock at all.
 * - `--min-dep-age` only when the caller gave one, so a project's own
 *   `minimumDependencyAge` (or Deno's default) applies otherwise. It must
 *   match the age the report was computed with, or Deno refuses the very
 *   version the report offered.
 */
const denoResolve: ResolveLock = async (
  lockPath,
  { minDepAge, entrypoints },
) => {
  const slash = lockPath.lastIndexOf("/");
  const cwd = slash > 0 ? lockPath.slice(0, slash) : ".";
  const command = new Deno.Command(denoExecutable(), {
    args: [
      "install",
      "--entrypoint",
      Deno.mainModule,
      ...entrypoints,
      "--reload=jsr:",
      "--frozen=false",
      ...(minDepAge === undefined ? [] : [`--min-dep-age=${minDepAge}`]),
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

/**
 * Each `jsr` record of the lock that depends on one of `names`, as
 * `record → name` edges. Only records not themselves named: those are dropped
 * and resolved afresh, so their own dependencies are the resolver's to write.
 */
function dependencyEdges(lockText: string, names: readonly string[]): string[] {
  const edges: string[] = [];
  let jsr: unknown;
  try {
    jsr = Reflect.get(JSON.parse(lockText), "jsr");
  } catch {
    return edges;
  }
  if (jsr === null || typeof jsr !== "object") return edges;
  for (const [key, record] of Object.entries(jsr)) {
    if (names.some((name) => key.startsWith(`${name}@`))) continue;
    if (record === null || typeof record !== "object") continue;
    const deps: unknown = Reflect.get(record, "dependencies");
    if (!Array.isArray(deps)) continue;
    for (const name of names) {
      if (
        deps.some((d) => namesPackage(d, name))
      ) {
        edges.push(`${key} → ${name}`);
      }
    }
  }
  return edges;
}

/**
 * An `--entrypoint` as `deno install` should receive it: a URL such as
 * `file:///repo/zuke.ts` untouched, anything else resolved against the working
 * directory. A drive letter is one character, so `C:/x` is not a URL scheme.
 *
 * @throws For an empty value, which would otherwise resolve to the directory.
 */
function entrypointPath(entrypoint: string): string {
  if (entrypoint === "") {
    throw new Error("outdated: --entrypoint needs a file.");
  }
  return /^[a-z][a-z0-9+.-]+:/i.test(entrypoint)
    ? entrypoint
    : resolveDir(entrypoint).path;
}

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
  // Before anything is read or written, so a bad value changes nothing.
  const entrypoints = (options.entrypoints ?? []).map(entrypointPath);
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
    await (options.resolve ?? denoResolve)(lockPath, {
      minDepAge: options.minDepAge,
      entrypoints,
    });
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
  // And every package that depended on a dropped one must depend on it again.
  // A lock can serve more entrypoints than the one re-resolved — a workspace
  // member's own build — and a record only those reach is never rewritten, so
  // it would keep the shortened dependency list and fail that build's
  // `--frozen` run.
  const afterEdges = new Set(dependencyEdges(after, names));
  lost.push(
    ...dependencyEdges(before, names).filter((edge) => !afterEdges.has(edge)),
  );
  if (lost.length > 0) {
    await writeTextEnsuringDir(lockPath, before);
    throw new Error(
      `outdated: re-resolving left no entry for ${lost.join(", ")}; the lock ` +
        "was restored unchanged. A record re-resolution cannot reach belongs to " +
        "another module graph sharing this lock — name its entrypoint with " +
        "--entrypoint — or is stale and can be deleted.",
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

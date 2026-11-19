// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `npmVerify` target (`build.ts`): check that what is on npm under
 * `@zuke-build/<name>` is what this checkout compiles to, and that the workflow
 * that published it is this repository's release workflow. This module
 * orchestrates; the registry, provenance, installed-files and release checks
 * are in `npm_registry.ts`, `npm_provenance.ts`, `npm_installed.ts` and
 * `npm_release.ts`.
 *
 * What is compared is what npm itself unpacks. The verified versions are
 * installed from the registry with `npm install --ignore-scripts`, and the
 * installed package directories are compared with a fresh `buildNpm` of the
 * checkout: the same set of files, the same bytes (`package.json` by value, in
 * case a newer npm re-serialises it). Nothing here parses a tarball, so a
 * tarball crafted to read differently under another tar implementation cannot
 * make the check see something other than what is installed.
 *
 * The packages import each other as `@zuke/<name>`, which npm resolves to an
 * alias directory beside the direct `@zuke-build/<name>` one. That is the code
 * that runs, so each alias is pinned (through `overrides`) to the exact
 * version verified in this run, its lockfile entry must record that version and
 * integrity, and its files are compared with the rebuild like the direct copy.
 * A package whose dependency was not verified here (skipped, missing, or
 * failed) cannot be verified either, as its alias would resolve to code nothing
 * has checked; it is reported with that reason.
 *
 * What ties the installed bytes to the commit, in order:
 * 1. the registry's `dist.integrity` of the version (npm checks the tarball
 *    against it while installing, and the lockfile it writes must record it);
 * 2. the SLSA provenance statement of the version, whose subject digest must be
 *    that same sha512, whose workflow must be this repository's `release.yml` on
 *    `refs/heads/master`, and whose commit must be the one rebuilt from;
 * 3. the Sigstore bundle carrying that statement, verified with sigstore-js
 *    against {@link sigstorePolicy}.
 *
 * `npm audit signatures` ({@link auditSignatures}) then checks the registry's
 * own signatures. Registry, git, npm and Sigstore are behind seams, so every
 * decision here runs against fakes.
 */

import { type AbsolutePath, FileTasks } from "@zuke/core";
import { NpmTasks } from "@zuke/npm";
import { messageOf } from "../packages/core/src/internal.ts";
import {
  compareFiles,
  type LockExpectation,
  lockProblems,
  manifestProblems,
  readManifest,
  readTree,
} from "./npm_installed.ts";
import { dig, isRecord } from "./npm_json.ts";
import { NPM_SCOPE } from "./npm_manifest.ts";
import {
  type BundleVerifier,
  provenanceProblems,
  RELEASE_PROVENANCE,
  sigstorePolicy,
  slsaBundle,
} from "./npm_provenance.ts";
import {
  lookupAll,
  type NpmDist,
  type RegistryReader,
} from "./npm_registry.ts";

/** The registry and the signature check, as verification needs them. */
export interface NpmSource extends RegistryReader {
  /** Verify a Sigstore bundle against a policy; rejects when it does not satisfy it. */
  verifyBundle: BundleVerifier;
}

/** How one package fared. */
export type VerifyResult =
  | { status: "match" }
  /**
   * Not comparable here, and why; not a failure. `unverifiable` marks a package
   * whose source has moved since its release (or that depends on one), which is
   * no reason to doubt the registry.
   */
  | { status: "skipped"; reason: string; unverifiable?: true }
  /** What differs, one line each; a failure. */
  | { status: "mismatch"; problems: string[] };

/** The npm commands verification runs; each throws on failure. */
export interface NpmProbe {
  /** Install exactly `specs` (`@zuke-build/<pkg>@<version>`) into `project` without running scripts. */
  install(project: AbsolutePath, specs: string[]): Promise<void>;
  /** `npm audit signatures` in `project`. */
  auditSignatures(project: AbsolutePath): Promise<void>;
}

const NPM: NpmProbe = {
  async install(project, specs) {
    await NpmTasks.install((s) =>
      s.cwd(project).packages(...specs).ignoreScripts().noAudit().noFund()
    );
  },
  async auditSignatures(project) {
    await NpmTasks.audit((s) => s.cwd(project).signatures());
  },
};

/** What {@link verifyAll} needs to know about the world. */
export interface VerifyDeps {
  /** The registry and the signature check. */
  source: NpmSource;
  /** npm. */
  npm: NpmProbe;
  /** The scratch project the versions are installed into. */
  project: AbsolutePath;
  /** The rebuilt files of a package. */
  rebuilt(pkg: string): Promise<ReadonlyMap<string, Uint8Array>>;
  /** Why a package cannot be compared in this checkout, or `null`. */
  skipReason(pkg: string, version: string): Promise<string | null>;
  /** The commit a version's provenance must name. */
  commitOf(pkg: string, version: string): Promise<string>;
  /**
   * Whether a version missing from npm is reported and skipped rather than
   * failed: for a checkout whose versions were never published.
   */
  allowMissing: boolean;
  /** How many times a missing version is looked for before it is a failure. */
  attempts: number;
  /** Wait between those attempts, for the registry's caches to catch up. */
  wait(): Promise<void>;
}

/** What the provenance of a version says, before anything is installed. */
async function checkProvenance(
  pkg: string,
  version: string,
  dist: NpmDist,
  deps: VerifyDeps,
): Promise<{ dist: NpmDist } | VerifyResult> {
  if (dist.attestations === null) {
    return {
      status: "mismatch",
      problems: ["the version has no SLSA provenance attestation."],
    };
  }
  const bundle = slsaBundle(await deps.source.attestations(dist.attestations));
  const expected = {
    ...RELEASE_PROVENANCE,
    commit: await deps.commitOf(pkg, version),
  };
  const problems = provenanceProblems(bundle, dist.integrity, expected);
  if (problems.length === 0) {
    try {
      await deps.source.verifyBundle(bundle, sigstorePolicy(expected));
    } catch (error) {
      problems.push(messageOf(error));
    }
  }
  return problems.length > 0 ? { status: "mismatch", problems } : { dist };
}

/** The packages `files` (a rebuilt package) imports through `@zuke/<name>` aliases. */
function aliasesOf(files: ReadonlyMap<string, Uint8Array>): string[] {
  const dependencies = dig(
    readManifest(files.get("package.json")),
    "dependencies",
  );
  return isRecord(dependencies)
    ? Object.keys(dependencies).filter((k) => k.startsWith("@zuke/")).map((k) =>
      k.slice("@zuke/".length)
    )
    : [];
}

/**
 * Verify every package in `versions` (package to its local version): the
 * registry and provenance of each, then one install of the ones that passed,
 * with every `@zuke/<name>` alias pinned to the version verified here, whose
 * lockfile must record the integrity the provenance vouches for, and whose
 * direct and alias directories are compared with the rebuild. A version that is
 * not on npm fails, after `attempts` looks, unless `allowMissing`.
 */
export async function verifyAll(
  versions: ReadonlyMap<string, string>,
  deps: VerifyDeps,
): Promise<Map<string, VerifyResult & { version: string }>> {
  const results = new Map<string, VerifyResult & { version: string }>();
  const checked = new Map<string, { version: string; dist: NpmDist }>();
  const wanted = new Map<string, string>();
  for (const [pkg, version] of versions) {
    const skip = await deps.skipReason(pkg, version);
    if (skip === null) wanted.set(pkg, version);
    else {
      results.set(pkg, {
        status: "skipped",
        reason: skip,
        unverifiable: true,
        version,
      });
    }
  }
  for (const [pkg, found] of await lookupAll(wanted, deps.source, deps)) {
    const { version } = found;
    let outcome: { dist: NpmDist } | VerifyResult;
    if ("dist" in found) {
      try {
        outcome = await checkProvenance(pkg, version, found.dist, deps);
      } catch (error) {
        outcome = { status: "mismatch", problems: [messageOf(error)] };
      }
    } else if ("broken" in found) {
      outcome = { status: "mismatch", problems: [found.broken] };
    } else {
      outcome = deps.allowMissing
        ? { status: "skipped", reason: found.missing }
        : { status: "mismatch", problems: [found.missing] };
    }
    if ("dist" in outcome) checked.set(pkg, { version, dist: outcome.dist });
    else results.set(pkg, { ...outcome, version });
  }
  const rebuilt = new Map<string, ReadonlyMap<string, Uint8Array>>();
  for (const pkg of checked.keys()) rebuilt.set(pkg, await deps.rebuilt(pkg));
  // A package whose dependency was not verified would run unchecked code
  // through its alias: drop it, to a fixed point, and say why.
  for (let dropped = true; dropped;) {
    dropped = false;
    for (const [pkg, { version }] of checked) {
      for (const dep of aliasesOf(rebuilt.get(pkg) ?? new Map())) {
        if (checked.has(dep)) continue;
        const why = results.get(dep);
        const reason = `it depends on ${NPM_SCOPE}/${dep}, which ${
          why?.status === "skipped"
            ? `was skipped (${why.reason})`
            : "was not verified"
        }.`;
        results.set(
          pkg,
          why?.status === "skipped"
            ? {
              status: "skipped",
              reason,
              ...(why.unverifiable ? { unverifiable: true as const } : {}),
              version,
            }
            : { status: "mismatch", problems: [reason], version },
        );
        checked.delete(pkg);
        dropped = true;
        break;
      }
    }
  }
  if (checked.size === 0) return results;
  const expected = new Map<string, LockExpectation>();
  for (const [pkg, { version, dist }] of checked) {
    expected.set(pkg, {
      version,
      integrity: dist.integrity,
      bin: dig(readManifest(rebuilt.get(pkg)?.get("package.json")), "bin"),
    });
  }
  await FileTasks.createDirectory(deps.project);
  await FileTasks.writeText(
    deps.project("package.json"),
    JSON.stringify({
      private: true,
      overrides: Object.fromEntries(
        [...checked].map(([pkg, { version }]) => [
          `@zuke/${pkg}`,
          `npm:${NPM_SCOPE}/${pkg}@${version}`,
        ]),
      ),
    }) + "\n",
  );
  await deps.npm.install(
    deps.project,
    [...checked].map(([pkg, { version }]) => `${NPM_SCOPE}/${pkg}@${version}`),
  );
  const lock: unknown = await FileTasks.readJson(
    deps.project("package-lock.json"),
  );
  const locked = lockProblems(lock, expected);
  for (const [pkg, { version, dist }] of checked) {
    const files = rebuilt.get(pkg) ?? new Map<string, Uint8Array>();
    const problems: string[] = [
      ...(locked.perPackage.get(pkg) ?? []),
      ...locked.general,
      ...manifestProblems(dist.manifest, files.get("package.json")),
    ];
    // The direct copy, and the alias copy the other packages import.
    for (const dir of [NPM_SCOPE, "@zuke"]) {
      const at = deps.project("node_modules", dir, pkg);
      if (dir === "@zuke" && !await FileTasks.exists(at)) continue;
      try {
        problems.push(
          ...compareFiles(await readTree(String(at)), files).map((p) =>
            dir === "@zuke" ? `alias @zuke/${pkg}: ${p}` : p
          ),
        );
      } catch (error) {
        problems.push(messageOf(error));
      }
    }
    results.set(
      pkg,
      problems.length === 0
        ? { status: "match", version }
        : { status: "mismatch", problems, version },
    );
  }
  return results;
}

/**
 * The failures to report, empty when the run is good: every mismatch, and, unless
 * `allowNone`, a run in which nothing was compared at all (a green result that
 * checked nothing is not one). A run in which every package was skipped because
 * its source has moved since its release has nothing to compare, and is not
 * that.
 */
export function failures(
  results: ReadonlyMap<string, VerifyResult>,
  allowNone: boolean,
): string[] {
  const lines: string[] = [];
  let compared = 0;
  let unverifiable = 0;
  for (const [pkg, result] of results) {
    if (result.status === "skipped") {
      if (result.unverifiable) unverifiable++;
      continue;
    }
    compared++;
    if (result.status === "mismatch") {
      lines.push(...result.problems.map((p) => `${NPM_SCOPE}/${pkg}: ${p}`));
    }
  }
  if (compared === 0 && unverifiable === 0 && !allowNone) {
    lines.push(
      "nothing was compared: no package version of this checkout is on npm. " +
        "Pass --allow-none if that is expected.",
    );
  }
  return lines;
}

/**
 * Run `npm audit signatures` in `project`, where the verified versions are
 * installed: the registry signatures (and the provenance attestations, where a
 * version has them) of the packages and everything they depend on. Fails if
 * any is missing or invalid. The Sigstore certificate identity is checked by
 * `sigstoreVerifier`, not here: npm checks that some identity signed.
 */
export async function auditSignatures(
  project: AbsolutePath,
  npm: NpmProbe = NPM,
): Promise<void> {
  try {
    await npm.auditSignatures(project);
  } catch (error) {
    throw new Error(`npm audit signatures failed: ${messageOf(error)}`);
  }
}

/** The real npm. */
export const REAL_NPM: NpmProbe = NPM;

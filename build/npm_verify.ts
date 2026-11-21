// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `npmVerify` target (`build.ts`): check that what is on npm under
 * `@zuke-build/<name>` is what the commit its signed provenance names compiles
 * to, and that the workflow that published it is this repository's release
 * workflow. This module orchestrates; the registry, provenance,
 * installed-files and release checks are in `npm_registry.ts`,
 * `npm_provenance.ts`, `npm_installed.ts` and `npm_release.ts`.
 *
 * What is compared is what npm itself unpacks. The verified versions are
 * installed from the registry with `npm install --ignore-scripts`, and the
 * installed package directories are compared with a fresh build of that
 * commit, in its own worktree (`npm_rebuild.ts`): the same set of files, the
 * same bytes (`package.json` by value, in case a newer npm re-serialises it).
 * Nothing here parses a tarball, so a tarball crafted to read differently
 * under another tar implementation cannot make the check see something other
 * than what is installed.
 *
 * The packages import each other as `@zuke/<name>`, which npm resolves to an
 * alias directory beside the direct `@zuke-build/<name>` one. That is the code
 * that runs, so each alias is pinned (through `overrides`) to the exact
 * version verified in this run, its lockfile entry must record that version and
 * integrity, and its files are compared with the rebuild like the direct copy.
 * A package whose dependency was not verified here (missing, or failed) cannot
 * be verified either, as its alias would resolve to code nothing has checked;
 * it is reported with that reason.
 *
 * What is rebuilt, and from what, is not chosen by this checkout: each version
 * is rebuilt from the commit its own signed provenance names (the commit
 * `publishNpm` built it from, which need not be its release tag's), in a git
 * worktree at that commit with that commit's own build code. What ties the
 * installed bytes to that commit, in order:
 * 1. the registry's `dist.integrity` of the version (npm checks the tarball
 *    against it while installing, and the lockfile it writes must record it);
 * 2. the SLSA provenance statement of the version, whose subject digest must be
 *    that same sha512 and whose workflow must be this repository's `release.yml`
 *    on `refs/heads/master`; its commit, a full SHA, is the one rebuilt from;
 * 3. the Sigstore bundle carrying that statement, verified with sigstore-js
 *    against {@link sigstorePolicy} with the certificate's commit pinned to the
 *    statement's, so the commit is the one the certificate attests rather than
 *    a payload field;
 * 4. that commit being on master ({@link masterCheck}).
 *
 * `npm audit signatures` ({@link auditSignatures}) then checks the registry's
 * own signatures. Registry, git, npm and Sigstore are behind seams, so every
 * decision here runs against fakes.
 */

import { type AbsolutePath, FileTasks, HttpError } from "@zuke/core";
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
  provenanceCommit,
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
  /** Not comparable here, and why; not a failure. */
  | { status: "skipped"; reason: string }
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

/** The files of a package, path to bytes. */
type Files = ReadonlyMap<string, Uint8Array>;

/** What {@link verifyAll} needs to know about the world. */
export interface VerifyDeps {
  /** The registry and the signature check. */
  source: NpmSource;
  /** npm. */
  npm: NpmProbe;
  /** The scratch project the versions are installed into. */
  project: AbsolutePath;
  /** Why `commit` (a full SHA) is not on master, or `null` when it is. */
  masterProblem(commit: string): Promise<string | null>;
  /**
   * Rebuild `packages` from `commit` and return each one's files. Called once
   * per distinct commit; rejects when the commit cannot be built.
   */
  rebuildAt(
    commit: string,
    packages: readonly string[],
  ): Promise<ReadonlyMap<string, Files>>;
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

/**
 * The attestations document at `url`. The registry can answer 404 for a
 * version's attestations for a while after it publishes the version itself,
 * so a 404 is looked for again, as a missing version is (`deps.attempts`
 * times, `deps.wait` apart); anything else, or the last 404, rejects.
 */
async function attestationsAt(url: string, deps: VerifyDeps): Promise<unknown> {
  for (let attempt = 1;; attempt++) {
    try {
      return await deps.source.attestations(url);
    } catch (error) {
      const notYet = error instanceof HttpError && error.status === 404;
      if (!notYet || attempt >= deps.attempts) throw error;
      await deps.wait();
    }
  }
}

/** What the provenance of a version says, before anything is installed. */
async function checkProvenance(
  dist: NpmDist,
  deps: VerifyDeps,
): Promise<{ dist: NpmDist; commit: string } | VerifyResult> {
  if (dist.attestations === null) {
    return {
      status: "mismatch",
      problems: ["the version has no SLSA provenance attestation."],
    };
  }
  const bundle = slsaBundle(await attestationsAt(dist.attestations, deps));
  const named = provenanceCommit(bundle);
  if ("problem" in named) {
    return { status: "mismatch", problems: [named.problem] };
  }
  // The statement's commit is only a claim until the certificate, pinned to
  // the same commit, vouches for it.
  const expected = { ...RELEASE_PROVENANCE, commit: named.commit };
  const problems = provenanceProblems(bundle, dist.integrity, expected);
  if (problems.length === 0) {
    try {
      await deps.source.verifyBundle(bundle, sigstorePolicy(expected));
    } catch (error) {
      problems.push(messageOf(error));
    }
  }
  if (problems.length === 0) {
    const off = await deps.masterProblem(named.commit);
    if (off !== null) problems.push(off);
  }
  return problems.length > 0
    ? { status: "mismatch", problems }
    : { dist, commit: named.commit };
}

/** The packages `files` (a rebuilt package) imports through `@zuke/<name>` aliases. */
function aliasesOf(files: Files): string[] {
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
 * registry and provenance of each, a rebuild of the ones that passed (one per
 * distinct provenance commit), then one install of them,
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
  const checked = new Map<
    string,
    { version: string; dist: NpmDist; commit: string }
  >();
  for (const [pkg, found] of await lookupAll(versions, deps.source, deps)) {
    const { version } = found;
    let outcome: { dist: NpmDist; commit: string } | VerifyResult;
    if ("dist" in found) {
      try {
        outcome = await checkProvenance(found.dist, deps);
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
    if ("dist" in outcome) checked.set(pkg, { version, ...outcome });
    else results.set(pkg, { ...outcome, version });
  }
  const byCommit = new Map<string, Array<{ pkg: string; version: string }>>();
  for (const [pkg, { version, commit }] of checked) {
    byCommit.set(commit, [...byCommit.get(commit) ?? [], { pkg, version }]);
  }
  const rebuilt = new Map<string, Files>();
  for (const [commit, group] of byCommit) {
    try {
      const built = await deps.rebuildAt(commit, group.map((g) => g.pkg));
      for (const [pkg, files] of built) rebuilt.set(pkg, files);
    } catch (error) {
      for (const { pkg, version } of group) {
        results.set(pkg, {
          status: "mismatch",
          problems: [`rebuilding ${commit} failed: ${messageOf(error)}`],
          version,
        });
        checked.delete(pkg);
      }
    }
  }
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
            ? { status: "skipped", reason, version }
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
 * checked nothing is not one).
 */
export function failures(
  results: ReadonlyMap<string, VerifyResult>,
  allowNone: boolean,
): string[] {
  const lines: string[] = [];
  let compared = 0;
  for (const [pkg, result] of results) {
    if (result.status === "skipped") continue;
    compared++;
    if (result.status === "mismatch") {
      lines.push(...result.problems.map((p) => `${NPM_SCOPE}/${pkg}: ${p}`));
    }
  }
  if (compared === 0 && !allowNone) {
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

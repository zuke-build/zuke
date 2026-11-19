// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `npmVerify` target (`build.ts`): check that what is on npm under
 * `@zuke-build/<name>` is exactly what this checkout compiles to.
 *
 * For each package the registry's tarball is downloaded, checked against the
 * `dist.integrity` the registry document states, unpacked, and compared with a
 * fresh `buildNpm` of the checkout: the same set of files, the same bytes. The
 * one exception is `package.json`, compared as parsed JSON, because npm is free
 * to re-serialise it on publish (an npm 10 `npm pack` of a local build stores it
 * byte for byte today, but nothing promises that), and its content is what
 * matters. The registry and the network are behind {@link NpmSource}, so every
 * decision here runs against fakes.
 *
 * Provenance is mandatory. Each version must carry an npm SLSA provenance
 * attestation, and its signed statement must name the exact bytes compared, the
 * repository and workflow that built it, and (for a package compared at its own
 * checkout) the commit rebuilt from. The signatures themselves are not checked
 * here: that is `npm audit signatures`' job ({@link auditSignatures}). This
 * module checks what the signed statement says; npm checks that it is signed.
 */

import {
  type AbsolutePath,
  FileTasks,
  gunzip,
  httpDownload,
  HttpError,
  httpJson,
  type TarEntry,
  untar,
} from "@zuke/core";
import { GitTasks } from "@zuke/git";
import { NpmTasks } from "@zuke/npm";
import { messageOf } from "../packages/core/src/internal.ts";
import { NPM_SCOPE } from "./npm_manifest.ts";

/** What the registry says about one version: where its tarball is, and its hash. */
export interface NpmDist {
  /** The tarball's URL. */
  tarball: string;
  /** Its Subresource Integrity string, e.g. `sha512-<base64>`. */
  integrity: string;
  /** Where its attestations are, or `null` when it declares no SLSA provenance. */
  attestations: string | null;
}

/** What a provenance attestation must say. */
export interface ExpectedProvenance {
  /** The repository URL the workflow ran in. */
  repository: string;
  /** The workflow file's path in it. */
  path: string;
  /** The commit it was built from, or `null` when this checkout is not that commit. */
  commit: string | null;
}

/** The workflow whose provenance npm must carry: this repository's release. */
export const RELEASE_PROVENANCE: Omit<ExpectedProvenance, "commit"> = {
  repository: "https://github.com/zuke-build/zuke",
  path: ".github/workflows/release.yml",
};

const SLSA = "https://slsa.dev/provenance/v1";

/** The registry, as verification needs it. */
export interface NpmSource {
  /** The registry document of `@zuke-build/<pkg>`, or `null` when it was never published. */
  document(pkg: string): Promise<unknown>;
  /** The bytes at `url`. */
  tarball(url: string): Promise<Uint8Array>;
  /** The attestations document at `url`. */
  attestations(url: string): Promise<unknown>;
}

/** How one package fared. */
export type VerifyResult =
  | { status: "match" }
  /** Not comparable here, and why; not a failure. */
  | { status: "skipped"; reason: string }
  /** What differs, one line each; a failure. */
  | { status: "mismatch"; problems: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The `dist` of `version` in a registry document, or `null` when it is not there. */
export function distOf(document: unknown, version: string): NpmDist | null {
  if (!isRecord(document) || !isRecord(document.versions)) return null;
  const entry = document.versions[version];
  if (!isRecord(entry) || !isRecord(entry.dist)) return null;
  const { tarball, integrity, attestations } = entry.dist;
  if (typeof tarball !== "string" || typeof integrity !== "string") {
    return null;
  }
  const url = isRecord(attestations) && typeof attestations.url === "string" &&
      isRecord(attestations.provenance) &&
      attestations.provenance.predicateType === SLSA
    ? attestations.url
    : null;
  return { tarball, integrity, attestations: url };
}

async function sha512(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-512", new Uint8Array(bytes)),
  );
}

/**
 * Why `bytes` does not match the SRI string `integrity`, or `null` when it
 * does. Only `sha512-` entries count; a string with none cannot vouch for
 * anything, so that is a problem too.
 */
export async function integrityProblem(
  bytes: Uint8Array,
  integrity: string,
): Promise<string | null> {
  const wanted = integrity.split(/\s+/).filter((h) => h.startsWith("sha512-"));
  if (wanted.length === 0) {
    return `the registry's integrity "${integrity}" has no sha512 hash.`;
  }
  const actual = "sha512-" + btoa(String.fromCharCode(...await sha512(bytes)));
  return wanted.includes(actual)
    ? null
    : `the tarball hashes to ${actual}, not the registry's ${integrity}.`;
}

/** A tarball's files by path with npm's `package/` prefix removed; directories dropped. */
export function tarballFiles(
  entries: readonly TarEntry[],
): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  for (const entry of entries) {
    if (entry.name.endsWith("/")) continue;
    files.set(entry.name.replace(/^package\//, ""), entry.data);
  }
  return files;
}

/** `value` with every object's keys sorted, so equal JSON serialises equally. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, inner]) => [key, canonical(inner)]),
  );
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

function sameManifest(a: Uint8Array, b: Uint8Array): boolean {
  try {
    const decoder = new TextDecoder();
    return JSON.stringify(canonical(JSON.parse(decoder.decode(a)))) ===
      JSON.stringify(canonical(JSON.parse(decoder.decode(b))));
  } catch {
    return false;
  }
}

/**
 * Every difference between the `published` files and the `rebuilt` ones, one
 * line each, sorted; empty when they agree. `package.json` agrees when its
 * parsed JSON does (npm may re-serialise it); every other file must match byte
 * for byte.
 */
export function compareFiles(
  published: ReadonlyMap<string, Uint8Array>,
  rebuilt: ReadonlyMap<string, Uint8Array>,
): string[] {
  const problems: string[] = [];
  for (const [path, data] of published) {
    const local = rebuilt.get(path);
    if (local === undefined) {
      problems.push(`${path}: on npm, not in the rebuild.`);
    } else if (
      path === "package.json"
        ? !sameManifest(data, local)
        : !sameBytes(data, local)
    ) {
      problems.push(`${path}: differs from the rebuild.`);
    }
  }
  for (const path of rebuilt.keys()) {
    if (!published.has(path)) {
      problems.push(`${path}: in the rebuild, not on npm.`);
    }
  }
  return problems.sort();
}

/** Every file under `dir` by its path relative to `dir`, with `/` separators. */
export async function readTree(
  dir: string,
  prefix = "",
): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  for (const entry of await FileTasks.readDirectory(dir)) {
    const rel = prefix + entry.name;
    if (entry.isDirectory) {
      for (
        const [path, data] of await readTree(`${dir}/${entry.name}`, rel + "/")
      ) {
        files.set(path, data);
      }
    } else files.set(rel, await FileTasks.readBytes(`${dir}/${entry.name}`));
  }
  return files;
}

/** The value at `path` in nested records, or `undefined`. */
function dig(value: unknown, ...path: string[]): unknown {
  let at = value;
  for (const key of path) {
    if (!isRecord(at)) return undefined;
    at = at[key];
  }
  return at;
}

/**
 * What is wrong with the provenance in `attestations` (the registry's
 * attestations document), given the sha512 of the tarball we hold, as hex;
 * empty when it is right. Reads the SLSA entry's in-toto statement and checks,
 * without verifying any signature, that it vouches for exactly these bytes
 * and names `expected`'s repository, workflow and (when set) commit.
 */
export function provenanceProblems(
  attestations: unknown,
  tarballSha512: string,
  expected: ExpectedProvenance,
): string[] {
  const list = dig(attestations, "attestations");
  const entry = Array.isArray(list)
    ? list.find((e) => dig(e, "predicateType") === SLSA)
    : undefined;
  const payload = dig(entry, "bundle", "dsseEnvelope", "payload");
  if (typeof payload !== "string") {
    return ["the attestations hold no SLSA provenance statement."];
  }
  let statement: unknown;
  try {
    statement = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(payload), (c) => c.charCodeAt(0)),
    ));
  } catch {
    return ["the SLSA provenance statement is not readable."];
  }
  const problems: string[] = [];
  const subjects = dig(statement, "subject");
  if (
    !Array.isArray(subjects) ||
    !subjects.some((s) => dig(s, "digest", "sha512") === tarballSha512)
  ) {
    problems.push(
      "provenance: no subject has the sha512 of the tarball compared.",
    );
  }
  const workflow = dig(
    statement,
    "predicate",
    "buildDefinition",
    "externalParameters",
    "workflow",
  );
  if (dig(workflow, "repository") !== expected.repository) {
    problems.push(
      `provenance: built in ${
        String(dig(workflow, "repository"))
      }, not ${expected.repository}.`,
    );
  }
  if (dig(workflow, "path") !== expected.path) {
    problems.push(
      `provenance: built by ${
        String(dig(workflow, "path"))
      }, not ${expected.path}.`,
    );
  }
  const deps = dig(
    statement,
    "predicate",
    "buildDefinition",
    "resolvedDependencies",
  );
  const commit = Array.isArray(deps)
    ? dig(deps[0], "digest", "gitCommit")
    : undefined;
  if (expected.commit !== null && commit !== expected.commit) {
    problems.push(
      `provenance: built from ${String(commit)}, not ${expected.commit}.`,
    );
  }
  return problems;
}

/**
 * Compare `@zuke-build/<pkg>`@`version` on the registry with the rebuilt files
 * in `rebuilt`. A package or version that is not on the registry is skipped,
 * not failed, so the check works before the first publish. A version without
 * SLSA provenance fails, as does one whose provenance does not match `expected`.
 */
export async function verifyPackage(
  pkg: string,
  version: string,
  rebuilt: ReadonlyMap<string, Uint8Array>,
  source: NpmSource,
  expected: ExpectedProvenance,
): Promise<VerifyResult> {
  const document = await source.document(pkg);
  if (document === null) {
    return { status: "skipped", reason: "the package is not on npm." };
  }
  const dist = distOf(document, version);
  if (dist === null) {
    return { status: "skipped", reason: `version ${version} is not on npm.` };
  }
  const bytes = await source.tarball(dist.tarball);
  const bad = await integrityProblem(bytes, dist.integrity);
  if (bad !== null) return { status: "mismatch", problems: [bad] };
  const problems = dist.attestations === null
    ? ["the version has no SLSA provenance attestation."]
    : provenanceProblems(
      await source.attestations(dist.attestations),
      Array.from(await sha512(bytes), (b) => b.toString(16).padStart(2, "0"))
        .join(""),
      expected,
    );
  problems.push(...compareFiles(
    tarballFiles(untar(await gunzip(bytes))),
    rebuilt,
  ));
  return problems.length === 0
    ? { status: "match" }
    : { status: "mismatch", problems };
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

/** The real registry: `httpJson` for the document (404 is "never published"), `httpDownload` for tarballs. */
export function registrySource(
  scratch: AbsolutePath,
  doFetch: typeof fetch = fetch,
): NpmSource {
  let count = 0;
  return {
    async document(pkg) {
      try {
        return await httpJson(
          `https://registry.npmjs.org/${NPM_SCOPE}%2f${pkg}`,
          { fetch: doFetch },
        );
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) return null;
        throw error;
      }
    },
    async tarball(url) {
      const file = scratch(`download-${count++}.tgz`);
      await httpDownload(url, file, { fetch: doFetch });
      return await FileTasks.readBytes(file);
    },
    attestations: (url) => httpJson(url, { fetch: doFetch }),
  };
}

/** The two questions {@link changedSinceRelease} asks git. */
export interface GitProbe {
  /** The commit `tag` points to, or `null` when the tag is not in this clone. */
  tagCommit(tag: string): Promise<string | null>;
  /** The commit this checkout is at. */
  head(): Promise<string>;
  /** The paths under `path` that differ between `tag` and `HEAD`. */
  changed(tag: string, path: string): Promise<string[]>;
}

const GIT: GitProbe = {
  async tagCommit(tag) {
    const found = await GitTasks.revParse((s) =>
      s.verify().rev(`refs/tags/${tag}^{commit}`).noThrow().quiet()
    );
    return found.code === 0 ? found.stdout.trim() : null;
  },
  head: () => GitTasks.revision((s) => s.rev("HEAD")),
  changed: (tag, path) =>
    GitTasks.diffNames((s) => s.commits(tag, "HEAD").paths(path)),
};

/**
 * Why `pkg`'s source cannot be compared at `version`, or `null` when it can:
 * its release tag (`<pkg>-v<version>`) exists in this clone and `packages/<pkg>`
 * has changed since. The published bytes are what the *tag* compiles to, so a
 * checkout with unreleased changes to the package would "mismatch" by design.
 * A clone without the tag is compared anyway.
 */
export async function changedSinceRelease(
  pkg: string,
  version: string,
  git: GitProbe = GIT,
): Promise<string | null> {
  const tag = `${pkg}-v${version}`;
  if (await git.tagCommit(tag) === null) return null;
  return (await git.changed(tag, `packages/${pkg}`)).length === 0
    ? null
    : `packages/${pkg} has changed since ${tag}; check out the tag to verify it.`;
}

/** The two npm commands {@link auditSignatures} runs; each throws on failure. */
export interface NpmProbe {
  /** Install `specs` into `project` without running scripts. */
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

/**
 * Install the verified versions from the registry into a scratch project and
 * run `npm audit signatures` there: the registry signatures (and the
 * provenance attestations, where a version has them) of the packages and
 * everything they depend on. Fails if any is missing or invalid. This is where
 * the signatures are verified; {@link provenanceProblems} only reads the
 * statement they sign.
 */
export async function auditSignatures(
  project: AbsolutePath,
  verified: ReadonlyMap<string, string>,
  npm: NpmProbe = NPM,
): Promise<void> {
  await FileTasks.createDirectory(project);
  await FileTasks.writeText(project("package.json"), '{"private":true}\n');
  const specs = [...verified].map(([pkg, version]) =>
    `${NPM_SCOPE}/${pkg}@${version}`
  );
  try {
    await npm.install(project, specs);
    await npm.auditSignatures(project);
  } catch (error) {
    throw new Error(`npm audit signatures failed: ${messageOf(error)}`);
  }
}

/**
 * The commit `pkg`@`version`'s provenance must name: its release tag's commit
 * when this clone has the tag (the version was built there, and
 * {@link changedSinceRelease} has said the package is unchanged since), else
 * the commit checked out, which is the release itself when run on a tag.
 */
export async function builtCommit(
  pkg: string,
  version: string,
  git: GitProbe = GIT,
): Promise<string> {
  return await git.tagCommit(`${pkg}-v${version}`) ?? await git.head();
}

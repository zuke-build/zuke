// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `npmVerify` target (`build.ts`): check that what is on npm under
 * `@zuke-build/<name>` is exactly what this checkout compiles to, and that the
 * workflow that published it is this repository's release workflow.
 *
 * What is compared is what npm itself unpacks. The verified versions are
 * installed from the registry with `npm install --ignore-scripts`, and the
 * installed package directories are compared with a fresh `buildNpm` of the
 * checkout: the same set of files, the same bytes. Nothing here parses a tarball,
 * so a tarball crafted to read differently under another tar implementation
 * cannot make the check see something other than what is installed. The one
 * file compared by value is `package.json` (parsed JSON), in case a newer npm
 * re-serialises it; npm 10 leaves it, and every other file, byte for byte.
 *
 * What ties the installed bytes to the commit, in order:
 * 1. the registry's `dist.integrity` of the version (npm checks the tarball
 *    against it while installing, and the lockfile it writes must record it);
 * 2. the SLSA provenance statement of the version, whose subject digest must be
 *    that same sha512, whose workflow must be this repository's `release.yml` on
 *    `refs/heads/master`, and whose commit must be the one rebuilt from;
 * 3. the Sigstore bundle carrying that statement, verified here with
 *    sigstore-js ({@link sigstorePolicy}): the signature, the transparency log,
 *    and a certificate whose issuer, identity, repository, ref and commit are
 *    ours. The statement's fields are written by the signer, so only the
 *    certificate, which Fulcio issues to the workflow's OIDC token, can vouch
 *    for them.
 *
 * `npm audit signatures` ({@link auditSignatures}) then checks the registry's
 * own signatures. Registry, git, npm and Sigstore are behind seams, so every
 * decision here runs against fakes.
 */

import { type AbsolutePath, FileTasks, HttpError, httpJson } from "@zuke/core";
import { GitTasks } from "@zuke/git";
import { NodeTasks } from "@zuke/node";
import { NpmTasks } from "@zuke/npm";
import { messageOf } from "../packages/core/src/internal.ts";
import { NPM_SCOPE } from "./npm_manifest.ts";

/** What the registry says about one version. */
export interface NpmDist {
  /** Its Subresource Integrity string, e.g. `sha512-<base64>`. */
  integrity: string;
  /** Where its attestations are, or `null` when it declares no SLSA provenance. */
  attestations: string | null;
  /**
   * The registry's whole metadata for the version. npm acts on this, not on the
   * tarball's `package.json`: it resolves dependencies and bins and runs
   * lifecycle scripts from it ({@link manifestProblems}).
   */
  manifest: Record<string, unknown>;
}

/** What a provenance attestation and its certificate must say. */
export interface ExpectedProvenance {
  /** The repository URL the workflow ran in. */
  repository: string;
  /** The workflow file's path in it. */
  path: string;
  /** The git ref it ran on. */
  ref: string;
  /** The commit it was built from. */
  commit: string;
}

/** The workflow whose provenance npm must carry: this repository's release, on master. */
export const RELEASE_PROVENANCE: Omit<ExpectedProvenance, "commit"> = {
  repository: "https://github.com/zuke-build/zuke",
  path: ".github/workflows/release.yml",
  ref: "refs/heads/master",
};

const SLSA = "https://slsa.dev/provenance/v1";
const GITHUB = "https://github.com/";

/** The policy `verify_bundle.mjs` gives sigstore-js's `verify`. */
export interface SigstorePolicy {
  /** The OIDC issuer the certificate must name. */
  certificateIssuer: string;
  /** An anchored regular expression the certificate's identity must match. */
  certificateIdentityURI: string;
  /** Fulcio extension OIDs to the exact value they must carry. */
  certificateOIDs: Record<string, string>;
}

/**
 * The Sigstore policy for `expected`: issued to GitHub Actions' OIDC token, for
 * exactly `<repository>/<path>@<ref>`, with the Fulcio extensions for the
 * repository (`1.3.6.1.4.1.57264.1.5`), ref (`.1.6`) and commit (`.1.3`, the
 * GitHub workflow SHA) equal to ours. All three are present, as raw strings, in
 * the certificate of sigstore@5.0.1's real attestation. sigstore-js treats the
 * identity as a regular expression, so it is escaped and anchored.
 */
export function sigstorePolicy(expected: ExpectedProvenance): SigstorePolicy {
  const identity = `${expected.repository}/${expected.path}@${expected.ref}`;
  return {
    certificateIssuer: "https://token.actions.githubusercontent.com",
    certificateIdentityURI: `^${
      identity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    }$`,
    certificateOIDs: {
      "1.3.6.1.4.1.57264.1.3": expected.commit,
      "1.3.6.1.4.1.57264.1.5": expected.repository.slice(GITHUB.length),
      "1.3.6.1.4.1.57264.1.6": expected.ref,
    },
  };
}

/** The registry and the signature check, as verification needs them. */
export interface NpmSource {
  /** The registry document of `@zuke-build/<pkg>`, or `null` when it was never published. */
  document(pkg: string): Promise<unknown>;
  /** The attestations document at `url`. */
  attestations(url: string): Promise<unknown>;
  /** Verify a Sigstore bundle against `policy`; rejects when it does not satisfy it. */
  verifyBundle(bundle: unknown, policy: SigstorePolicy): Promise<void>;
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

/**
 * The `dist` of `version` in a registry document, or `null` when the version is
 * not there.
 *
 * @throws {Error} when the version is there but its `dist` has no usable
 * `tarball` and `integrity`: that is a broken registry document, not a version
 * that is not published.
 */
export function distOf(document: unknown, version: string): NpmDist | null {
  if (!isRecord(document) || !isRecord(document.versions)) return null;
  const entry = document.versions[version];
  if (entry === undefined) return null;
  const dist = isRecord(entry) ? entry.dist : undefined;
  if (
    !isRecord(entry) || !isRecord(dist) || typeof dist.tarball !== "string" ||
    typeof dist.integrity !== "string" || dist.integrity === ""
  ) {
    throw new Error(
      `the registry lists ${version} without a usable dist.tarball and dist.integrity.`,
    );
  }
  const { attestations } = dist;
  const url = isRecord(attestations) && typeof attestations.url === "string" &&
      isRecord(attestations.provenance) &&
      attestations.provenance.predicateType === SLSA
    ? attestations.url
    : null;
  return { integrity: dist.integrity, attestations: url, manifest: entry };
}

/** The lowercase hex of the sha512 in an SRI string, or `null` when it has none. */
export function sha512Hex(integrity: string): string | null {
  const hash = integrity.split(/\s+/).find((h) => h.startsWith("sha512-"));
  if (hash === undefined) return null;
  try {
    return Array.from(
      atob(hash.slice("sha512-".length)),
      (c) => c.charCodeAt(0).toString(16).padStart(2, "0"),
    ).join("");
  } catch {
    return null;
  }
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

/** The Sigstore bundle of the SLSA provenance entry of an attestations document, if any. */
export function slsaBundle(attestations: unknown): unknown {
  const list = dig(attestations, "attestations");
  const entry = Array.isArray(list)
    ? list.find((e) => dig(e, "predicateType") === SLSA)
    : undefined;
  return dig(entry, "bundle");
}

/**
 * What is wrong with the provenance statement in `bundle`, given the version's
 * registry `integrity`; empty when it is right. It reads the in-toto statement
 * the bundle carries and checks that it vouches for exactly that sha512 and
 * names `expected`'s repository, workflow, ref and commit. It does not verify
 * the signature: {@link NpmSource.verifyBundle} does, and only that makes the
 * statement's claims the certificate's.
 */
export function provenanceProblems(
  bundle: unknown,
  integrity: string,
  expected: ExpectedProvenance,
): string[] {
  const payload = dig(bundle, "dsseEnvelope", "payload");
  if (typeof payload !== "string") {
    return ["the attestations hold no SLSA provenance statement."];
  }
  let statement: unknown;
  try {
    statement = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(payload), (c) => c.charCodeAt(0)),
      ),
    );
  } catch {
    return ["the SLSA provenance statement is not readable."];
  }
  const problems: string[] = [];
  const subjects = dig(statement, "subject");
  const wanted = sha512Hex(integrity);
  if (
    wanted === null || !Array.isArray(subjects) ||
    !subjects.some((s) => dig(s, "digest", "sha512") === wanted)
  ) {
    problems.push(
      "provenance: no subject has the sha512 of the registry's integrity.",
    );
  }
  const workflow = dig(
    statement,
    "predicate",
    "buildDefinition",
    "externalParameters",
    "workflow",
  );
  const keys: Array<"repository" | "path" | "ref"> = [
    "repository",
    "path",
    "ref",
  ];
  for (const key of keys) {
    if (dig(workflow, key) !== expected[key]) {
      problems.push(
        `provenance: workflow ${key} is ${String(dig(workflow, key))}, not ${
          expected[key]
        }.`,
      );
    }
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
  if (commit !== expected.commit) {
    problems.push(
      `provenance: built from ${String(commit)}, not ${expected.commit}.`,
    );
  }
  return problems;
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
 * Every difference between the `installed` files and the `rebuilt` ones, one
 * line each, sorted; empty when they agree. `package.json` agrees when its
 * parsed JSON does; every other file must match byte for byte.
 */
export function compareFiles(
  installed: ReadonlyMap<string, Uint8Array>,
  rebuilt: ReadonlyMap<string, Uint8Array>,
): string[] {
  const problems: string[] = [];
  for (const [path, data] of installed) {
    const local = rebuilt.get(path);
    if (local === undefined) {
      problems.push(`${path}: installed from npm, not in the rebuild.`);
    } else if (
      path === "package.json"
        ? !sameManifest(data, local)
        : !sameBytes(data, local)
    ) {
      problems.push(`${path}: differs from the rebuild.`);
    }
  }
  for (const path of rebuilt.keys()) {
    if (!installed.has(path)) {
      problems.push(`${path}: in the rebuild, not installed from npm.`);
    }
  }
  return problems.sort();
}

/**
 * Every file under `dir` by its path relative to `dir`, with `/` separators.
 *
 * @throws {Error} on anything that is neither a regular file nor a directory
 * (a symlink, say): a package has none, and reading through one would compare
 * something other than what is installed.
 */
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
    } else if (entry.isFile) {
      files.set(rel, await FileTasks.readBytes(`${dir}/${entry.name}`));
    } else throw new Error(`${rel} is not a regular file or a directory.`);
  }
  return files;
}

/** The real registry: `httpJson` for documents (404 is "never published"). */
export function registrySource(
  verifyBundle: NpmSource["verifyBundle"],
  doFetch: typeof fetch = fetch,
): NpmSource {
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
    attestations: (url) => httpJson(url, { fetch: doFetch }),
    verifyBundle,
  };
}

/**
 * Verify a bundle with sigstore-js under node: `verify_bundle.mjs`, run from
 * `tools` (where the toolchain, and so sigstore-js, is installed), with the
 * policy as JSON. The first run fetches Sigstore's trusted root over TUF into
 * `scratch`, so it needs the network.
 */
export function sigstoreVerifier(
  tools: AbsolutePath,
  scratch: AbsolutePath,
): NpmSource["verifyBundle"] {
  let count = 0;
  return async (bundle, policy) => {
    const id = count++;
    const bundleFile = scratch(`bundle-${id}.json`);
    const policyFile = scratch(`policy-${id}.json`);
    await FileTasks.writeText(bundleFile, JSON.stringify(bundle));
    await FileTasks.writeText(policyFile, JSON.stringify(policy));
    try {
      await NodeTasks.run((s) =>
        s.cwd(tools).script(tools("verify_bundle.mjs")).scriptArgs(
          String(bundleFile),
          String(policyFile),
          String(scratch("tuf")),
        )
      );
    } catch (error) {
      throw new Error(
        `the Sigstore bundle did not verify: ${messageOf(error)}`,
      );
    }
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

/** What looking a version up on the registry found: its `dist`, or why there is none. */
type Lookup =
  & { version: string }
  & ({ dist: NpmDist } | { missing: string } | { broken: string });

/**
 * Look every package in `wanted` up, and look again, in passes with one wait
 * between them (the registry's caches can lag a publish), at the ones that are
 * missing, up to `attempts` passes (one when `allowMissing`). A version that
 * is listed but broken is final at once.
 */
async function lookupAll(
  wanted: ReadonlyMap<string, string>,
  deps: VerifyDeps,
): Promise<Map<string, Lookup>> {
  const found = new Map<string, Lookup>();
  const passes = deps.allowMissing ? 1 : deps.attempts;
  for (let pass = 1; pass <= passes; pass++) {
    for (const [pkg, version] of wanted) {
      const prior = found.get(pkg);
      if (prior !== undefined && !("missing" in prior)) continue;
      try {
        const document = await deps.source.document(pkg);
        const dist = distOf(document, version);
        found.set(
          pkg,
          dist !== null ? { version, dist } : {
            version,
            missing: document === null
              ? "the package is not on npm."
              : `version ${version} is not on npm.`,
          },
        );
      } catch (error) {
        found.set(pkg, { version, broken: messageOf(error) });
      }
    }
    const missing = [...found.values()].some((l) => "missing" in l);
    if (!missing || pass === passes) break;
    await deps.wait();
  }
  return found;
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

/**
 * The `package.json` fields npm acts on when it installs: what it resolves
 * (`dependencies` and its kin, `bundleDependencies`/`bundledDependencies`,
 * `os`, `cpu`, `libc`, `engines`), what it runs or links (`scripts`,
 * `hasInstallScript`, `gypfile`, `bin`, `man`, `directories`) and what the
 * installed package exposes to Node (`main`, `exports`, `imports`, `type`).
 * They are read by npm from the registry's version metadata, which a publish
 * can set apart from the tarball, so each is compared with the rebuild.
 *
 * Deliberately not here: what the registry adds or rewrites and npm does not act
 * on (`_id`, `_npmVersion`, `_nodeVersion`, `_npmUser`, `_npmOperationalInternal`,
 * `_hasShrinkwrap`, `dist`, `gitHead`, `maintainers`, `author` as an object),
 * and `files`, which the registry drops from the version metadata (confirmed on
 * sigstore@5.0.1) and which only governs what `npm pack` puts in a tarball,
 * which {@link compareFiles} compares.
 */
export const NPM_ACTED_ON_FIELDS: readonly string[] = [
  "name",
  "version",
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "peerDependenciesMeta",
  "bundleDependencies",
  "bundledDependencies",
  "bin",
  "man",
  "scripts",
  "hasInstallScript",
  "gypfile",
  "os",
  "cpu",
  "libc",
  "engines",
  "directories",
  "main",
  "exports",
  "imports",
  "type",
];

/** `value` as npm sees it: empty objects and arrays, `null` and `false` are absent. */
function present(value: unknown): unknown {
  if (value === null || value === false) return undefined;
  if (Array.isArray(value)) return value.length === 0 ? undefined : value;
  if (isRecord(value)) {
    return Object.keys(value).length === 0 ? undefined : value;
  }
  return value;
}

/**
 * Every {@link NPM_ACTED_ON_FIELDS} field of the registry's `metadata` for a
 * version that differs from the rebuilt `package.json` (`rebuilt`, its bytes),
 * one line each. A field the rebuild lacks must be absent or empty in the
 * metadata, so an added script or dependency is a difference like a changed one.
 */
export function manifestProblems(
  metadata: Record<string, unknown>,
  rebuilt: Uint8Array | undefined,
): string[] {
  let manifest: unknown;
  try {
    manifest = JSON.parse(new TextDecoder().decode(rebuilt));
  } catch {
    return [
      "the rebuild has no readable package.json to compare the registry's metadata with.",
    ];
  }
  return NPM_ACTED_ON_FIELDS.filter((field) =>
    JSON.stringify(canonical(present(metadata[field]))) !==
      JSON.stringify(canonical(present(dig(manifest, field))))
  ).map((field) =>
    `the registry's metadata for ${field} differs from the rebuilt package.json.`
  );
}

/** What the scratch install's lockfile should hold for one direct package. */
export interface LockExpectation {
  /** The version installed. */
  version: string;
  /** Its integrity. */
  integrity: string;
  /** The rebuilt `package.json`'s `bin`, which the lockfile's entry must equal. */
  bin: unknown;
}

/**
 * What is wrong with the scratch install's `package-lock.json`: per direct
 * package, a version, integrity or `bin` other than expected; and, in general,
 * any entry that is not the root, a direct `@zuke-build` package or an `@zuke/*`
 * alias of one of `known`, and any entry with `hasInstallScript`. `perPackage`
 * keys are package names; `general` holds the rest.
 */
export function lockProblems(
  lock: unknown,
  expected: ReadonlyMap<string, LockExpectation>,
  known: ReadonlySet<string>,
): { perPackage: Map<string, string[]>; general: string[] } {
  const perPackage = new Map<string, string[]>();
  const general: string[] = [];
  const packages = dig(lock, "packages");
  if (!isRecord(packages)) {
    return { perPackage, general: ["the lockfile lists no packages."] };
  }
  for (const [key, entry] of Object.entries(packages)) {
    if (key === "") continue;
    const match = /^node_modules\/(@zuke-build|@zuke)\/([a-z0-9-]+)$/.exec(key);
    const short = match?.[2];
    if (short === undefined || !known.has(short)) {
      general.push(`the install holds ${key}, which is not one of ours.`);
      continue;
    }
    if (present(dig(entry, "hasInstallScript")) !== undefined) {
      general.push(`${key} has an install script.`);
    }
    const direct = match?.[1] === NPM_SCOPE ? expected.get(short) : undefined;
    const problems: string[] = [];
    if (direct !== undefined) {
      if (
        dig(entry, "version") !== direct.version ||
        dig(entry, "integrity") !== direct.integrity
      ) {
        problems.push(
          `npm installed ${key} with a version or integrity other than the registry's ${direct.version} ${direct.integrity}.`,
        );
      }
    }
    // None of our packages has a bin: an alias or a direct package must not gain one.
    if (
      JSON.stringify(canonical(present(dig(entry, "bin")))) !==
        JSON.stringify(canonical(present(direct?.bin)))
    ) {
      problems.push(`${key} has a bin other than the rebuild's.`);
    }
    if (problems.length > 0) {
      perPackage.set(short, [...(perPackage.get(short) ?? []), ...problems]);
    }
  }
  for (const short of expected.keys()) {
    if (!(`node_modules/${NPM_SCOPE}/${short}` in packages)) {
      perPackage.set(short, [
        ...(perPackage.get(short) ?? []),
        `npm's lockfile has no entry for ${NPM_SCOPE}/${short}.`,
      ]);
    }
  }
  return { perPackage, general };
}

/**
 * Verify every package in `versions` (package to its local version): the
 * registry and provenance of each ({@link checkRegistry}), then one install of
 * the ones that passed, whose lockfile must record the integrity the
 * provenance vouches for, and whose installed files are compared with the
 * rebuild. A version that is not on npm fails, after `attempts` looks, unless
 * `allowMissing`.
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
    else results.set(pkg, { status: "skipped", reason: skip, version });
  }
  for (const [pkg, found] of await lookupAll(wanted, deps)) {
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
  if (checked.size === 0) return results;
  await FileTasks.createDirectory(deps.project);
  await FileTasks.writeText(deps.project("package.json"), '{"private":true}\n');
  await deps.npm.install(
    deps.project,
    [...checked].map(([pkg, { version }]) => `${NPM_SCOPE}/${pkg}@${version}`),
  );
  const lock: unknown = await FileTasks.readJson(
    deps.project("package-lock.json"),
  );
  const rebuilt = new Map<string, ReadonlyMap<string, Uint8Array>>();
  const expected = new Map<string, LockExpectation>();
  for (const [pkg, { version, dist }] of checked) {
    const files = await deps.rebuilt(pkg);
    rebuilt.set(pkg, files);
    let bin: unknown;
    try {
      bin = dig(
        JSON.parse(new TextDecoder().decode(files.get("package.json"))),
        "bin",
      );
    } catch {
      bin = undefined;
    }
    expected.set(pkg, { version, integrity: dist.integrity, bin });
  }
  const locked = lockProblems(lock, expected, new Set(versions.keys()));
  for (const [pkg, { version, dist }] of checked) {
    const files = rebuilt.get(pkg) ?? new Map<string, Uint8Array>();
    const problems: string[] = [
      ...(locked.perPackage.get(pkg) ?? []),
      ...locked.general,
      ...manifestProblems(dist.manifest, files.get("package.json")),
    ];
    try {
      problems.push(...compareFiles(
        await readTree(String(deps.project("node_modules", NPM_SCOPE, pkg))),
        files,
      ));
    } catch (error) {
      problems.push(messageOf(error));
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
 * {@link sigstoreVerifier}, not here: npm checks that some identity signed.
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

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Comparing what npm installed with the rebuild: the files, the registry's
 * metadata for the fields npm acts on, and the scratch install's lockfile.
 */

import { FileTasks } from "@zuke/core";
import { canonical, dig, isRecord, present } from "./npm_json.ts";
import { NPM_SCOPE } from "./npm_manifest.ts";

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

function sameManifest(a: Uint8Array, b: Uint8Array): boolean {
  const left = readManifest(a);
  return left !== undefined &&
    JSON.stringify(canonical(left)) ===
      JSON.stringify(canonical(readManifest(b)));
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

/**
 * The `package.json` fields npm acts on when it installs: what it resolves
 * (`dependencies` and its kin, `bundleDependencies`/`bundledDependencies`,
 * `os`, `cpu`, `libc`, `engines`), what it runs or links (`scripts`,
 * `hasInstallScript`, `gypfile`, `bin`, `man`, `directories`), how it resolves
 * them (`_hasShrinkwrap`, which makes npm skip the package's dependencies, and
 * `acceptDependencies`, which widens what satisfies them) and what the
 * installed package exposes to Node (`main`, `exports`, `imports`, `type`).
 * They are read by npm from the registry's version metadata, which a publish
 * can set apart from the tarball, so each is compared with the rebuild.
 *
 * Deliberately not here: what the registry adds or rewrites and npm does not act
 * on (`_id`, `_npmVersion`, `_nodeVersion`, `_npmUser`, `_npmOperationalInternal`,
 * `dist`, `gitHead`, `maintainers`, `author` as an object),
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
  "_hasShrinkwrap",
  "acceptDependencies",
];

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
  const manifest = readManifest(rebuilt);
  if (manifest === undefined) {
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

/** What the scratch install's lockfile should hold for one verified package. */
export interface LockExpectation {
  /** The version installed. */
  version: string;
  /** Its integrity. */
  integrity: string;
  /** The rebuilt `package.json`'s `bin`, which the lockfile's entry must equal. */
  bin: unknown;
}

/**
 * What is wrong with the scratch install's `package-lock.json`, given what was
 * verified in this run (`expected`, by package name). Allowed are the root, the
 * direct `@zuke-build/<name>` entries and the `@zuke/<name>` aliases the
 * packages' own dependencies resolve through; anything else is not ours. Each
 * of those must be a package in `expected`, at its version and integrity, with
 * no install script and the rebuild's `bin`; an alias must also name
 * `@zuke-build/<name>`. Problems about a package are under its name in
 * `perPackage`; the rest are in `general`.
 */
export function lockProblems(
  lock: unknown,
  expected: ReadonlyMap<string, LockExpectation>,
): { perPackage: Map<string, string[]>; general: string[] } {
  const perPackage = new Map<string, string[]>();
  const general: string[] = [];
  const add = (pkg: string, problem: string) =>
    perPackage.set(pkg, [...(perPackage.get(pkg) ?? []), problem]);
  const packages = dig(lock, "packages");
  if (!isRecord(packages)) {
    return { perPackage, general: ["the lockfile lists no packages."] };
  }
  for (const [key, entry] of Object.entries(packages)) {
    if (key === "") continue;
    const match = /^node_modules\/(@zuke-build|@zuke)\/([a-z0-9-]+)$/.exec(key);
    const scope = match?.[1];
    const short = match?.[2];
    if (scope === undefined || short === undefined) {
      general.push(`the install holds ${key}, which is not one of ours.`);
      continue;
    }
    const want = expected.get(short);
    if (want === undefined) {
      general.push(`${key} is a package that was not verified in this run.`);
      continue;
    }
    if (present(dig(entry, "hasInstallScript")) !== undefined) {
      general.push(`${key} has an install script.`);
    }
    if (scope === "@zuke" && dig(entry, "name") !== `${NPM_SCOPE}/${short}`) {
      add(short, `${key} is not an alias of ${NPM_SCOPE}/${short}.`);
    }
    if (
      dig(entry, "version") !== want.version ||
      dig(entry, "integrity") !== want.integrity
    ) {
      add(
        short,
        `npm installed ${key} with a version or integrity other than the verified ${want.version} ${want.integrity}.`,
      );
    }
    // None of our packages has a bin: a package or its alias must not gain one.
    if (
      JSON.stringify(canonical(present(dig(entry, "bin")))) !==
        JSON.stringify(canonical(present(want.bin)))
    ) {
      add(short, `${key} has a bin other than the rebuild's.`);
    }
  }
  for (const short of expected.keys()) {
    if (!(`node_modules/${NPM_SCOPE}/${short}` in packages)) {
      add(short, `npm's lockfile has no entry for ${NPM_SCOPE}/${short}.`);
    }
  }
  return { perPackage, general };
}

/** A rebuilt `package.json` parsed, or `undefined` when it is missing or unreadable. */
export function readManifest(bytes: Uint8Array | undefined): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What `npmVerify` reads from the npm registry: a package's document, the
 * `dist` of one version, and the attestations a version links to. Parsing only;
 * what the values must be is decided elsewhere.
 */

import { HttpError, httpJson } from "@zuke/core";
import { messageOf } from "../packages/core/src/internal.ts";
import { isRecord } from "./npm_json.ts";
import { NPM_SCOPE } from "./npm_manifest.ts";

/** The predicate type of npm's SLSA provenance attestation. */
export const SLSA = "https://slsa.dev/provenance/v1";

/** What the registry says about one version. */
export interface NpmDist {
  /** Its Subresource Integrity string, e.g. `sha512-<base64>`. */
  integrity: string;
  /** Where its attestations are, or `null` when it declares no SLSA provenance. */
  attestations: string | null;
  /**
   * The registry's whole metadata for the version. npm acts on this, not on the
   * tarball's `package.json`: it resolves dependencies and bins and runs
   * lifecycle scripts from it (see `manifestProblems`).
   */
  manifest: Record<string, unknown>;
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

/** What `npmVerify` reads of the registry; the rest of its source is the signature check. */
export interface RegistryReader {
  /** The registry document of `@zuke-build/<pkg>`, or `null` when it was never published. */
  document(pkg: string): Promise<unknown>;
  /** The attestations document at `url`. */
  attestations(url: string): Promise<unknown>;
}

/** The real registry: `httpJson` for documents (404 is "never published"). */
export function registrySource(doFetch: typeof fetch = fetch): RegistryReader {
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
  };
}

/** What looking a version up on the registry found: its `dist`, or why there is none. */
export type Lookup =
  & { version: string }
  & ({ dist: NpmDist } | { missing: string } | { broken: string });

/** How {@link lookupAll} retries what is missing. */
export interface LookupRetry {
  /** Look once, and report what is missing, rather than retrying. */
  allowMissing: boolean;
  /** How many passes to make over what is missing. */
  attempts: number;
  /** Wait between passes, for the registry's caches to catch up. */
  wait(): Promise<void>;
}

/**
 * Look every package in `wanted` up, and look again, in passes with one wait
 * between them (the registry's caches can lag a publish), at the ones that are
 * missing, up to `attempts` passes (one when `allowMissing`). A version that
 * is listed but broken is final at once.
 */
export async function lookupAll(
  wanted: ReadonlyMap<string, string>,
  registry: RegistryReader,
  retry: LookupRetry,
): Promise<Map<string, Lookup>> {
  const found = new Map<string, Lookup>();
  const passes = retry.allowMissing ? 1 : retry.attempts;
  for (let pass = 1; pass <= passes; pass++) {
    for (const [pkg, version] of wanted) {
      const prior = found.get(pkg);
      if (prior !== undefined && !("missing" in prior)) continue;
      try {
        const document = await registry.document(pkg);
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
    await retry.wait();
  }
  return found;
}

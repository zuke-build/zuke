// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Shared fixtures for the `npmVerify` tests: an SRI string and its hex, a
 * provenance statement and the bundle that carries it.
 *
 * @module
 */

import type { ExpectedProvenance } from "../build/npm_provenance.ts";

export const text = (s: string) => new TextEncoder().encode(s);
export const SLSA = "https://slsa.dev/provenance/v1";

export const OURS: ExpectedProvenance = {
  repository: "https://github.com/zuke-build/zuke",
  path: ".github/workflows/release.yml",
  ref: "refs/heads/master",
  commit: "1234abcd1234abcd1234abcd1234abcd1234abcd",
};

/** An SRI string for 64 bytes of `seed`, and the hex a statement carries for it. */
export function integrityOf(seed: number): { integrity: string; hex: string } {
  const bytes = new Uint8Array(64).fill(seed);
  return {
    integrity: "sha512-" + btoa(String.fromCharCode(...bytes)),
    hex: Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""),
  };
}

/** The bundle of an attestations document whose SLSA statement says `statement`. */
export function bundleOf(statement: unknown): unknown {
  return { dsseEnvelope: { payload: btoa(JSON.stringify(statement)) } };
}

/** The statement npm records for a build of `hex` from `OURS`, changed by `over`. */
export function statement(
  hex: string,
  over: Partial<ExpectedProvenance> = {},
): unknown {
  const at = { ...OURS, ...over };
  return {
    subject: [{ name: "pkg:npm/x@1.0.0", digest: { sha512: hex } }],
    predicate: {
      buildDefinition: {
        externalParameters: {
          workflow: { repository: at.repository, path: at.path, ref: at.ref },
        },
        resolvedDependencies: [{ digest: { gitCommit: at.commit } }],
      },
    },
  };
}

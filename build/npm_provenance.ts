// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The provenance of an npm version: what its SLSA statement must say, the
 * Sigstore policy its certificate must satisfy, and the sigstore-js run that
 * verifies the bundle. The statement's fields are written by the signer, so
 * only the certificate, which Fulcio issues to the workflow's OIDC token, can
 * vouch for them; both are checked.
 */

import { type AbsolutePath, FileTasks } from "@zuke/core";
import { NodeTasks } from "@zuke/node";
import { messageOf } from "../packages/core/src/internal.ts";
import { dig } from "./npm_json.ts";
import { SLSA } from "./npm_registry.ts";

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

/** The Sigstore bundle of the SLSA provenance entry of an attestations document, if any. */
export function slsaBundle(attestations: unknown): unknown {
  const list = dig(attestations, "attestations");
  const entry = Array.isArray(list)
    ? list.find((e) => dig(e, "predicateType") === SLSA)
    : undefined;
  return dig(entry, "bundle");
}

/** The in-toto statement `bundle` carries, or why it cannot be read. */
function readStatement(bundle: unknown): { statement: unknown } | {
  problem: string;
} {
  const payload = dig(bundle, "dsseEnvelope", "payload");
  if (typeof payload !== "string") {
    return { problem: "the attestations hold no SLSA provenance statement." };
  }
  try {
    return {
      statement: JSON.parse(
        new TextDecoder().decode(
          Uint8Array.from(atob(payload), (c) => c.charCodeAt(0)),
        ),
      ),
    };
  } catch {
    return { problem: "the SLSA provenance statement is not readable." };
  }
}

/** The commit a statement says it was built from, whatever that holds. */
function gitCommitOf(statement: unknown): unknown {
  const deps = dig(
    statement,
    "predicate",
    "buildDefinition",
    "resolvedDependencies",
  );
  return Array.isArray(deps) ? dig(deps[0], "digest", "gitCommit") : undefined;
}

/**
 * The commit the provenance statement in `bundle` says the package was built
 * from, as a full 40-hex SHA, or why there is none. It is the statement's claim
 * only: pass it to {@link sigstorePolicy} so the certificate has to say the
 * same before anything is rebuilt from it.
 */
export function provenanceCommit(
  bundle: unknown,
): { commit: string } | { problem: string } {
  const read = readStatement(bundle);
  if ("problem" in read) return { problem: read.problem };
  const commit = gitCommitOf(read.statement);
  return typeof commit === "string" && /^[0-9a-f]{40}$/.test(commit)
    ? { commit }
    : {
      problem: `provenance: the commit ${
        String(commit)
      } is not a full 40-hex git SHA.`,
    };
}

/**
 * What is wrong with the provenance statement in `bundle`, given the version's
 * registry `integrity`; empty when it is right. It reads the in-toto statement
 * the bundle carries and checks that it vouches for exactly that sha512 and
 * names `expected`'s repository, workflow and ref. The commit is not compared
 * here: it is read from this same statement by {@link provenanceCommit}, and
 * what binds it is the certificate, whose commit extension the
 * {@link sigstorePolicy} pins to it. It does not verify the signature: a
 * {@link BundleVerifier} does, and only that makes the statement's claims the
 * certificate's.
 */
export function provenanceProblems(
  bundle: unknown,
  integrity: string,
  expected: Omit<ExpectedProvenance, "commit">,
): string[] {
  const read = readStatement(bundle);
  if ("problem" in read) return [read.problem];
  const { statement } = read;
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
  return problems;
}

/** Verifies a Sigstore bundle against a policy; rejects when it does not satisfy it. */
export type BundleVerifier = (
  bundle: unknown,
  policy: SigstorePolicy,
) => Promise<void>;

/**
 * Verify a bundle with sigstore-js under node: `verify_bundle.mjs`, run from
 * `tools` (where the toolchain, and so sigstore-js, is installed), with the
 * policy as JSON. The first run fetches Sigstore's trusted root over TUF into
 * `scratch`, so it needs the network.
 */
export function sigstoreVerifier(
  tools: AbsolutePath,
  scratch: AbsolutePath,
): BundleVerifier {
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

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `npmVerify`'s provenance checks: the statement a version's attestation
 * signs, against a real npm attestation, and the Sigstore policy.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../packages/core/tests/_assert.ts";
import {
  type ExpectedProvenance,
  provenanceCommit,
  provenanceProblems,
  sha512Hex,
  sigstorePolicy,
  slsaBundle,
} from "../build/npm_provenance.ts";
import { bundleOf, integrityOf, OURS, statement } from "./_npm_verify.ts";

const FIXTURE: unknown = JSON.parse(
  Deno.readTextFileSync(
    new URL("./fixtures/npm_attestation_sigstore-5.0.1.json", import.meta.url),
  ),
);
// sigstore@5.0.1's real npm attestation (fetched from the registry), so the
// field paths read are the ones npm really writes.
const SIGSTORE: ExpectedProvenance = {
  repository: "https://github.com/sigstore/sigstore-js",
  path: ".github/workflows/release.yml",
  ref: "refs/heads/main",
  commit: "4576519f81b93bf96bd7457fc7252b8cfa11e67f",
};
const SIGSTORE_INTEGRITY =
  "sha512-LNdyRQ9ex5Nola93z1Xfm9WewHiy1v3XDH8SVizrWzPcGTuHpi3C5U6EQuCNH7Oo7G3j+16cnNf9Vd3VZxpafA==";

Deno.test("sha512Hex reads an SRI string's sha512", () => {
  assertEquals(sha512Hex(integrityOf(1).integrity), integrityOf(1).hex);
  assertEquals(sha512Hex("sha1-abc sha512-" + btoa("\x01")), "01");
  assertEquals(sha512Hex("sha1-abc"), null);
  assertEquals(sha512Hex("sha512-***"), null);
});

Deno.test("a real npm attestation passes for its integrity, repository, workflow and ref", () => {
  const bundle = slsaBundle(FIXTURE);
  assertEquals(provenanceProblems(bundle, SIGSTORE_INTEGRITY, SIGSTORE), []);
});

Deno.test("a real npm attestation fails for another integrity, repository, workflow or ref", () => {
  const bundle = slsaBundle(FIXTURE);
  const wrong = (
    over: Partial<Omit<ExpectedProvenance, "commit">>,
    integrity = SIGSTORE_INTEGRITY,
  ) => provenanceProblems(bundle, integrity, { ...SIGSTORE, ...over });
  assertStringIncludes(
    wrong({}, integrityOf(9).integrity)[0],
    "no subject has the sha512",
  );
  assertStringIncludes(wrong({}, "sha1-x")[0], "no subject has the sha512");
  assertStringIncludes(
    wrong({ repository: OURS.repository })[0],
    "workflow repository is https://github.com/sigstore/sigstore-js",
  );
  assertStringIncludes(wrong({ path: "x.yml" })[0], "workflow path is");
  assertStringIncludes(
    wrong({ ref: OURS.ref })[0],
    "workflow ref is refs/heads/main",
  );
});

Deno.test("a bundle without a readable SLSA statement is refused", () => {
  assertEquals(
    slsaBundle({ attestations: [{ predicateType: "other" }] }),
    undefined,
  );
  for (const bad of [undefined, {}, { dsseEnvelope: { payload: 1 } }]) {
    assertStringIncludes(
      provenanceProblems(bad, "sha512-AA==", OURS)[0],
      "no SLSA",
    );
  }
  const garbage = { dsseEnvelope: { payload: btoa("{") } };
  assertStringIncludes(
    provenanceProblems(garbage, "sha512-AA==", OURS)[0],
    "not readable",
  );
  assertStringIncludes(
    provenanceProblems(bundleOf({}), "sha512-AA==", OURS).join("\n"),
    "no subject has the sha512",
  );
});

Deno.test("the Sigstore policy pins issuer, an anchored identity, and the repository, ref and commit OIDs", () => {
  const policy = sigstorePolicy(OURS);
  assertEquals(
    policy.certificateIssuer,
    "https://token.actions.githubusercontent.com",
  );
  assertEquals(policy.certificateOIDs, {
    "1.3.6.1.4.1.57264.1.3": OURS.commit,
    "1.3.6.1.4.1.57264.1.5": "zuke-build/zuke",
    "1.3.6.1.4.1.57264.1.6": "refs/heads/master",
  });
  // sigstore-js tests the identity as a regular expression.
  const identity = new RegExp(policy.certificateIdentityURI);
  const ours =
    "https://github.com/zuke-build/zuke/.github/workflows/release.yml@refs/heads/master";
  assertEquals(identity.test(ours), true);
  for (
    const other of [
      ours + "x",
      "x" + ours,
      ours.replace("zuke-build/zuke", "zuke-build/zuke2"),
      ours.replace("release.yml", "release-yml"),
      ours.replace("master", "main"),
      ours.replace("https://github.com", "https://github-com"),
    ]
  ) assertEquals(identity.test(other), false, other);
});

const problemOf = (r: ReturnType<typeof provenanceCommit>) =>
  "problem" in r ? r.problem : "";

Deno.test("provenanceCommit reads the statement's commit and refuses a malformed one", () => {
  assertEquals(provenanceCommit(slsaBundle(FIXTURE)), {
    commit: SIGSTORE.commit,
  });
  assertEquals(provenanceCommit(bundleOf(statement("", OURS))), {
    commit: OURS.commit,
  });
  for (const bad of ["abc", OURS.commit.toUpperCase(), OURS.commit + "0", ""]) {
    const bundle = bundleOf(statement("", { commit: bad }));
    assertStringIncludes(
      problemOf(provenanceCommit(bundle)),
      "is not a full 40-hex git SHA",
    );
  }
  assertStringIncludes(
    problemOf(provenanceCommit(bundleOf({}))),
    "undefined is not a full 40-hex",
  );
  assertStringIncludes(problemOf(provenanceCommit(undefined)), "no SLSA");
  assertStringIncludes(
    problemOf(provenanceCommit({ dsseEnvelope: { payload: btoa("{") } })),
    "not readable",
  );
});

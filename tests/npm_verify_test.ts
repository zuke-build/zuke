// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `npmVerify`'s decisions, against a fake registry: a match, a changed, extra
 * and missing file, a bad integrity, a version or package that is not on npm,
 * and the rules for what counts as a failure. Also the properties the npm build
 * needs for its output not to depend on the machine.
 *
 * @module
 */

import { absolutePath, gzip, HttpError, tar } from "../packages/core/mod.ts";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../packages/core/tests/_assert.ts";
import {
  auditSignatures,
  builtCommit,
  changedSinceRelease,
  compareFiles,
  distOf,
  type ExpectedProvenance,
  failures,
  type GitProbe,
  integrityProblem,
  type NpmProbe,
  type NpmSource,
  provenanceProblems,
  readTree,
  registrySource,
  tarballFiles,
  verifyPackage,
  type VerifyResult,
} from "../build/npm_verify.ts";
import { npmTsconfig } from "../build/npm_build.ts";
import { npmManifest } from "../build/npm_manifest.ts";

const text = (s: string) => new TextEncoder().encode(s);

async function sri(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-512", new Uint8Array(bytes));
  return "sha512-" + btoa(String.fromCharCode(...new Uint8Array(digest)));
}

const OURS: ExpectedProvenance = {
  repository: "https://github.com/zuke-build/zuke",
  path: ".github/workflows/release.yml",
  commit: "1234abc",
};

/** A registry attestations document whose SLSA statement says `statement`. */
function attestations(statement: unknown): unknown {
  const payload = btoa(JSON.stringify(statement));
  return {
    attestations: [
      { predicateType: "other", bundle: {} },
      {
        predicateType: "https://slsa.dev/provenance/v1",
        bundle: { dsseEnvelope: { payload } },
      },
    ],
  };
}

/** The statement npm records for a build of `digest` from `OURS`, changed by `over`. */
function statement(
  digest: string,
  over: { repository?: string; path?: string; commit?: string } = {},
) {
  return {
    subject: [{ name: "pkg:npm/x@1.0.0", digest: { sha512: digest } }],
    predicate: {
      buildDefinition: {
        externalParameters: {
          workflow: {
            repository: over.repository ?? OURS.repository,
            path: over.path ?? OURS.path,
          },
        },
        resolvedDependencies: [{
          digest: { gitCommit: over.commit ?? OURS.commit },
        }],
      },
    },
  };
}

const REBUILT = new Map([
  ["package.json", text('{"name":"@zuke-build/x","version":"1.0.0"}\n')],
  ["mod.js", text("export {};\n")],
  ["README.md", text("# x\n")],
]);

/** A registry holding `@zuke-build/x`@1.0.0 as a tarball of `files`, hashed as `integrity` or truly. */
async function source(
  files: Record<string, string>,
  integrity?: string,
  over?: { repository?: string; path?: string; commit?: string },
  withAttestation = true,
): Promise<NpmSource> {
  const bytes = await gzip(tar(
    Object.entries(files).map(([name, data]) => ({
      name: `package/${name}`,
      data: text(data),
    })),
  ));
  const hash = integrity ?? await sri(bytes);
  const hex = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-512", new Uint8Array(bytes)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  const dist = {
    tarball: "t://x",
    integrity: hash,
    ...(withAttestation
      ? {
        attestations: {
          url: "t://att",
          provenance: { predicateType: "https://slsa.dev/provenance/v1" },
        },
      }
      : {}),
  };
  return {
    document: (pkg) =>
      Promise.resolve(pkg === "x" ? { versions: { "1.0.0": { dist } } } : null),
    tarball: () => Promise.resolve(bytes),
    attestations: () => Promise.resolve(attestations(statement(hex, over))),
  };
}

const SAME = {
  "package.json": '{"version":"1.0.0","name":"@zuke-build/x"}',
  "mod.js": "export {};\n",
  "README.md": "# x\n",
};

Deno.test("a published package that is the rebuild matches, package.json by value", async () => {
  // Key order differs from the rebuilt manifest: npm may re-serialise it.
  assertEquals(
    await verifyPackage("x", "1.0.0", REBUILT, await source(SAME), OURS),
    {
      status: "match",
    },
  );
});

Deno.test("a changed, an extra and a missing file are each reported", async () => {
  const result = await verifyPackage(
    "x",
    "1.0.0",
    REBUILT,
    await source({
      "package.json": SAME["package.json"],
      "mod.js": "export const hacked = 1;\n",
      "extra.js": "",
    }),
    OURS,
  );
  assertEquals(result, {
    status: "mismatch",
    problems: [
      "README.md: in the rebuild, not on npm.",
      "extra.js: on npm, not in the rebuild.",
      "mod.js: differs from the rebuild.",
    ],
  });
});

Deno.test("a changed package.json is a mismatch, a malformed one too", async () => {
  for (const manifest of ['{"name":"@zuke-build/x","version":"9.9.9"}', "{"]) {
    const result = await verifyPackage(
      "x",
      "1.0.0",
      REBUILT,
      await source({ ...SAME, "package.json": manifest }),
      OURS,
    );
    assertEquals(result, {
      status: "mismatch",
      problems: ["package.json: differs from the rebuild."],
    });
  }
});

Deno.test("a tarball that does not hash to the registry's integrity is refused", async () => {
  const result = await verifyPackage(
    "x",
    "1.0.0",
    REBUILT,
    await source(SAME, "sha512-AAAA"),
    OURS,
  );
  assertEquals(result.status, "mismatch");
  assertStringIncludes(
    result.status === "mismatch" ? result.problems[0] : "",
    "not the registry's sha512-AAAA",
  );
  assertStringIncludes(
    await integrityProblem(text("x"), "sha1-abc") ?? "",
    "no sha512",
  );
  assertEquals(await integrityProblem(text("x"), await sri(text("x"))), null);
});

Deno.test("a version or a package that is not on npm is skipped", async () => {
  const src = await source(SAME);
  assertEquals(await verifyPackage("x", "2.0.0", REBUILT, src, OURS), {
    status: "skipped",
    reason: "version 2.0.0 is not on npm.",
  });
  assertEquals(await verifyPackage("y", "1.0.0", REBUILT, src, OURS), {
    status: "skipped",
    reason: "the package is not on npm.",
  });
});

Deno.test("distOf reads a version's tarball and integrity, and nothing malformed", () => {
  const doc = {
    versions: { "1.0.0": { dist: { tarball: "u", integrity: "i" } } },
  };
  assertEquals(distOf(doc, "1.0.0"), {
    tarball: "u",
    integrity: "i",
    attestations: null,
  });
  const withProvenance = {
    versions: {
      "1.0.0": {
        dist: {
          tarball: "u",
          integrity: "i",
          attestations: {
            url: "a",
            provenance: { predicateType: "https://slsa.dev/provenance/v1" },
          },
        },
      },
    },
  };
  assertEquals(distOf(withProvenance, "1.0.0")?.attestations, "a");
  for (
    const bad of [
      null,
      [],
      {},
      { versions: [] },
      { versions: { "1.0.0": 1 } },
      {
        versions: { "1.0.0": { dist: { tarball: "u" } } },
      },
    ]
  ) assertEquals(distOf(bad, "1.0.0"), null);
});

Deno.test("tarballFiles strips package/ and ignores directories", () => {
  const files = tarballFiles([
    { name: "package/", data: new Uint8Array() },
    { name: "package/src/a.js", data: text("a") },
    { name: "b.js", data: text("b") },
  ]);
  assertEquals([...files.keys()], ["src/a.js", "b.js"]);
  assertEquals(compareFiles(files, files), []);
});

Deno.test("only mismatches fail, and comparing nothing fails unless allowed", () => {
  const ok: VerifyResult = { status: "match" };
  const skipped: VerifyResult = { status: "skipped", reason: "no" };
  const bad: VerifyResult = {
    status: "mismatch",
    problems: ["a.js: differs."],
  };
  assertEquals(
    failures(new Map<string, VerifyResult>([["x", ok], ["y", skipped]]), false),
    [],
  );
  assertEquals(failures(new Map<string, VerifyResult>([["x", bad]]), true), [
    "@zuke-build/x: a.js: differs.",
  ]);
  assertStringIncludes(
    failures(new Map<string, VerifyResult>([["y", skipped]]), false)[0],
    "nothing was compared",
  );
  assertEquals(
    failures(new Map<string, VerifyResult>([["y", skipped]]), true),
    [],
  );
});

Deno.test("readTree lists nested files by relative path", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/src`);
    await Deno.writeTextFile(`${dir}/mod.js`, "m");
    await Deno.writeTextFile(`${dir}/src/a.js`, "a");
    assertEquals([...(await readTree(dir)).keys()].sort(), [
      "mod.js",
      "src/a.js",
    ]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("the npm build pins LF, and a manifest does not depend on key order or path", () => {
  const config = npmTsconfig([], "/a/packages", "/a/dist");
  const options = config.compilerOptions;
  assertEquals(
    typeof options === "object" && options !== null && "newLine" in options &&
      options.newLine,
    "lf",
  );
  const deno = {
    name: "@zuke/x",
    version: "1.0.0",
    exports: { ".": "./mod.ts", "./b": "./src/b.ts" },
    imports: { "@zuke/core": "jsr:@zuke/core@^1", "@zuke/a": "jsr:@zuke/a@^1" },
  };
  const json = JSON.stringify(npmManifest(deno));
  assertEquals(JSON.stringify(npmManifest(deno)), json);
  assertEquals(Object.keys(JSON.parse(json).dependencies), [
    "@zuke/a",
    "@zuke/core",
  ]);
  assertEquals(json.includes("/home"), false);
});

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
  commit: "4576519f81b93bf96bd7457fc7252b8cfa11e67f",
};
const SIGSTORE_SHA512 =
  "2cd772450f5ec7936895af77cf55df9bd59ec078b2d6fdd70c7f12562ceb5b33dc193b87a62dc2e54e8442e08d1fb3a8ec6de3fb5e9c9cd7fd55ddd5671a5a7c";

Deno.test("a real npm attestation passes for its tarball, repository, workflow and commit", () => {
  assertEquals(provenanceProblems(FIXTURE, SIGSTORE_SHA512, SIGSTORE), []);
  // A checkout that is not the built commit does not constrain it.
  assertEquals(
    provenanceProblems(FIXTURE, SIGSTORE_SHA512, { ...SIGSTORE, commit: null }),
    [],
  );
});

Deno.test("a real npm attestation fails for another tarball, repository, workflow or commit", () => {
  const wrong = (over: Partial<ExpectedProvenance>, bytes = SIGSTORE_SHA512) =>
    provenanceProblems(FIXTURE, bytes, { ...SIGSTORE, ...over });
  assertStringIncludes(wrong({}, "00")[0], "no subject has the sha512");
  assertStringIncludes(
    wrong({ repository: "https://github.com/zuke-build/zuke" })[0],
    "built in https://github.com/sigstore/sigstore-js",
  );
  assertStringIncludes(
    wrong({ path: ".github/workflows/x.yml" })[0],
    "built by",
  );
  assertStringIncludes(wrong({ commit: "abc" })[0], "built from 4576519");
});

Deno.test("attestations without SLSA provenance, or unreadable, are refused", () => {
  for (
    const bad of [null, {}, { attestations: [] }, {
      attestations: [{ predicateType: "https://slsa.dev/provenance/v1" }],
    }]
  ) {
    assertStringIncludes(provenanceProblems(bad, "00", OURS)[0], "no SLSA");
  }
  const garbage = {
    attestations: [{
      predicateType: "https://slsa.dev/provenance/v1",
      bundle: { dsseEnvelope: { payload: btoa("{") } },
    }],
  };
  assertStringIncludes(
    provenanceProblems(garbage, "00", OURS)[0],
    "not readable",
  );
  assertStringIncludes(
    provenanceProblems(attestations({}), "00", OURS).join("\n"),
    "built from undefined",
  );
});

Deno.test("verifyPackage requires provenance that names our workflow, commit and these bytes", async () => {
  const problems = async (
    over?: { repository?: string; path?: string; commit?: string },
    withAttestation = true,
  ) => {
    const result = await verifyPackage(
      "x",
      "1.0.0",
      REBUILT,
      await source(SAME, undefined, over, withAttestation),
      OURS,
    );
    return result.status === "mismatch" ? result.problems : [];
  };
  assertEquals(await problems(), []);
  assertEquals(await problems(undefined, false), [
    "the version has no SLSA provenance attestation.",
  ]);
  assertStringIncludes(
    (await problems({ repository: "https://github.com/evil/zuke" }))[0],
    "built in",
  );
  assertStringIncludes(
    (await problems({ path: ".github/workflows/ci.yml" }))[0],
    "built by",
  );
  assertStringIncludes(
    (await problems({ commit: "bad" }))[0],
    "built from bad",
  );
  // Provenance that vouches for other bytes than the ones compared.
  const src = await source(SAME);
  const other = {
    ...src,
    attestations: () => Promise.resolve(attestations(statement("00"))),
  };
  const result = await verifyPackage("x", "1.0.0", REBUILT, other, OURS);
  assertStringIncludes(
    result.status === "mismatch" ? result.problems[0] : "",
    "no subject has the sha512",
  );
});

/** A git that knows `tags` (tag to commit) and says `changed` differs since. */
function git(tags: Record<string, string>, changed: string[]): GitProbe {
  return {
    tagCommit: (tag) => Promise.resolve(tags[tag] ?? null),
    changed: () => Promise.resolve(changed),
    head: () => Promise.resolve("headsha"),
  };
}

Deno.test("changedSinceRelease: no tag compares, an unchanged tag compares, a changed one skips", async () => {
  assertEquals(await changedSinceRelease("x", "1.0.0", git({}, ["a"])), null);
  const tagged = { "x-v1.0.0": "tag-commit" };
  assertEquals(await changedSinceRelease("x", "1.0.0", git(tagged, [])), null);
  assertEquals(
    await changedSinceRelease("x", "1.0.0", git(tagged, ["packages/x/a.ts"])),
    "packages/x has changed since x-v1.0.0; check out the tag to verify it.",
  );
  // The provenance must name the tag's commit, else the checkout's.
  assertEquals(await builtCommit("x", "1.0.0", git(tagged, [])), "tag-commit");
  assertEquals(await builtCommit("x", "1.0.0", git({}, [])), "headsha");
});

Deno.test("registrySource: 404 is not published, other errors fail, downloads are read", async () => {
  const dir = await Deno.makeTempDir();
  const answer = (status: number, body = "{}"): typeof fetch => () =>
    Promise.resolve(new Response(body, { status }));
  try {
    const scratch = absolutePath(dir);
    assertEquals(
      await registrySource(scratch, answer(404)).document("x"),
      null,
    );
    assertEquals(
      await registrySource(scratch, answer(200, '{"a":1}')).document("x"),
      { a: 1 },
    );
    await assertRejects(
      () => registrySource(scratch, answer(500)).document("x"),
      HttpError,
    );
    assertEquals(
      await registrySource(scratch, answer(200, "[2]")).attestations("u"),
      [2],
    );
    assertEquals(
      await registrySource(scratch, answer(200, "tgz")).tarball("u"),
      text("tgz"),
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("auditSignatures installs the verified versions, and a failing npm fails it", async () => {
  const dir = await Deno.makeTempDir();
  const calls: string[] = [];
  const npm = (failAudit: boolean): NpmProbe => ({
    install: (_project, specs) => {
      calls.push(...specs);
      return Promise.resolve();
    },
    auditSignatures: () =>
      failAudit
        ? Promise.reject(new Error("missing signatures"))
        : Promise.resolve(),
  });
  try {
    const project = absolutePath(dir)("p");
    await auditSignatures(project, new Map([["core", "1.0.0"]]), npm(false));
    assertEquals(calls, ["@zuke-build/core@1.0.0"]);
    await assertRejects(
      () => auditSignatures(project, new Map([["core", "1.0.0"]]), npm(true)),
      Error,
      "npm audit signatures failed: missing signatures",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

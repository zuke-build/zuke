/**
 * Smoke tests for the release-tooling modules under `build/` — code that runs
 * only in CI's release jobs and, before this file, wasn't imported by any
 * test, so it carried zero coverage. Each test below exercises the pure logic
 * of its module (JSON/shape parsing, decision branches, string rendering)
 * without a network call, a real `deno publish`, or a real `deno doc`.
 *
 * @module
 */

import { Build } from "@zuke/core";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "../packages/core/tests/_assert.ts";
import {
  localVersion,
  packageEntrypoints,
  PACKAGES,
  readVersion,
} from "../build/packages.ts";
import {
  buildSymbol,
  functionSignature,
  isPublicMember,
  memberMethod,
  memberProperty,
  moduleSummary,
  renderParam,
  renderType,
  symbolMembers,
  symbolSignature,
  transformPackage,
} from "../build/api_reference.ts";
import { launcherScript, publishOne } from "../build/publish.ts";
import {
  DEFAULT_WEBSITE_REPO,
  resolveSyncTarget,
  runWebsiteSync,
  syncBranchInfo,
  type WebsiteSyncDeps,
} from "../build/website_sync.ts";
import {
  catalogueDrift,
  curatedPackages,
  renderToolsModule,
} from "../build/website_tools.ts";
import {
  cliReference,
  crossPackageTypesOf,
  docsOptions,
} from "../build/docs.ts";

// ---------------------------------------------------------------------------
// build/packages.ts
// ---------------------------------------------------------------------------

Deno.test("PACKAGES lists core first and has no duplicates", () => {
  assertEquals(PACKAGES.length > 0, true);
  assertEquals(PACKAGES[0], "core");
  assertEquals(new Set(PACKAGES).size, PACKAGES.length);
});

Deno.test("readVersion accepts a well-formed deno.json shape", () => {
  assertEquals(readVersion({ version: "1.2.3" }), "1.2.3");
});

Deno.test("readVersion rejects a non-object", () => {
  assertThrows(() => readVersion(null), Error, "must be a JSON object");
  assertThrows(() => readVersion("nope"), Error, "must be a JSON object");
});

Deno.test("readVersion rejects a missing version field", () => {
  assertThrows(() => readVersion({}), Error, 'missing a "version" field');
});

Deno.test("readVersion rejects a non-string version", () => {
  assertThrows(
    () => readVersion({ version: 1 }),
    Error,
    '"version" must be a string',
  );
});

Deno.test("packageEntrypoints resolves core's exports map to real paths", async () => {
  const entrypoints = await packageEntrypoints("core");
  assertEquals(entrypoints.includes("packages/core/mod.ts"), true);
  assertEquals(entrypoints.includes("packages/core/src/tooling.ts"), true);
  assertEquals(
    entrypoints.includes("packages/core/src/tooling_conformance.ts"),
    true,
  );
});

Deno.test("localVersion matches core's own deno.json", async () => {
  const raw = JSON.parse(await Deno.readTextFile("packages/core/deno.json"));
  assertEquals(await localVersion("core"), raw.version);
});

// ---------------------------------------------------------------------------
// build/api_reference.ts
// ---------------------------------------------------------------------------

Deno.test("renderType: typeRef with and without generics", () => {
  assertEquals(
    renderType({
      kind: "typeRef",
      value: { typeName: "Promise", typeParams: [{ repr: "string" }] },
    }),
    "Promise<string>",
  );
  assertEquals(
    renderType({ kind: "typeRef", value: { typeName: "Thing" } }),
    "Thing",
  );
});

Deno.test("renderType: array, union, intersection, fallback, undefined", () => {
  assertEquals(
    renderType({ kind: "array", value: { repr: "string" } }),
    "string[]",
  );
  assertEquals(
    renderType({ kind: "union", value: [{ repr: "A" }, { repr: "B" }] }),
    "A | B",
  );
  assertEquals(
    renderType({
      kind: "intersection",
      value: [{ repr: "A" }, { repr: "B" }],
    }),
    "A & B",
  );
  assertEquals(renderType({ repr: "Weird" }), "Weird");
  assertEquals(renderType({}), "unknown");
  assertEquals(renderType(undefined), "unknown");
});

Deno.test("renderParam: rest, assign, and identifier forms", () => {
  assertEquals(
    renderParam({
      kind: "rest",
      arg: { name: "parts" },
      tsType: { kind: "array", value: { repr: "string" } },
    }),
    "...parts: string[]",
  );
  assertEquals(
    renderParam({ kind: "rest", tsType: { repr: "unknown" } }),
    "...args: unknown",
  );
  assertEquals(
    renderParam({
      kind: "assign",
      left: { name: "scale", optional: true, tsType: { repr: "number" } },
    }),
    "scale?: number",
  );
  assertEquals(renderParam({ kind: "assign", left: {} }), "arg?: unknown");
  assertEquals(
    renderParam({ name: "x", optional: false, tsType: { repr: "number" } }),
    "x: number",
  );
  assertEquals(
    renderParam({ name: "y", optional: true, tsType: { repr: "string" } }),
    "y?: string",
  );
  assertEquals(
    renderParam({ left: { name: "z" }, tsType: { repr: "number" } }),
    "z: number",
  );
});

Deno.test("functionSignature: async, params, and a missing def", () => {
  assertEquals(
    functionSignature("run", {
      isAsync: true,
      params: [{ name: "a", tsType: { repr: "A" } }],
      returnType: { repr: "void" },
    }),
    "async function run(a: A): void",
  );
  assertEquals(functionSignature("run", undefined), "function run(): unknown");
});

Deno.test("symbolSignature: every kind branch, including overloads", () => {
  assertEquals(
    symbolSignature("run", "function", [
      { kind: "function", def: { params: [], returnType: { repr: "void" } } },
      {
        kind: "function",
        def: {
          params: [{ name: "x", tsType: { repr: "number" } }],
          returnType: { repr: "void" },
        },
      },
    ]),
    "function run(): void\nfunction run(x: number): void",
  );
  assertEquals(symbolSignature("run", "function", []), "function run()");
  assertEquals(
    symbolSignature("count", "variable", [
      { def: { tsType: { repr: "number" } } },
    ]),
    "const count: number",
  );
  assertEquals(
    symbolSignature("Mode", "typeAlias", [
      { def: { tsType: { repr: '"a" | "b"' } } },
    ]),
    'type Mode = "a" | "b"',
  );
  assertEquals(
    symbolSignature("Widget", "class", [{ def: { extends: "Base" } }]),
    "class Widget extends Base",
  );
  assertEquals(
    symbolSignature("Widget", "class", [{ def: {} }]),
    "class Widget",
  );
  assertEquals(symbolSignature("Shape", "interface", [{}]), "interface Shape");
  assertEquals(symbolSignature("Color", "enum", [{}]), "enum Color");
  assertEquals(symbolSignature("NS", "namespace", [{}]), "namespace NS");
  assertEquals(symbolSignature("Mystery", "weird-kind", [{}]), "Mystery");
});

Deno.test("isPublicMember: undefined and public are public; private/protected are not", () => {
  assertEquals(isPublicMember(undefined), true);
  assertEquals(isPublicMember("public"), true);
  assertEquals(isPublicMember("private"), false);
  assertEquals(isPublicMember("protected"), false);
});

Deno.test("memberMethod: class-style (functionDef) and interface-style (flat)", () => {
  assertEquals(
    memberMethod({
      name: "render",
      functionDef: {
        params: [{ name: "x", tsType: { repr: "number" } }],
        returnType: { repr: "string" },
      },
      jsDoc: { doc: "Renders." },
    }),
    {
      name: "render",
      kind: "method",
      optional: false,
      signature: "render(x: number): string",
      doc: "Renders.",
    },
  );
  assertEquals(
    memberMethod({
      name: "area",
      optional: true,
      params: [],
      returnType: { repr: "number" },
    }),
    {
      name: "area",
      kind: "method",
      optional: true,
      signature: "area?(): number",
      doc: "",
    },
  );
});

Deno.test("memberProperty: optional and required", () => {
  assertEquals(
    memberProperty({
      name: "count",
      optional: true,
      tsType: { repr: "number" },
    }),
    {
      name: "count",
      kind: "property",
      optional: true,
      signature: "count?: number",
      doc: "",
    },
  );
  assertEquals(
    memberProperty({ name: "id", tsType: { repr: "string" } }),
    {
      name: "id",
      kind: "property",
      optional: false,
      signature: "id: string",
      doc: "",
    },
  );
});

Deno.test("symbolMembers: keeps only public members, methods before properties", () => {
  const members = symbolMembers({
    methods: [
      { name: "render", params: [], returnType: { repr: "void" } },
      {
        name: "secret",
        accessibility: "private",
        params: [],
        returnType: { repr: "void" },
      },
    ],
    properties: [
      { name: "count", tsType: { repr: "number" } },
      {
        name: "hidden",
        accessibility: "protected",
        tsType: { repr: "number" },
      },
    ],
  });
  assertEquals(members.map((m) => m.name), ["render", "count"]);
  assertEquals(symbolMembers(undefined), []);
});

Deno.test("buildSymbol: flags deprecated via a jsDoc tag", () => {
  const symbol = buildSymbol({
    name: "Widget",
    declarations: [
      {
        kind: "class",
        jsDoc: { doc: "A widget.", tags: [{ kind: "deprecated" }] },
        def: { extends: "Base", methods: [], properties: [] },
      },
    ],
  });
  assertEquals(symbol.name, "Widget");
  assertEquals(symbol.kind, "class");
  assertEquals(symbol.doc, "A widget.");
  assertEquals(symbol.signature, "class Widget extends Base");
  assertEquals(symbol.deprecated, true);
  assertEquals(symbol.members, []);
});

Deno.test("buildSymbol: no declarations falls back to a bare variable", () => {
  const symbol = buildSymbol({ name: "ghost", declarations: [] });
  assertEquals(symbol.kind, "variable");
  assertEquals(symbol.doc, "");
  assertEquals(symbol.deprecated, false);
  assertEquals(symbol.members, undefined);
});

Deno.test("moduleSummary: first non-empty line, skipping blank module docs", () => {
  assertEquals(
    moduleSummary([
      { module_doc: { doc: "" } },
      { module_doc: { doc: "\nSecond node doc.\nmore text" } },
    ]),
    "Second node doc.",
  );
  assertEquals(moduleSummary([{}]), "");
  assertEquals(moduleSummary([]), "");
});

Deno.test("transformPackage: dedupes first-seen, sorts, drops zero-declaration symbols", () => {
  const pkg = transformPackage("demo", {
    nodes: {
      "a.ts": {
        module_doc: { doc: "" },
        symbols: [
          { name: "zebra", declarations: [{ kind: "enum" }] },
          {
            name: "alpha",
            declarations: [
              {
                kind: "function",
                def: { params: [], returnType: { repr: "void" } },
              },
            ],
          },
          { name: "ghost", declarations: [] },
        ],
      },
      "b.ts": {
        module_doc: { doc: "\nPackage summary line.\n" },
        symbols: [
          {
            name: "alpha",
            declarations: [
              {
                kind: "function",
                def: { params: [], returnType: { repr: "number" } },
              },
            ],
          },
          {
            name: "beta",
            declarations: [{
              kind: "variable",
              def: { tsType: { repr: "string" } },
            }],
          },
        ],
      },
    },
  });
  assertEquals(pkg.name, "@zuke/demo");
  assertEquals(pkg.dir, "demo");
  assertEquals(pkg.summary, "Package summary line.");
  assertEquals(pkg.symbols.map((s) => s.name), ["alpha", "beta", "zebra"]);
  // a.ts's declaration wins (returnType void), not b.ts's later duplicate.
  const alpha = pkg.symbols.find((s) => s.name === "alpha");
  assertEquals(alpha?.signature, "function alpha(): void");
});

// ---------------------------------------------------------------------------
// build/publish.ts — the timeout re-check decision
// ---------------------------------------------------------------------------

/** A fake {@link import("../build/publish.ts").PublishOneDeps} recording every call. */
function fakeDeps(opts: {
  publishedAnswers: boolean[];
  publishResult: boolean;
}) {
  const calls = { info: [] as string[], success: [] as string[] };
  const answers = [...opts.publishedAnswers];
  return {
    deps: {
      isPublished: (_pkg: string, _version: string) => {
        const next = answers.shift();
        return Promise.resolve(next ?? false);
      },
      publishPackage: (_pkg: string) => Promise.resolve(opts.publishResult),
      info: (m: string) => calls.info.push(m),
      success: (m: string) => calls.success.push(m),
    },
    calls,
  };
}

Deno.test("publishOne: skips a package already on JSR", async () => {
  const { deps, calls } = fakeDeps({
    publishedAnswers: [true],
    publishResult: true,
  });
  await publishOne("core", "1.0.0", deps);
  assertEquals(calls.info, ["@zuke/core@1.0.0 is already on JSR."]);
  assertEquals(calls.success, []);
});

Deno.test("publishOne: publishes cleanly when not yet on JSR", async () => {
  const { deps, calls } = fakeDeps({
    publishedAnswers: [false],
    publishResult: true,
  });
  await publishOne("core", "1.0.0", deps);
  assertEquals(calls.info, ["Publishing @zuke/core@1.0.0 to JSR..."]);
  assertEquals(calls.success, []);
});

Deno.test("publishOne: a stalled publish that actually landed is a success", async () => {
  const { deps, calls } = fakeDeps({
    publishedAnswers: [false, true],
    publishResult: false,
  });
  await publishOne("core", "1.0.0", deps);
  assertEquals(calls.success, [
    "@zuke/core@1.0.0 uploaded (provenance stalled).",
  ]);
});

Deno.test("publishOne: a stalled publish that never landed throws", async () => {
  const { deps } = fakeDeps({
    publishedAnswers: [false, false],
    publishResult: false,
  });
  await assertRejects(
    () => publishOne("core", "1.0.0", deps),
    Error,
    "timed out before reaching JSR",
  );
});

Deno.test("launcherScript: posix quotes every argv word and cds to the repo root", () => {
  const script = launcherScript(["deno", "run", "-A", "it's.ts"], false);
  assertEquals(script.startsWith("#!/bin/sh\n"), true);
  assertEquals(script.includes("|| exit 1"), true);
  // A literal single quote is escaped by closing, escaping, reopening.
  assertEquals(script.includes("'it'\\''s.ts'"), true);
  assertEquals(script.trimEnd().endsWith('"$@"'), true);
});

Deno.test("launcherScript: windows quotes every argv word and cds to the repo root", () => {
  const script = launcherScript(["deno", "run", 'say "hi"'], true);
  assertEquals(script.startsWith("@echo off\r\n"), true);
  assertEquals(script.includes("|| exit /b 1"), true);
  // A literal double quote is escaped by doubling.
  assertEquals(script.includes('"say ""hi"""'), true);
  assertEquals(script.trimEnd().endsWith("%*"), true);
});

// ---------------------------------------------------------------------------
// build/website_sync.ts
// ---------------------------------------------------------------------------

Deno.test("resolveSyncTarget: null when the token is absent or empty", () => {
  assertEquals(resolveSyncTarget({}), null);
  assertEquals(resolveSyncTarget({ token: "" }), null);
});

Deno.test("resolveSyncTarget: the default repo, or an explicit override", () => {
  assertEquals(resolveSyncTarget({ token: "abc" }), {
    token: "abc",
    repo: DEFAULT_WEBSITE_REPO,
  });
  assertEquals(resolveSyncTarget({ token: "abc", repo: "me/site" }), {
    token: "abc",
    repo: "me/site",
  });
});

Deno.test("resolveSyncTarget: refuses an override that is not an owner/repo slug", () => {
  // This is the one place a cross-repo write token leaves for another
  // repository, so the slug is checked before it reaches `git push` and
  // `gh pr create` rather than after.
  for (
    const repo of [
      "https://evil.example/x/y", // a URL, not a slug
      "user:token@github.com/o/r", // embedded credential
      "owner/repo/extra", // an extra path segment
      "owner", // no repo half
      "/repo", // no owner half
      "owner/", // empty repo half
      "-owner/repo", // segment may not start with a dash
      "owner/repo with space",
      "", // set but empty: not the same as unset
    ]
  ) {
    assertThrows(
      () => resolveSyncTarget({ token: "abc", repo }),
      Error,
      "owner/repo",
    );
  }
});

Deno.test("syncBranchInfo: names the branch and commit message from a version", () => {
  assertEquals(syncBranchInfo("1.2.3"), {
    branch: "zuke-sync/1.2.3",
    message: "chore: sync docs + api reference for core@1.2.3",
  });
});

/**
 * A {@link WebsiteSyncDeps} that fails any call except `.warn` — used to prove
 * the no-token guard returns before touching any real dependency.
 */
function unreachableDeps(warnings: string[]): WebsiteSyncDeps {
  const boom = (name: string) => () => {
    throw new Error(`unexpected call: ${name}`);
  };
  return {
    mintToken: boom("mintToken"),
    regenerateDocs: boom("regenerateDocs"),
    regenerateApiJson: boom("regenerateApiJson"),
    makeTempDir: boom("makeTempDir"),
    removeDir: boom("removeDir"),
    cloneWebsite: boom("cloneWebsite"),
    createSyncBranch: boom("createSyncBranch"),
    copyArtifacts: boom("copyArtifacts"),
    stageAll: boom("stageAll"),
    hasStagedChanges: boom("hasStagedChanges"),
    commitStaged: boom("commitStaged"),
    pushBranch: boom("pushBranch"),
    openOrRefreshPr: boom("openOrRefreshPr"),
    mergePr: boom("mergePr"),
    info: boom("info"),
    success: boom("success"),
    warn: (m) => warnings.push(m),
  };
}

/** What a {@link fakeSyncDeps} run recorded, for assertions without `unknown` indexing. */
interface SyncCalls {
  mintToken: Array<{ appId: string; repo: string }>;
  cloneWebsite: Array<{ repo: string; dir: string }>;
  commitStaged: number;
  pushBranch: number;
  openOrRefreshPr: number;
  mergePr: Array<{ repo: string; branch: string }>;
  removeDir: string[];
  info: string[];
  success: string[];
  warn: string[];
}

/** A {@link WebsiteSyncDeps} that performs every step as a hermetic no-op. */
function fakeSyncDeps(
  overrides: Partial<WebsiteSyncDeps> = {},
): { deps: WebsiteSyncDeps; calls: SyncCalls } {
  const calls: SyncCalls = {
    cloneWebsite: [],
    commitStaged: 0,
    pushBranch: 0,
    openOrRefreshPr: 0,
    mergePr: [],
    removeDir: [],
    mintToken: [],
    info: [],
    success: [],
    warn: [],
  };
  const deps: WebsiteSyncDeps = {
    mintToken: (credentials, repo) => {
      calls.mintToken.push({ appId: credentials.appId, repo });
      return Promise.resolve("minted-token");
    },
    regenerateDocs: () => Promise.resolve(),
    regenerateApiJson: () => Promise.resolve(),
    makeTempDir: () => Promise.resolve("/tmp/fake-sync-dir"),
    removeDir: (dir) => {
      calls.removeDir.push(dir);
      return Promise.resolve();
    },
    cloneWebsite: (repo, dir) => {
      calls.cloneWebsite.push({ repo, dir });
      return Promise.resolve();
    },
    createSyncBranch: () => Promise.resolve(),
    copyArtifacts: () => Promise.resolve(),
    stageAll: () => Promise.resolve(),
    hasStagedChanges: () => Promise.resolve(false),
    commitStaged: () => {
      calls.commitStaged++;
      return Promise.resolve();
    },
    pushBranch: () => {
      calls.pushBranch++;
      return Promise.resolve();
    },
    openOrRefreshPr: () => {
      calls.openOrRefreshPr++;
      return Promise.resolve({ code: 0, text: "" });
    },
    mergePr: (repo, branch) => {
      calls.mergePr.push({ repo, branch });
      return Promise.resolve({ code: 0, text: "" });
    },
    info: (m) => calls.info.push(m),
    success: (m) => calls.success.push(m),
    warn: (m) => calls.warn.push(m),
    ...overrides,
  };
  return { deps, calls };
}

/**
 * Run `fn` with the sync's environment set to exactly `env`, restoring it after.
 *
 * Every variable the sync reads is set or cleared — including the app
 * credentials — so a value in the developer's own environment cannot change what
 * a test exercises.
 */
async function withSyncEnv(
  env: { token?: string; repo?: string; appId?: string; appKey?: string },
  fn: () => Promise<void>,
): Promise<void> {
  const names = {
    WEBSITE_SYNC_TOKEN: env.token,
    WEBSITE_REPO: env.repo,
    ZUKE_BUILD_APP_ID: env.appId,
    ZUKE_BUILD_APP_KEY: env.appKey,
  };
  const saved = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(names)) {
    saved.set(name, Deno.env.get(name));
    if (value === undefined) Deno.env.delete(name);
    else Deno.env.set(name, value);
  }
  try {
    await fn();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
}

Deno.test("runWebsiteSync: skips cleanly with no credentials at all", async () => {
  await withSyncEnv({}, async () => {
    // unreachableDeps throws if anything beyond the warn ran, proving the
    // function returns right after the guard without touching a real
    // dependency.
    const warnings: string[] = [];
    await runWebsiteSync(new Build(), unreachableDeps(warnings));
    assertEquals(warnings, [
      "Neither WEBSITE_SYNC_TOKEN nor ZUKE_BUILD_APP_ID/_KEY is set — " +
      "skipping the website sync.",
    ]);
  });
});

Deno.test("runWebsiteSync: half a set of app credentials is not enough", async () => {
  // An app id with no key (or the reverse) cannot mint anything, so it must skip
  // rather than reach the minting call and fail there.
  for (const half of [{ appId: "123" }, { appKey: "pem" }]) {
    await withSyncEnv(half, async () => {
      const warnings: string[] = [];
      await runWebsiteSync(new Build(), unreachableDeps(warnings));
      assertEquals(warnings.length, 1);
    });
  }
});

Deno.test("runWebsiteSync: mints an app token scoped to the website repo", async () => {
  await withSyncEnv({ appId: "12345", appKey: "-----BEGIN…" }, async () => {
    const { deps, calls } = fakeSyncDeps({
      hasStagedChanges: () => Promise.resolve(false),
    });
    await runWebsiteSync(new Build(), deps);
    // Minted for exactly the repository the sync targets — that scoping is what
    // replaced the create-github-app-token step.
    assertEquals(calls.mintToken, [{
      appId: "12345",
      repo: "zuke-build/zuke-build.github.io",
    }]);
  });
});

Deno.test("runWebsiteSync: an explicit token wins and mints nothing", async () => {
  await withSyncEnv(
    { token: "tok", appId: "12345", appKey: "pem" },
    async () => {
      const { deps, calls } = fakeSyncDeps({
        hasStagedChanges: () => Promise.resolve(false),
      });
      await runWebsiteSync(new Build(), deps);
      assertEquals(calls.mintToken, []);
    },
  );
});

Deno.test("runWebsiteSync: already in sync — no commit, push, or PR", async () => {
  await withSyncEnv({ token: "tok" }, async () => {
    const { deps, calls } = fakeSyncDeps({
      hasStagedChanges: () => Promise.resolve(false),
    });
    await runWebsiteSync(new Build(), deps);
    assertEquals(calls.info, ["website already in sync — no PR needed."]);
    assertEquals(calls.commitStaged, 0);
    assertEquals(calls.pushBranch, 0);
    assertEquals(calls.openOrRefreshPr, 0);
    assertEquals(calls.mergePr, []);
    assertEquals(calls.removeDir, ["/tmp/fake-sync-dir"]);
  });
});

Deno.test("runWebsiteSync: a freshly opened PR reports success", async () => {
  await withSyncEnv({ token: "tok", repo: "me/site" }, async () => {
    const { deps, calls } = fakeSyncDeps({
      hasStagedChanges: () => Promise.resolve(true),
      openOrRefreshPr: () => Promise.resolve({ code: 0, text: "https://pr/1" }),
    });
    await runWebsiteSync(new Build(), deps);
    const { branch } = syncBranchInfo(await localVersion("core"));
    assertEquals(calls.success, [
      "Opened website sync PR: https://pr/1",
      `Website sync PR for ${branch} will merge once its build check passes.`,
    ]);
    // Opening it is only half the job — the release queues the merge too.
    assertEquals(calls.mergePr, [{ repo: "me/site", branch }]);
    assertEquals(calls.cloneWebsite, [{
      repo: "me/site",
      dir: "/tmp/fake-sync-dir",
    }]);
    // The idempotent path was not taken: staged changes were found.
    assertEquals(calls.commitStaged, 1);
    assertEquals(calls.pushBranch, 1);
    // Cleanup always runs, success or not.
    assertEquals(calls.removeDir, ["/tmp/fake-sync-dir"]);
  });
});

Deno.test("runWebsiteSync: an already-open PR is reported, not treated as a failure", async () => {
  await withSyncEnv({ token: "tok" }, async () => {
    const { deps, calls } = fakeSyncDeps({
      hasStagedChanges: () => Promise.resolve(true),
      openOrRefreshPr: () => Promise.resolve({ code: 1, text: "" }),
    });
    await runWebsiteSync(new Build(), deps);
    assertEquals(
      calls.info.some((m) => m.includes("already open")),
      true,
    );
    // The refreshed PR still gets merged — that is the whole point of merging
    // by head branch rather than by the number this run happened to open.
    assertEquals(calls.mergePr.length, 1);
    assertEquals(
      calls.success.some((m) => m.includes("will merge once its build check")),
      true,
    );
  });
});

Deno.test("runWebsiteSync: a failed merge fails the job and still cleans up", async () => {
  await withSyncEnv({ token: "tok" }, async () => {
    const { deps, calls } = fakeSyncDeps({
      hasStagedChanges: () => Promise.resolve(true),
      openOrRefreshPr: () => Promise.resolve({ code: 0, text: "https://pr/2" }),
      mergePr: () =>
        Promise.resolve({ code: 1, text: "Pull request is not mergeable" }),
    });
    // Must throw: nobody watches the website repo once the merge is automated,
    // so a merge left undone has to turn the job red rather than log a warning
    // into a passing run.
    await assertRejects(
      () => runWebsiteSync(new Build(), deps),
      Error,
      "merge it by hand",
      // The message names the queue-it-to-merge step that failed, not a merge.
    );
    assertEquals(calls.warn.length, 1);
    assertEquals(calls.warn[0].includes("Pull request is not mergeable"), true);
    assertEquals(
      calls.success.some((m) => m.includes("will merge once")),
      false,
    );
    // The `finally` still runs on the throw — no leaked temp clone.
    assertEquals(calls.removeDir, ["/tmp/fake-sync-dir"]);
  });
});

// ---------------------------------------------------------------------------
// build/website_tools.ts
// ---------------------------------------------------------------------------

Deno.test("the landing-page catalogue covers exactly the published packages", () => {
  // The guard that makes the website self-updating worth anything: add a
  // package without landing-page copy, or drop one and leave its entry, and the
  // gate fails here rather than the site quietly advertising the wrong set.
  assertEquals(catalogueDrift(PACKAGES), { missing: [], unknown: [] });
});

Deno.test("catalogueDrift names a package with no entry and an entry with no package", () => {
  const drift = catalogueDrift(["core", "brand-new-tool"]);
  assertEquals(drift.missing, ["@zuke/brand-new-tool"]);
  // Everything curated beyond `core` is now unknown — spot-check one.
  assertEquals(drift.unknown.includes("@zuke/deno"), true);
  assertEquals(drift.unknown.includes("@zuke/core"), false);
});

Deno.test("renderToolsModule refuses to render a stale catalogue", () => {
  assertThrows(
    () => renderToolsModule([...PACKAGES, "brand-new-tool"]),
    Error,
    "no landing-page entry for @zuke/brand-new-tool",
  );
  assertThrows(
    () => renderToolsModule(PACKAGES.filter((pkg) => pkg !== "deno")),
    Error,
    "packages that no longer exist: @zuke/deno",
  );
});

Deno.test("renderToolsModule emits the exports the landing page imports", () => {
  const module = renderToolsModule(PACKAGES);
  // index.astro imports these three by name; renaming one breaks the site.
  assertStringIncludes(module, "export const toolGroups: ToolGroup[] = [");
  assertStringIncludes(module, "export const corePackages = [");
  assertStringIncludes(module, "export const packageCount = new Set([");
  assertStringIncludes(module, "do not edit by hand");
  // A dropped package must not survive anywhere in the generated copy.
  assertEquals(module.includes("@zuke/tsgo"), false);
  assertEquals(curatedPackages().has("@zuke/deno"), true);
});

Deno.test("renderToolsModule output is deterministic", () => {
  // The sync diffs this file against the website's copy to decide whether a PR
  // is needed, so unstable output would open an empty PR every release.
  assertEquals(renderToolsModule(PACKAGES), renderToolsModule(PACKAGES));
});

// ---------------------------------------------------------------------------
// build/docs.ts
// ---------------------------------------------------------------------------

Deno.test("cliReference: lists the build's reserved commands and flags", () => {
  const text = cliReference(new Build());
  assertEquals(text.includes("Reserved commands:"), true);
  assertEquals(text.includes("Option flags:"), true);
  assertEquals(text.includes("docs/cli.md"), true);
});

Deno.test("docsOptions: carries the project framing plus a live CLI block", () => {
  const options = docsOptions(new Build());
  assertEquals(options.regenerateCommand, "./zuke apiDocs");
  if (options.project === undefined) {
    throw new Error("docsOptions must set .project");
  }
  assertEquals(options.project.title, "Zuke");
  assertEquals(options.project.cli, cliReference(new Build()));
});

Deno.test("crossPackageTypesOf: named, type, namespace, and default imports; tests/ excluded", async () => {
  const original = Deno.cwd();
  const dir = await Deno.makeTempDir();
  try {
    Deno.chdir(dir);
    await Deno.mkdir("packages/demo/tests", { recursive: true });
    await Deno.writeTextFile(
      "packages/demo/mod.ts",
      [
        'import { type Configure, target } from "@zuke/core";',
        'import { ToolSettings as Settings } from "@zuke/core/tooling";',
        'import * as shell from "@zuke/core/shell";',
        'import Something from "@zuke/thing";',
        'import { unrelated } from "./local.ts";',
        "",
        "export const x: Configure<Settings> = (s) => s;",
        "export { target, shell, Something, unrelated };",
      ].join("\n"),
    );
    // A `@zuke/*` reference inside tests/ must not count — it isn't doc surface.
    await Deno.writeTextFile(
      "packages/demo/tests/demo_test.ts",
      'import { NotCounted } from "@zuke/core";\nexport { NotCounted };\n',
    );
    const names = await crossPackageTypesOf("demo");
    assertEquals(
      new Set(names),
      new Set(["Configure", "target", "Settings", "shell", "Something"]),
    );
  } finally {
    Deno.chdir(original);
    await Deno.remove(dir, { recursive: true });
  }
});

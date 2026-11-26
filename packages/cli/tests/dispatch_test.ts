// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "../../../tests/_testing.ts";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../../tests/_assert.ts";
import { BUILD_FILE } from "../src/build_file.ts";
import {
  buildLabel,
  type BuildLocation,
  type BuildProbe,
  buildRunArgs,
  defaultBuildProbe,
  defaultBuildRunner,
  DENO_SUPPORT_NOTICE,
  embeddedEngineNotice,
  FORWARDED_ENV,
  LAUNCHER_FILE,
  locateBuild,
  LOCK_FILE,
  NO_LOCK_NOTICE,
  owesDenoSupportNotice,
  type Ownership,
  runBuild,
  runningNotice,
  UntrustedBuildError,
} from "../src/dispatch.ts";
import { EMBEDDED_ENGINE_ENV } from "../src/embedded_engine.ts";
import { CONFIG_FILE, EnvTasks, FileTasks, RuntimeTasks } from "@zuke/core";
import { withTemp } from "../../../tests/_temp.ts";
import { withEnv } from "../../../tests/_env.ts";

/** What a fake filesystem knows: which paths exist, and who owns what. */
interface Fixture {
  /** Paths that exist (for `exists`, the `zuke.json`/`deno.lock` probes). */
  present?: string[];
  /** File contents by path, for `readText`; an unlisted path reads as `{}`. */
  texts?: Record<string, string>;
  /** Ownership answers by path; a path not listed reports `null` (absent). */
  owned?: Record<string, Ownership>;
  /** What `uid()` reports (`null`: a platform without user ids). */
  uid?: number | null;
  /** Where `realPath` resolves a link; an unlisted path is its own. */
  links?: Record<string, string>;
  /**
   * What `readLink` reports, by path. Defaults to {@link links}: a link
   * written as one hop straight to where it resolves.
   */
  written?: Record<string, string>;
}

/** A directory or file owned by `uid` with ordinary permissions. */
function ownedBy(uid: number, mode = 0o755): Ownership {
  return { uid, mode };
}

/** A probe over a fake filesystem, recording every ownership question. */
function probe(fixture: Fixture): BuildProbe & { asked: string[] } {
  const present = new Set(fixture.present ?? []);
  const owned = fixture.owned ?? {};
  const asked: string[] = [];
  // Every root has its own build file, except the ones whose zuke.json text
  // the fixture spells out: those are the SDK roots the engine cases describe.
  const sdkRoots = new Set(
    Object.keys(fixture.texts ?? {}).map((p) =>
      p.slice(0, -"/zuke.json".length)
    ),
  );
  const buildFileAt = (path: string): boolean => {
    if (!path.endsWith("/zuke.ts")) return false;
    const root = path.slice(0, -"/zuke.ts".length);
    return present.has(`${root}/zuke.json`) && !sdkRoots.has(root);
  };
  return {
    asked,
    exists: (path) => Promise.resolve(present.has(path) || buildFileAt(path)),
    ownership: (path) => {
      asked.push(path);
      return Promise.resolve(owned[path] ?? null);
    },
    realPath: (path) => Promise.resolve(fixture.links?.[path] ?? path),
    readLink: (path) =>
      Promise.resolve(
        fixture.written?.[path] ?? fixture.links?.[path] ?? null,
      ),
    uid: () => fixture.uid ?? null,
    readText: (path) => Promise.resolve(fixture.texts?.[path] ?? "{}"),
  };
}

/** Run `locateBuild` expecting the gate to refuse, returning the error. */
async function refused(
  cwd: string,
  fixture: Fixture,
): Promise<UntrustedBuildError> {
  try {
    await locateBuild(cwd, probe(fixture));
  } catch (error) {
    if (error instanceof UntrustedBuildError) return error;
    throw error;
  }
  throw new Error("expected the trust gate to refuse");
}

test("locateBuild finds zuke.json in the cwd itself", async () => {
  const found = await locateBuild(
    "/repo",
    probe({ present: ["/repo/zuke.json"] }),
  );
  assertEquals(found, {
    root: "/repo",
    frozen: false,
    build: BUILD_FILE,
    runtime: "deno",
    launcher: null,
    engine: null,
  });
});

test("locateBuild reads the runtime from zuke.json, and refuses one it does not know", async () => {
  // A Node project: its build file is present, so no engine runs it.
  const node = probe({
    present: ["/n/zuke.json", "/n/build.ts"],
    texts: { "/n/zuke.json": '{"build":"build.ts","runtime":"node"}' },
  });
  assertEquals((await locateBuild("/n", node))?.runtime, "node");
  const bun = probe({
    present: ["/b/zuke.json"],
    texts: { "/b/zuke.json": '{"runtime":"bun"}' },
  });
  await assertRejects(() => locateBuild("/b", bun), Error, "'runtime'");
});

test("locateBuild walks up to the nearest ancestor holding zuke.json", async () => {
  // Two nested projects: the nearest one wins, so a monorepo's package-level
  // build is picked over the workspace root's.
  const found = await locateBuild(
    "/mono/packages/app/src/deep",
    probe({ present: ["/mono/zuke.json", "/mono/packages/app/zuke.json"] }),
  );
  assertEquals(found?.root, "/mono/packages/app");
});

test("locateBuild reports a lockfile beside the config as frozen", async () => {
  const found = await locateBuild(
    "/repo/src",
    probe({ present: ["/repo/zuke.json", "/repo/deno.lock"] }),
  );
  assertEquals(found, {
    root: "/repo",
    frozen: true,
    build: BUILD_FILE,
    runtime: "deno",
    launcher: null,
    engine: null,
  });
  // A lockfile elsewhere on the walk does not count: only the root's does.
  const elsewhere = await locateBuild(
    "/repo/src",
    probe({ present: ["/repo/zuke.json", "/repo/src/deno.lock"] }),
  );
  assertEquals(elsewhere?.frozen, false);
});

test("locateBuild returns null when no ancestor has zuke.json", async () => {
  assertEquals(await locateBuild("/a/b/c", probe({})), null);
  // The filesystem root is probed too, then the walk stops.
  const probed: string[] = [];
  const found = await locateBuild("/a/b", {
    exists: (path) => {
      probed.push(path);
      return Promise.resolve(false);
    },
    ownership: () => Promise.resolve(null),
    realPath: (path) => Promise.resolve(path),
    readLink: () => Promise.resolve(null),
    uid: () => null,
    readText: () => Promise.resolve("{}"),
  });
  assertEquals(found, null);
  assertEquals(probed, ["/a/b/zuke.json", "/a/zuke.json", "/zuke.json"]);
});

test("locateBuild accepts a Windows drive path", async () => {
  const found = await locateBuild(
    "C:\\work\\repo\\src",
    probe({ present: ["C:/work/repo/zuke.json"] }),
  );
  assertEquals(found?.root, "C:/work/repo");
  assertEquals(await locateBuild("C:\\other", probe({})), null);
});

test("the trust gate accepts a root the current user owns", async () => {
  const found = await locateBuild(
    "/home/me/app/src",
    probe({
      present: ["/home/me/app/zuke.json"],
      owned: { "/home/me/app": ownedBy(1000) },
      uid: 1000,
    }),
  );
  assertEquals(found, {
    root: "/home/me/app",
    frozen: false,
    build: BUILD_FILE,
    runtime: "deno",
    launcher: null,
    engine: null,
  });
});

test("the trust gate does not judge the root a launcher started zuke in, and only that root", async () => {
  // A container job runs as root over a checkout another uid owns: the
  // launcher run there names the project, as git's safe.directory would.
  const fixture: Fixture = {
    present: ["/work/app/zuke.json"],
    texts: { "/work/app/zuke.json": '{"engine": "1.3.0"}' },
    owned: {
      "/work/app": ownedBy(1001),
      "/work/app/zuke.json": ownedBy(1001, 0o644),
    },
    uid: 0,
  };
  const found = await locateBuild("/work/app/src", probe(fixture), "/work/app");
  assertEquals(found, {
    root: "/work/app",
    frozen: false,
    build: BUILD_FILE,
    runtime: "deno",
    launcher: null,
    engine: "1.3.0",
  });
  // Another root, or none named, is judged as ever.
  for (const vouched of ["/work", undefined]) {
    let refusal: unknown;
    try {
      await locateBuild("/work/app", probe(fixture), vouched);
    } catch (error) {
      refusal = error;
    }
    assertEquals(refusal instanceof UntrustedBuildError, true);
  }
});

test("the trust gate refuses a root owned by another user", async () => {
  // A `zuke.json` planted by another local user in a shared parent (`/tmp`)
  // must not have `zuke ci` below it run their `zuke.ts` with -A.
  const error = await refused("/tmp/scratch", {
    present: ["/tmp/zuke.json"],
    owned: { "/tmp": ownedBy(0, 0o1777) },
    uid: 1000,
  });
  assertEquals(error.name, "UntrustedBuildError");
  assertEquals(error.root, "/tmp");
  assertEquals(
    error.reason,
    "the directory is owned by user 0, not you (1000)",
  );
  assertEquals(
    error.message.includes("refusing to run the build at /tmp"),
    true,
  );
  // The advice is prose: never a rendered shell line built from a path the
  // filesystem chose, and never the forwarded arguments.
  assertEquals(error.message.includes("cd "), false);
  assertEquals(error.message.includes("./zuke"), true);
});

test("the trust gate refuses a world-writable root even when the user owns it", async () => {
  // Ownership alone is not enough: anyone can plant files in a 777 directory.
  const error = await refused("/home/me/open", {
    present: ["/home/me/open/zuke.json"],
    owned: { "/home/me/open": ownedBy(1000, 0o777) },
    uid: 1000,
  });
  assertEquals(error.reason, "the directory is writable by everyone");
  // Group-writable is the user's own arrangement and passes.
  const found = await locateBuild(
    "/home/me/shared",
    probe({
      present: ["/home/me/shared/zuke.json"],
      owned: { "/home/me/shared": ownedBy(1000, 0o775) },
      uid: 1000,
    }),
  );
  assertEquals(found?.root, "/home/me/shared");
});

test("the trust gate refuses an ancestor config file Deno would read that another user owns", async () => {
  // Deno discovers deno.json / package.json above the root, and an import
  // map planted there rewrites what zuke.ts imports — the sibling of the
  // planted-zuke.json attack, closed the same way.
  for (const name of ["deno.json", "deno.jsonc", "package.json"]) {
    const error = await refused("/tmp/proj/src", {
      present: ["/tmp/proj/zuke.json"],
      owned: {
        "/tmp/proj": ownedBy(1000),
        [`/tmp/${name}`]: ownedBy(0, 0o644),
      },
      uid: 1000,
    });
    assertEquals(error.root, "/tmp/proj");
    assertEquals(
      error.reason,
      `/tmp/${name} is owned by user 0, not you (1000)`,
    );
  }
});

test("the trust gate accepts ancestor config files the user owns, and asks only above the root", async () => {
  const fake = probe({
    present: ["/home/me/mono/app/zuke.json"],
    owned: {
      "/home/me/mono/app": ownedBy(1000),
      "/home/me/mono/deno.json": ownedBy(1000, 0o644),
      "/home/me/package.json": ownedBy(1000, 0o644),
    },
    uid: 1000,
  });
  const found = await locateBuild("/home/me/mono/app/src", fake);
  assertEquals(found?.root, "/home/me/mono/app");
  // The root is judged first, then the files in it that decide what runs,
  // then the config files of every ancestor up to the filesystem root —
  // never the subdirectories walked through — and last the launcher's mode.
  assertEquals(fake.asked, [
    "/home/me/mono/app",
    "/home/me/mono/app/zuke.json",
    "/home/me/mono/app/zuke.ts",
    "/home/me/mono/app/zuke",
    "/home/me/mono/app/deno.lock",
    "/home/me/mono/app/deno.json",
    "/home/me/mono/app/deno.jsonc",
    "/home/me/mono/app/package.json",
    "/home/me/mono/deno.json",
    "/home/me/mono/deno.jsonc",
    "/home/me/mono/package.json",
    "/home/me/deno.json",
    "/home/me/deno.jsonc",
    "/home/me/package.json",
    "/home/deno.json",
    "/home/deno.jsonc",
    "/home/package.json",
    "/deno.json",
    "/deno.jsonc",
    "/package.json",
    "/home/me/mono/app/zuke",
  ]);
});

test("the trust gate refuses a build file in the root that another user owns", async () => {
  // A `chown` of the directory alone passes the directory check; the files
  // that decide what runs must be the user's too.
  for (
    const name of ["zuke.json", "zuke.ts", "zuke", "deno.lock", "deno.json"]
  ) {
    const error = await refused("/home/me/app", {
      present: ["/home/me/app/zuke.json"],
      owned: {
        "/home/me/app": ownedBy(1000),
        [`/home/me/app/${name}`]: ownedBy(0, 0o644),
      },
      uid: 1000,
    });
    assertEquals(
      error.reason,
      `/home/me/app/${name} is owned by user 0, not you (1000)`,
    );
  }
});

test("the trust gate is inert where ownership cannot be compared", async () => {
  // Windows: no user id at all — nothing is ever asked about ownership, and
  // there is no launcher to ask about either.
  const noUid = probe({
    present: ["/repo/zuke.json"],
    owned: { "/repo": ownedBy(7) },
    uid: null,
  });
  assertEquals((await locateBuild("/repo", noUid))?.root, "/repo");
  assertEquals(noUid.asked, []);
  // A filesystem that reports no owner or mode for the entries: not judged
  // on what it cannot report.
  const noOwner = probe({
    present: ["/repo/zuke.json"],
    owned: {
      "/repo": { uid: null, mode: null },
      "/deno.json": { uid: null, mode: null },
    },
    uid: 1000,
  });
  assertEquals((await locateBuild("/repo", noOwner))?.root, "/repo");
});

test("buildRunArgs mirrors the launcher: --frozen only with a lockfile", () => {
  assertEquals(
    buildRunArgs(
      {
        root: "/repo",
        frozen: true,
        build: BUILD_FILE,
        runtime: "deno",
        launcher: null,
        engine: null,
      },
      [
        "ci",
        "--parallel",
      ],
    ),
    ["run", "-A", "--frozen", BUILD_FILE, "ci", "--parallel"],
  );
  assertEquals(
    buildRunArgs(
      {
        root: "/repo",
        frozen: false,
        build: BUILD_FILE,
        runtime: "deno",
        launcher: null,
        engine: null,
      },
      [
        "--list",
        "--json",
      ],
    ),
    ["run", "-A", BUILD_FILE, "--list", "--json"],
  );
  // The argument list is forwarded verbatim — nothing is parsed or reordered,
  // so the build's own CLI sees exactly what the user typed.
  assertEquals(
    buildRunArgs(
      {
        root: "/repo",
        frozen: false,
        build: BUILD_FILE,
        runtime: "deno",
        launcher: null,
        engine: null,
      },
      [],
    ),
    ["run", "-A", BUILD_FILE],
  );
});

/** A regular file's mode with the given permission bits. */
function fileMode(permissions: number): number {
  return 0o100000 | permissions;
}

test("locateBuild reports an executable launcher at the root", async () => {
  const found = await locateBuild(
    "/repo/src",
    probe({
      present: ["/repo/zuke.json"],
      owned: { "/repo/zuke": ownedBy(1000, fileMode(0o755)) },
      uid: 1000,
    }),
  );
  assertEquals(found, {
    root: "/repo",
    frozen: false,
    build: BUILD_FILE,
    runtime: "deno",
    launcher: "/repo/zuke",
    engine: null,
  });
});

test("locateBuild resolves a symlinked launcher and judges its directory", async () => {
  const fixture = (shared: Ownership): Fixture => ({
    present: ["/w/app/zuke.json"],
    owned: {
      "/w/app/zuke": ownedBy(1000, fileMode(0o755)),
      "/w/shared": shared,
    },
    uid: 1000,
    links: { "/w/app/zuke": "/w/shared/zuke" },
  });
  // It runs by its path under the root, so a launcher that finds its project
  // from the path it was called by builds this one; the gate still judges the
  // directory the link resolves into.
  const found = await locateBuild("/w/app", probe(fixture(ownedBy(1000))));
  assertEquals(found?.launcher, "/w/app/zuke");
  // Whoever can write the target's directory can swap the file under it.
  const open = await refused("/w/app", fixture(ownedBy(1000, 0o777)));
  assertEquals(open.reason, "/w/shared is writable by everyone");
  const theirs = await refused("/w/app", fixture(ownedBy(0)));
  assertEquals(theirs.reason, "/w/shared is owned by user 0, not you (1000)");
});

test("a symlinked launcher runs by its root path only as one hop to the judged file", async () => {
  const fixture = (written: string): Fixture => ({
    present: ["/w/app/zuke.json"],
    owned: {
      "/w/app/zuke": ownedBy(1000, fileMode(0o755)),
      "/w/shared": ownedBy(1000),
    },
    uid: 1000,
    links: { "/w/app/zuke": "/w/shared/zuke" },
    written: { "/w/app/zuke": written },
  });
  // Written relative to the root, the usual shape of a shared-launcher link.
  const relative = await locateBuild(
    "/w/app",
    probe(fixture("../shared/zuke")),
  );
  assertEquals(relative?.launcher, "/w/app/zuke");
  // Reached through a linked ancestor (macOS's /var -> /private/var), a
  // relative link is read against the root's real path, so it still counts
  // as one hop.
  const linkedRoot: Fixture = {
    present: ["/var/w/app/zuke.json"],
    owned: {
      "/var/w/app/zuke": ownedBy(1000, fileMode(0o755)),
      "/private/var/w/shared": ownedBy(1000),
    },
    uid: 1000,
    links: {
      "/var/w/app": "/private/var/w/app",
      "/var/w/app/zuke": "/private/var/w/shared/zuke",
    },
    written: { "/var/w/app/zuke": "../shared/zuke" },
  };
  const viaLinkedRoot = await locateBuild("/var/w/app", probe(linkedRoot));
  assertEquals(viaLinkedRoot?.launcher, "/var/w/app/zuke");
  // A chain through another directory: whoever writes that directory could
  // re-point its hop after the check, so the run falls back to `deno run`.
  const chain = await locateBuild("/w/app", probe(fixture("/hop/link")));
  assertEquals(chain?.launcher, null);
  assertEquals(chain?.root, "/w/app");
});

test("the trust gate refuses a root file writable by everyone", async () => {
  const error = await refused("/repo", {
    present: ["/repo/zuke.json"],
    owned: { "/repo/zuke": ownedBy(1000, fileMode(0o777)) },
    uid: 1000,
  });
  assertEquals(error.reason, "/repo/zuke is writable by everyone");
});

test("locateBuild ignores a launcher that is not an executable regular file", async () => {
  const at = (mode: number | null) =>
    locateBuild(
      "/repo",
      probe({
        present: ["/repo/zuke.json"],
        owned: { [`/repo/${LAUNCHER_FILE}`]: { uid: null, mode } },
        uid: 1000,
      }),
    );
  // Not executable, a directory, and no mode at all (Windows) are all "none",
  // so the run falls back to the launcher's own `deno run` invocation.
  assertEquals((await at(fileMode(0o644)))?.launcher, null);
  assertEquals((await at(0o040755))?.launcher, null);
  assertEquals((await at(null))?.launcher, null);
});

test("runBuild runs the launcher with the bare args, else Deno", async () => {
  const calls: Array<[string, string[], string | undefined]> = [];
  const runner = (root: string, args: string[], program?: string) => {
    calls.push([root, args, program]);
    return Promise.resolve(3);
  };
  assertEquals(
    await runBuild(
      runner,
      {
        root: "/repo",
        frozen: true,
        build: BUILD_FILE,
        runtime: "deno",
        launcher: "/repo/zuke",
        engine: null,
      },
      ["ci"],
    ),
    3,
  );
  await runBuild(
    runner,
    {
      root: "/repo",
      frozen: true,
      build: BUILD_FILE,
      runtime: "deno",
      launcher: null,
      engine: null,
    },
    ["ci"],
  );
  // A launcher's own call to the global `zuke` gets Deno, not itself again.
  await withEnv({ [FORWARDED_ENV]: "1" }, async () => {
    await runBuild(
      runner,
      {
        root: "/repo",
        frozen: false,
        build: BUILD_FILE,
        runtime: "deno",
        launcher: "/repo/zuke",
        engine: null,
      },
      ["ci"],
    );
  });
  assertEquals(calls, [
    ["/repo", ["ci"], "/repo/zuke"],
    ["/repo", ["run", "-A", "--frozen", BUILD_FILE, "ci"], undefined],
    ["/repo", ["run", "-A", BUILD_FILE, "ci"], undefined],
  ]);
});

/** A binary's engine at 1.3.0, serving any 1.x pin up to it. */
const EMBEDDED = {
  version: "1.3.0",
  program: "/opt/zuke",
  serves: (pin: string) => pin.startsWith("1.") && pin <= "1.3.0",
};

test("runBuild runs a hosted build the binary's engine serves on the binary itself, launcher or not", async () => {
  const calls: Array<
    [string, string[], string | undefined, Record<string, string> | undefined]
  > = [];
  const runner = (
    root: string,
    args: string[],
    program?: string,
    env?: Readonly<Record<string, string>>,
  ) => {
    calls.push([
      root,
      args,
      program,
      env === undefined ? undefined : { ...env },
    ]);
    return Promise.resolve(4);
  };
  const hosted: Omit<BuildLocation, "engine"> = {
    root: "/py",
    frozen: true,
    build: BUILD_FILE,
    runtime: "deno",
    launcher: "/py/zuke",
  };
  assertEquals(
    await runBuild(
      runner,
      { ...hosted, engine: "1.2.0" },
      ["ci"],
      { ZUKE_PLAIN: "1" },
      EMBEDDED,
    ),
    4,
  );
  // A pin it cannot serve, and a zuke.ts build, go the way they always did.
  await withEnv({ [FORWARDED_ENV]: undefined }, async () => {
    await runBuild(
      runner,
      { ...hosted, engine: "1.4.0" },
      ["ci"],
      undefined,
      EMBEDDED,
    );
    await runBuild(
      runner,
      {
        root: "/ts",
        frozen: false,
        build: BUILD_FILE,
        runtime: "deno",
        launcher: null,
        engine: null,
      },
      ["ci"],
      undefined,
      EMBEDDED,
    );
  });
  assertEquals(calls, [
    ["/py", ["ci"], "/opt/zuke", {
      ZUKE_PLAIN: "1",
      [EMBEDDED_ENGINE_ENV]: "1",
    }],
    ["/py", ["ci"], "/py/zuke", undefined],
    ["/ts", ["run", "-A", BUILD_FILE, "ci"], undefined, undefined],
  ]);
});

test("the binary never falls back to Deno for a hosted build it cannot serve", async () => {
  const runner = () => Promise.reject(new Error("nothing may run"));
  const unserved: BuildLocation = {
    root: "/py",
    frozen: true,
    build: BUILD_FILE,
    runtime: "deno",
    launcher: null,
    engine: "2.0.0",
  };
  // The binary and a Deno-installed zuke both run on Deno, whatever runs this.
  const refusal = "zuke: this zuke's built-in @zuke/engine 1.3.0 cannot run " +
    "zuke.json's 2.0.0. Install a zuke release that carries it " +
    "(https://github.com/zuke-build/zuke/blob/master/docs/install.md), run " +
    "the project's download launcher (./zuke, or .\\zuke.ps1 on Windows), " +
    "which fetches the release it pins, or move the project with " +
    "`zuke upgrade --engine`.";
  await withEnv({ [FORWARDED_ENV]: undefined }, async () => {
    // No launcher to go to (every root on Windows).
    await assertRejects(
      () => runBuild(runner, unserved, ["ci"], undefined, EMBEDDED, "deno"),
      Error,
      refusal,
    );
  });
  // The launcher's own zuke: going back to the launcher would loop.
  await withEnv({ [FORWARDED_ENV]: "1" }, async () => {
    await assertRejects(
      () =>
        runBuild(
          runner,
          { ...unserved, launcher: "/py/zuke" },
          ["ci"],
          undefined,
          EMBEDDED,
          "deno",
        ),
      Error,
      refusal,
    );
  });
  // A Deno-installed zuke carries no engine, so its user is on Deno already.
  const calls: string[][] = [];
  await withEnv({ [FORWARDED_ENV]: "1" }, async () => {
    await runBuild(
      (_root, args) => {
        calls.push(args);
        return Promise.resolve(0);
      },
      unserved,
      ["ci"],
      undefined,
      undefined,
      "deno",
    );
  });
  assertEquals(calls, [[
    "run",
    "-A",
    "--lock=deno.lock",
    "--frozen",
    "jsr:@zuke/engine@2.0.0",
    "ci",
  ]]);
});

test("the binary's engine is named when it runs the build, and when it cannot", async () => {
  const hosted: BuildLocation = {
    root: "/home/me/app",
    frozen: false,
    build: BUILD_FILE,
    runtime: "deno",
    launcher: null,
    engine: "1.2.0",
  };
  assertEquals(
    runningNotice(hosted, EMBEDDED),
    "zuke: running /home/me/app/zuke.json with the built-in @zuke/engine 1.3.0",
  );
  assertEquals(embeddedEngineNotice(hosted, EMBEDDED), undefined);
  await withEnv({ [FORWARDED_ENV]: undefined }, () => {
    assertEquals(
      embeddedEngineNotice(
        { ...hosted, engine: "2.0.0", launcher: "/home/me/app/zuke" },
        EMBEDDED,
      ),
      "zuke: this zuke's built-in @zuke/engine 1.3.0 cannot run zuke.json's " +
        "2.0.0, so the project's launcher runs it",
    );
    // With no launcher to go to, runBuild refuses instead: nothing to note.
    assertEquals(
      embeddedEngineNotice({ ...hosted, engine: "2.0.0" }, EMBEDDED),
      undefined,
    );
    return Promise.resolve();
  });
  // The label --version and --help give it says the same.
  assertEquals(
    buildLabel(hosted, EMBEDDED),
    "/home/me/app/zuke.json, on the built-in @zuke/engine 1.3.0",
  );
  assertEquals(
    buildLabel({ ...hosted, engine: "2.0.0" }, EMBEDDED),
    "/home/me/app/zuke.json, on @zuke/engine 2.0.0",
  );
  // Nothing to say without an engine compiled in, or for a zuke.ts build.
  assertEquals(embeddedEngineNotice(hosted, undefined), undefined);
  assertEquals(
    embeddedEngineNotice({ ...hosted, engine: null }, EMBEDDED),
    undefined,
  );
});

test("the running notice names the build file at the root, or the engine release", () => {
  assertEquals(
    runningNotice({
      root: "/home/me/app",
      frozen: false,
      build: BUILD_FILE,
      runtime: "deno",
      launcher: null,
      engine: null,
    }),
    "zuke: running /home/me/app/zuke.ts",
  );
  assertEquals(
    runningNotice({
      root: "/home/me/app",
      frozen: false,
      build: BUILD_FILE,
      runtime: "deno",
      launcher: null,
      engine: "1.2.3",
    }),
    "zuke: running /home/me/app/zuke.json with jsr:@zuke/engine@1.2.3",
  );
});

test("a root without zuke.ts runs the engine release its zuke.json names", async () => {
  const sdk = {
    present: ["/app/zuke.json"],
    texts: {
      "/app/zuke.json":
        '{ "sdk": { "command": ["python3"] }, "engine": "1.2.3" }',
    },
  };
  const location = await locateBuild("/app/src", probe(sdk));
  assertEquals(location, {
    root: "/app",
    frozen: false,
    build: BUILD_FILE,
    runtime: "deno",
    launcher: null,
    engine: "1.2.3",
  });
  if (location === null) throw new Error("unreachable");
  assertEquals(buildRunArgs(location, ["--list"]), [
    "run",
    "-A",
    "jsr:@zuke/engine@1.2.3",
    "--list",
  ]);
  // Deno finds a lock only beside a config, so the engine route names it.
  assertEquals(
    buildRunArgs({ ...location, frozen: true }, ["ci"]),
    [
      "run",
      "-A",
      "--lock=deno.lock",
      "--frozen",
      "jsr:@zuke/engine@1.2.3",
      "ci",
    ],
  );
  await assertRejects(
    () =>
      locateBuild(
        "/app",
        probe({
          present: ["/app/zuke.json"],
          texts: { "/app/zuke.json": '{ "engine": "^1" }' },
        }),
      ),
    Error,
    "zuke: zuke.json names 'engine': '^1', which is not an exact version like 1.2.3",
  );
  // A root with its own build file never reads the field.
  const own = await locateBuild(
    "/repo",
    probe({ present: ["/repo/zuke.json"] }),
  );
  assertEquals(own?.engine, null);
});

test("a root without zuke.ts and without an engine version is refused, and bad JSON is named", async () => {
  // Nothing could run it: not the binary, and never Deno for a hosted build.
  for (
    const text of ['{ "sdk": { "command": ["python3"] } }', '{ "engine": "" }']
  ) {
    await assertRejects(
      () =>
        locateBuild(
          "/app",
          probe({
            present: ["/app/zuke.json"],
            texts: { "/app/zuke.json": text },
          }),
        ),
      Error,
      "zuke: /app has no zuke.ts, and its zuke.json names no 'engine' " +
        "release to run its 'sdk' build with",
    );
  }
  await assertRejects(
    () =>
      locateBuild(
        "/app",
        probe({
          present: ["/app/zuke.json"],
          texts: { "/app/zuke.json": "{ nope" },
        }),
      ),
    Error,
    "zuke: /app/zuke.json is not valid JSON",
  );
});

test("the no-lock notice names the lockfile", () => {
  assertEquals(NO_LOCK_NOTICE.includes(LOCK_FILE), true);
});

test("defaultBuildProbe answers from the real filesystem", async () => {
  await withTemp(async (dir) => {
    await FileTasks.writeText(`${dir}/zuke.json`, "{}\n");
    assertEquals(await defaultBuildProbe.exists(`${dir}/zuke.json`), true);
    assertEquals(await defaultBuildProbe.readText(`${dir}/zuke.json`), "{}\n");
    assertEquals(await defaultBuildProbe.exists(`${dir}/deno.lock`), false);
    // A directory this process just created is owned by this process's user
    // — or both sides are null where the platform has no ownership (Windows),
    // which is exactly the pairing the gate treats as inert.
    const own = await defaultBuildProbe.ownership(dir);
    assertEquals(own?.uid, defaultBuildProbe.uid());
    assertEquals(own?.mode === null || typeof own?.mode === "number", true);
    // Nothing there: null, not a throw — an absent ancestor config is normal.
    assertEquals(await defaultBuildProbe.ownership(`${dir}/deno.json`), null);
    assertEquals(
      await defaultBuildProbe.realPath(dir),
      await FileTasks.realPath(dir),
    );
  }, { prefix: "zuke-dispatch-" });
});

test({
  name:
    "defaultBuildRunner runs the given deno argv from the root and returns its code",
  denoOnly:
    "runs a script with deno run, the program defaultBuildRunner starts with no launcher",
  fn: async () => {
    await withTemp(async (dir) => {
      // A self-contained script proves the runner's contract without a build:
      // it runs from `dir` (the cwd it reports) and exits with the code we set.
      await FileTasks.writeText(
        `${dir}/${BUILD_FILE}`,
        "await Deno.writeTextFile('probe.txt', Deno.cwd());\nDeno.exit(7);\n",
      );
      const code = await defaultBuildRunner(dir, ["run", "-A", BUILD_FILE]);
      assertEquals(code, 7);
      // The script's relative write landed in the root, i.e. cwd was `dir`.
      const seen = await FileTasks.readText(`${dir}/probe.txt`);
      assertEquals(
        await FileTasks.realPath(seen),
        await FileTasks.realPath(dir),
      );
    }, { prefix: "zuke-dispatch-" });
  },
});

test({
  name:
    "defaultBuildRunner runs a launcher program from the root with the args",
  ignore: RuntimeTasks.os() === "windows",
  fn: async () => {
    await withTemp(async (dir) => {
      await FileTasks.writeText(
        `${dir}/${LAUNCHER_FILE}`,
        `#!/bin/sh\npwd > probe.txt\necho "$${FORWARDED_ENV}" >> probe.txt\n` +
          `printf '%s\\n' "$@" >> probe.txt\nexit 5\n`,
        (s) => s.mode(0o755),
      );
      const code = await defaultBuildRunner(
        dir,
        ["ci", "--parallel"],
        `${dir}/${LAUNCHER_FILE}`,
      );
      assertEquals(code, 5);
      const [cwd, forwarded, ...args] =
        (await FileTasks.readText(`${dir}/probe.txt`)).trimEnd().split("\n");
      assertEquals(
        await FileTasks.realPath(cwd),
        await FileTasks.realPath(dir),
      );
      assertEquals(forwarded, "1");
      assertEquals(args, ["ci", "--parallel"]);
    }, { prefix: "zuke-dispatch-" });
  },
});

test({
  name:
    "defaultBuildRunner gives the child a PATH even when the parent has none",
  denoOnly:
    "runs a script with deno run, the program defaultBuildRunner starts with no launcher",
  fn: async () => {
    const inherited = EnvTasks.get("PATH");
    try {
      EnvTasks.delete("PATH");
      await withTemp(async (dir) => {
        await FileTasks.writeText(
          `${dir}/${BUILD_FILE}`,
          "await Deno.writeTextFile('path.txt', Deno.env.get('PATH') ?? '');\n",
        );
        assertEquals(
          await defaultBuildRunner(dir, ["run", "-A", BUILD_FILE]),
          0,
        );
        const path = await FileTasks.readText(`${dir}/path.txt`);
        // Just the running Deno's directory: no separator, nothing else.
        const separator = RuntimeTasks.os() === "windows" ? ";" : ":";
        assertEquals(path.includes(separator), false);
        assertEquals(path.length > 0, true);
      }, { prefix: "zuke-dispatch-" });
    } finally {
      if (inherited !== undefined) EnvTasks.set("PATH", inherited);
    }
  },
});

test({
  name: "defaultBuildRunner puts the running Deno first on the child's PATH",
  denoOnly:
    "runs a script with deno run, the program defaultBuildRunner starts with no launcher",
  fn: async () => {
    await withTemp(async (dir) => {
      await FileTasks.writeText(
        `${dir}/${BUILD_FILE}`,
        "await Deno.writeTextFile('path.txt', Deno.env.get('PATH') ?? '');\n",
      );
      assertEquals(await defaultBuildRunner(dir, ["run", "-A", BUILD_FILE]), 0);
      const path = await FileTasks.readText(`${dir}/path.txt`);
      const separator = RuntimeTasks.os() === "windows" ? ";" : ":";
      const [first, ...rest] = path.split(separator);
      const binDir = RuntimeTasks.execPath().replaceAll("\\", "/").replace(
        /\/[^/]+$/,
        "",
      );
      assertEquals(first, binDir);
      // The inherited PATH follows, so nothing the user had is lost.
      const inherited = EnvTasks.get("PATH") ?? "";
      assertEquals(rest.join(separator), inherited);
    }, { prefix: "zuke-dispatch-" });
  },
});

test({
  name:
    "a symlinked shared launcher runs by its path under the root, building this repo",
  // POSIX launchers only: Windows reports no file mode, so it keeps `deno run`.
  ignore: RuntimeTasks.os() === "windows",
  fn: async () => {
    await withTemp(async (dir) => {
      // repo/zuke -> ../shared/zuke, the launcher several repos share. Like
      // the real launchers it finds the project from the path it was called
      // by, so it records that directory.
      await FileTasks.createDirectory(`${dir}/shared`, { recursive: false });
      await FileTasks.createDirectory(`${dir}/repo`, { recursive: false });
      await FileTasks.writeText(
        `${dir}/shared/${LAUNCHER_FILE}`,
        `#!/bin/sh\ncd "$(dirname "$0")" && pwd > "$ZUKE_PROBE_OUT"\n`,
        (s) => s.mode(0o755),
      );
      await FileTasks.symlink(
        `../shared/${LAUNCHER_FILE}`,
        `${dir}/repo/${LAUNCHER_FILE}`,
      );
      await FileTasks.writeText(`${dir}/repo/${CONFIG_FILE}`, "{}\n");
      await FileTasks.writeText(`${dir}/repo/${BUILD_FILE}`, "");

      const found = await locateBuild(`${dir}/repo`, defaultBuildProbe);
      const root = await FileTasks.realPath(`${dir}/repo`);
      assertEquals(found?.launcher, `${found?.root}/${LAUNCHER_FILE}`);
      assertEquals(await FileTasks.realPath(found?.root ?? ""), root);

      const out = `${dir}/probe.txt`;
      await withEnv({ ZUKE_PROBE_OUT: out }, async () => {
        if (found === null) throw new Error("no build found");
        assertEquals(await runBuild(defaultBuildRunner, found, ["ci"]), 0);
      });
      // The launcher saw the repo, not the shared directory it lives in.
      const seen = (await FileTasks.readText(out)).trim();
      assertEquals(await FileTasks.realPath(seen), root);
    }, { prefix: "zuke-dispatch-" });
  },
});

test({
  name:
    "a launcher reached through a chain of links falls back to deno run, never the chain",
  ignore: RuntimeTasks.os() === "windows",
  fn: async () => {
    await withTemp(async (dir) => {
      // repo/zuke -> hop/link -> mine/zuke. The gate judges mine/, but running
      // the chain re-resolves hop/link, which someone else could re-point.
      for (const sub of ["repo", "hop", "mine"]) {
        await FileTasks.createDirectory(`${dir}/${sub}`, { recursive: false });
      }
      await FileTasks.writeText(
        `${dir}/mine/${LAUNCHER_FILE}`,
        "#!/bin/sh\n",
        (s) => s.mode(0o755),
      );
      await FileTasks.symlink(
        `${dir}/mine/${LAUNCHER_FILE}`,
        `${dir}/hop/link`,
      );
      await FileTasks.symlink(
        `${dir}/hop/link`,
        `${dir}/repo/${LAUNCHER_FILE}`,
      );
      await FileTasks.writeText(`${dir}/repo/${CONFIG_FILE}`, "{}\n");
      await FileTasks.writeText(`${dir}/repo/${BUILD_FILE}`, "");
      const found = await locateBuild(`${dir}/repo`, defaultBuildProbe);
      assertEquals(found?.launcher, null);
      // A plain file is no link at all.
      assertEquals(
        await defaultBuildProbe.readLink(`${dir}/repo/${CONFIG_FILE}`),
        null,
      );
    }, { prefix: "zuke-dispatch-" });
  },
});

test("runBuild hands an env to the runner on both the launcher and the Deno path", async () => {
  const seen: Array<
    [string | undefined, Readonly<Record<string, string>> | undefined]
  > = [];
  const runner = (
    _root: string,
    _args: string[],
    program?: string,
    env?: Readonly<Record<string, string>>,
  ) => {
    seen.push([program, env]);
    return Promise.resolve(0);
  };
  const env = { ZUKE_PLAIN: "1" };
  await withEnv({ [FORWARDED_ENV]: undefined }, async () => {
    await runBuild(runner, {
      root: "/r",
      frozen: false,
      build: BUILD_FILE,
      runtime: "deno",
      launcher: "/r/zuke",
      engine: null,
    }, [
      "--help",
    ], env);
    await runBuild(runner, {
      root: "/r",
      frozen: false,
      build: BUILD_FILE,
      runtime: "deno",
      launcher: null,
      engine: null,
    }, [
      "--help",
    ], env);
    await runBuild(runner, {
      root: "/r",
      frozen: false,
      build: BUILD_FILE,
      runtime: "deno",
      launcher: null,
      engine: null,
    }, [
      "--help",
    ]);
  });
  assertEquals(seen, [
    ["/r/zuke", env],
    [undefined, env],
    [undefined, undefined],
  ]);
});

test("a root whose zuke.json names its build file runs that file", async () => {
  const found = await locateBuild(
    "/repo/src",
    probe({
      present: ["/repo/zuke.json", "/repo/build.ts"],
      texts: { "/repo/zuke.json": '{ "name": "Acme", "build": "build.ts" }' },
    }),
  );
  if (found === null) throw new Error("expected a location");
  assertEquals(found.build, "build.ts");
  assertEquals(found.engine, null);
  assertEquals(buildRunArgs(found, ["ci"]), ["run", "-A", "build.ts", "ci"]);
  assertEquals(buildLabel(found), "/repo/build.ts");
  assertEquals(runningNotice(found), "zuke: running /repo/build.ts");
});

test("a zuke.json that is not JSON still means zuke.ts beside it", async () => {
  // The file's presence alone marked a project before the build field.
  const found = await locateBuild(
    "/repo",
    probe({
      present: ["/repo/zuke.json", "/repo/zuke.ts"],
      texts: { "/repo/zuke.json": "" },
    }),
  );
  assertEquals(found?.build, BUILD_FILE);
  assertEquals(found?.engine, null);
});

test("a build name that is not a plain file name is refused before anything runs", async () => {
  for (const name of ["-A.ts", "../evil.ts", "a b.ts", "build.py"]) {
    await assertRejects(
      () =>
        locateBuild(
          "/repo",
          probe({
            present: ["/repo/zuke.json"],
            texts: { "/repo/zuke.json": JSON.stringify({ build: name }) },
          }),
        ),
      Error,
      "not a plain TypeScript file name",
    );
  }
});

test("the trust gate judges the build file zuke.json names", async () => {
  const fixture = {
    present: ["/home/me/app/zuke.json", "/home/me/app/build.ts"],
    texts: { "/home/me/app/zuke.json": '{ "build": "build.ts" }' },
    uid: 1000,
  };
  const error = await refused("/home/me/app", {
    ...fixture,
    owned: {
      "/home/me/app": ownedBy(1000),
      "/home/me/app/build.ts": ownedBy(0, 0o644),
    },
  });
  assertEquals(
    error.reason,
    "/home/me/app/build.ts is owned by user 0, not you (1000)",
  );
  // A launcher written before zuke.json named a build file still runs
  // zuke.ts, so a zuke.ts someone else owns is refused as it always was.
  const stale = await refused("/home/me/app", {
    ...fixture,
    owned: {
      "/home/me/app": ownedBy(1000),
      "/home/me/app/build.ts": ownedBy(1000, 0o644),
      "/home/me/app/zuke.ts": ownedBy(0, 0o644),
      "/home/me/app/zuke": ownedBy(1000, 0o100755),
    },
  });
  assertEquals(
    stale.reason,
    "/home/me/app/zuke.ts is owned by user 0, not you (1000)",
  );
  // The root a launcher vouched for is not judged, its build file included.
  const fake = probe({
    ...fixture,
    owned: { "/home/me/app/build.ts": ownedBy(0, 0o644) },
  });
  const found = await locateBuild("/home/me/app", fake, "/home/me/app");
  assertEquals(found?.build, "build.ts");
  assertEquals(fake.asked, []);
});

test("a root missing the build file it names, with no engine, says which file", async () => {
  await assertRejects(
    () =>
      locateBuild(
        "/repo",
        probe({
          present: ["/repo/zuke.json"],
          texts: { "/repo/zuke.json": '{ "build": "build.ts" }' },
        }),
      ),
    Error,
    "/repo has no build.ts",
  );
});

test("runBuild on Node refuses a hosted build no launcher can run, rather than ask for Deno", async () => {
  const calls: string[][] = [];
  const runner = (_root: string, args: string[], program?: string) => {
    calls.push(program === undefined ? args : [program, ...args]);
    return Promise.resolve(0);
  };
  const hosted: BuildLocation = {
    root: "/repo",
    frozen: true,
    build: BUILD_FILE,
    runtime: "deno",
    launcher: null,
    engine: "1.2.0",
  };
  const err = await assertRejects(() =>
    runBuild(runner, hosted, ["ci"], undefined, undefined, "node")
  );
  assertStringIncludes(err.message, "runs on Node");
  assertStringIncludes(err.message, "download launcher");
  // With a launcher it goes there, and a build file still runs as before.
  await runBuild(
    runner,
    { ...hosted, launcher: "/repo/zuke" },
    ["ci"],
    undefined,
    undefined,
    "node",
  );
  await runBuild(
    runner,
    { ...hosted, engine: null },
    ["ci"],
    undefined,
    undefined,
    "node",
  );
  assertEquals(calls, [
    ["/repo/zuke", "ci"],
    ["run", "-A", "--frozen", BUILD_FILE, "ci"],
  ]);
});

test("runBuild runs a build file on Node as node <build>, unless a launcher or an engine runs it", async () => {
  const calls: Array<[string[], string | undefined]> = [];
  const runner = (_root: string, args: string[], program?: string) => {
    calls.push([args, program]);
    return Promise.resolve(0);
  };
  const node: BuildLocation = {
    root: "/n",
    frozen: true,
    build: "build.ts",
    runtime: "node",
    launcher: null,
    engine: null,
  };
  await withEnv({ [FORWARDED_ENV]: undefined }, async () => {
    await runBuild(runner, node, ["ci"]);
    // The project's launcher still runs it: picking a runtime is its job.
    await runBuild(runner, { ...node, launcher: "/n/zuke" }, ["ci"]);
    // A build another SDK hosts is the engine's, whatever the field says.
    await runBuild(runner, { ...node, engine: "1.2.0" }, ["ci"], undefined, {
      ...EMBEDDED,
      serves: () => true,
    });
  });
  assertEquals(calls, [
    [["build.ts", "ci"], "node"],
    [["ci"], "/n/zuke"],
    [["ci"], "/opt/zuke"],
  ]);
});

test("owesDenoSupportNotice: a Deno build its launcher does not tell, and nothing else", async () => {
  const texts = {
    "/d/zuke": `#!/usr/bin/env bash\necho "${DENO_SUPPORT_NOTICE}" >&2\n`,
    "/old/zuke": "#!/usr/bin/env bash\nexec deno run -A zuke.ts\n",
  };
  const deno: BuildLocation = {
    root: "/d",
    frozen: true,
    build: "zuke.ts",
    runtime: "deno",
    launcher: null,
    engine: null,
  };
  const owes = (location: BuildLocation) =>
    owesDenoSupportNotice(location, probe({ texts }));
  assertEquals(await owes(deno), true);
  assertEquals(await owes({ ...deno, launcher: "/d/zuke" }), false);
  assertEquals(await owes({ ...deno, launcher: "/old/zuke" }), true);
  assertEquals(await owes({ ...deno, runtime: "node" }), false);
  assertEquals(await owes({ ...deno, engine: "1.0.0" }), false);
});

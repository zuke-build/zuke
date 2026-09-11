// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  BUILD_FILE,
  type BuildProbe,
  buildRunArgs,
  defaultBuildProbe,
  defaultBuildRunner,
  locateBuild,
  LOCK_FILE,
  NO_LOCK_NOTICE,
  type Ownership,
  UntrustedBuildError,
} from "../src/dispatch.ts";
import { withTemp } from "../../core/tests/_temp.ts";

/** What a fake filesystem knows: which paths exist, and who owns what. */
interface Fixture {
  /** Paths that exist (for `exists`, the `zuke.json`/`deno.lock` probes). */
  present?: string[];
  /** Ownership answers by path; a path not listed reports `null` (absent). */
  owned?: Record<string, Ownership>;
  /** What `uid()` reports (`null`: a platform without user ids). */
  uid?: number | null;
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
  return {
    asked,
    exists: (path) => Promise.resolve(present.has(path)),
    ownership: (path) => {
      asked.push(path);
      return Promise.resolve(owned[path] ?? null);
    },
    uid: () => fixture.uid ?? null,
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

Deno.test("locateBuild finds zuke.json in the cwd itself", async () => {
  const found = await locateBuild(
    "/repo",
    probe({ present: ["/repo/zuke.json"] }),
  );
  assertEquals(found, { root: "/repo", frozen: false });
});

Deno.test("locateBuild walks up to the nearest ancestor holding zuke.json", async () => {
  // Two nested projects: the nearest one wins, so a monorepo's package-level
  // build is picked over the workspace root's.
  const found = await locateBuild(
    "/mono/packages/app/src/deep",
    probe({ present: ["/mono/zuke.json", "/mono/packages/app/zuke.json"] }),
  );
  assertEquals(found?.root, "/mono/packages/app");
});

Deno.test("locateBuild reports a lockfile beside the config as frozen", async () => {
  const found = await locateBuild(
    "/repo/src",
    probe({ present: ["/repo/zuke.json", "/repo/deno.lock"] }),
  );
  assertEquals(found, { root: "/repo", frozen: true });
  // A lockfile elsewhere on the walk does not count: only the root's does.
  const elsewhere = await locateBuild(
    "/repo/src",
    probe({ present: ["/repo/zuke.json", "/repo/src/deno.lock"] }),
  );
  assertEquals(elsewhere?.frozen, false);
});

Deno.test("locateBuild returns null when no ancestor has zuke.json", async () => {
  assertEquals(await locateBuild("/a/b/c", probe({})), null);
  // The filesystem root is probed too, then the walk stops.
  const probed: string[] = [];
  const found = await locateBuild("/a/b", {
    exists: (path) => {
      probed.push(path);
      return Promise.resolve(false);
    },
    ownership: () => Promise.resolve(null),
    uid: () => null,
  });
  assertEquals(found, null);
  assertEquals(probed, ["/a/b/zuke.json", "/a/zuke.json", "/zuke.json"]);
});

Deno.test("locateBuild accepts a Windows drive path", async () => {
  const found = await locateBuild(
    "C:\\work\\repo\\src",
    probe({ present: ["C:/work/repo/zuke.json"] }),
  );
  assertEquals(found?.root, "C:/work/repo");
  assertEquals(await locateBuild("C:\\other", probe({})), null);
});

Deno.test("the trust gate accepts a root the current user owns", async () => {
  const found = await locateBuild(
    "/home/me/app/src",
    probe({
      present: ["/home/me/app/zuke.json"],
      owned: { "/home/me/app": ownedBy(1000) },
      uid: 1000,
    }),
  );
  assertEquals(found, { root: "/home/me/app", frozen: false });
});

Deno.test("the trust gate refuses a root owned by another user", async () => {
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

Deno.test("the trust gate refuses a world-writable root even when the user owns it", async () => {
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

Deno.test("the trust gate refuses an ancestor config file Deno would read that another user owns", async () => {
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

Deno.test("the trust gate accepts ancestor config files the user owns, and asks only above the root", async () => {
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
  // never the subdirectories walked through.
  assertEquals(fake.asked, [
    "/home/me/mono/app",
    "/home/me/mono/app/zuke.json",
    "/home/me/mono/app/zuke.ts",
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
  ]);
});

Deno.test("the trust gate refuses a build file in the root that another user owns", async () => {
  // A `chown` of the directory alone passes the directory check; the files
  // that decide what runs must be the user's too.
  for (const name of ["zuke.json", "zuke.ts", "deno.lock", "deno.json"]) {
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

Deno.test("the trust gate is inert where ownership cannot be compared", async () => {
  // Windows: no user id at all — nothing is ever asked about ownership.
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

Deno.test("buildRunArgs mirrors the launcher: --frozen only with a lockfile", () => {
  assertEquals(
    buildRunArgs({ root: "/repo", frozen: true }, ["ci", "--parallel"]),
    ["run", "-A", "--frozen", BUILD_FILE, "ci", "--parallel"],
  );
  assertEquals(
    buildRunArgs({ root: "/repo", frozen: false }, ["--list", "--json"]),
    ["run", "-A", BUILD_FILE, "--list", "--json"],
  );
  // The argument list is forwarded verbatim — nothing is parsed or reordered,
  // so the build's own CLI sees exactly what the user typed.
  assertEquals(
    buildRunArgs({ root: "/repo", frozen: false }, []),
    ["run", "-A", BUILD_FILE],
  );
});

Deno.test("the no-lock notice names the lockfile", () => {
  assertEquals(NO_LOCK_NOTICE.includes(LOCK_FILE), true);
});

Deno.test("defaultBuildProbe answers from the real filesystem", async () => {
  await withTemp(async (dir) => {
    await Deno.writeTextFile(`${dir}/zuke.json`, "{}\n");
    assertEquals(await defaultBuildProbe.exists(`${dir}/zuke.json`), true);
    assertEquals(await defaultBuildProbe.exists(`${dir}/deno.lock`), false);
    // A directory this process just created is owned by this process's user
    // — or both sides are null where the platform has no ownership (Windows),
    // which is exactly the pairing the gate treats as inert.
    const own = await defaultBuildProbe.ownership(dir);
    assertEquals(own?.uid, defaultBuildProbe.uid());
    assertEquals(own?.mode === null || typeof own?.mode === "number", true);
    // Nothing there: null, not a throw — an absent ancestor config is normal.
    assertEquals(await defaultBuildProbe.ownership(`${dir}/deno.json`), null);
  }, { prefix: "zuke-dispatch-" });
});

Deno.test("defaultBuildRunner runs the given deno argv from the root and returns its code", async () => {
  await withTemp(async (dir) => {
    // A self-contained script proves the runner's contract without a build:
    // it runs from `dir` (the cwd it reports) and exits with the code we set.
    await Deno.writeTextFile(
      `${dir}/${BUILD_FILE}`,
      "await Deno.writeTextFile('probe.txt', Deno.cwd());\nDeno.exit(7);\n",
    );
    const code = await defaultBuildRunner(dir, ["run", "-A", BUILD_FILE]);
    assertEquals(code, 7);
    // The script's relative write landed in the root, i.e. cwd was `dir`.
    const seen = await Deno.readTextFile(`${dir}/probe.txt`);
    assertEquals(await Deno.realPath(seen), await Deno.realPath(dir));
  }, { prefix: "zuke-dispatch-" });
});

Deno.test("defaultBuildRunner gives the child a PATH even when the parent has none", async () => {
  const inherited = Deno.env.get("PATH");
  try {
    Deno.env.delete("PATH");
    await withTemp(async (dir) => {
      await Deno.writeTextFile(
        `${dir}/${BUILD_FILE}`,
        "await Deno.writeTextFile('path.txt', Deno.env.get('PATH') ?? '');\n",
      );
      assertEquals(await defaultBuildRunner(dir, ["run", "-A", BUILD_FILE]), 0);
      const path = await Deno.readTextFile(`${dir}/path.txt`);
      // Just the running Deno's directory: no separator, nothing else.
      const separator = Deno.build.os === "windows" ? ";" : ":";
      assertEquals(path.includes(separator), false);
      assertEquals(path.length > 0, true);
    }, { prefix: "zuke-dispatch-" });
  } finally {
    if (inherited !== undefined) Deno.env.set("PATH", inherited);
  }
});

Deno.test("defaultBuildRunner puts the running Deno first on the child's PATH", async () => {
  await withTemp(async (dir) => {
    await Deno.writeTextFile(
      `${dir}/${BUILD_FILE}`,
      "await Deno.writeTextFile('path.txt', Deno.env.get('PATH') ?? '');\n",
    );
    assertEquals(await defaultBuildRunner(dir, ["run", "-A", BUILD_FILE]), 0);
    const path = await Deno.readTextFile(`${dir}/path.txt`);
    const separator = Deno.build.os === "windows" ? ";" : ":";
    const [first, ...rest] = path.split(separator);
    const binDir = Deno.execPath().replaceAll("\\", "/").replace(
      /\/[^/]+$/,
      "",
    );
    assertEquals(first, binDir);
    // The inherited PATH follows, so nothing the user had is lost.
    const inherited = Deno.env.get("PATH") ?? "";
    assertEquals(rest.join(separator), inherited);
  }, { prefix: "zuke-dispatch-" });
});

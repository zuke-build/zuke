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
  UntrustedBuildError,
} from "../src/dispatch.ts";
import { withTemp } from "../../core/tests/_temp.ts";

/** Ownership answers for {@link probe}: the caller's uid and each path's owner. */
interface Ownership {
  /** What `uid()` reports (`null`: a platform without user ids). */
  uid: number | null;
  /** What `ownerOf(path)` reports for any path (`null`: no file ownership). */
  owner: number | null;
}

/** A probe over a fixed set of existing absolute paths, owned as `ownership` says. */
function probe(
  present: string[],
  ownership: Ownership = { uid: null, owner: null },
): BuildProbe {
  const set = new Set(present);
  return {
    exists: (path) => Promise.resolve(set.has(path)),
    ownerOf: () => Promise.resolve(ownership.owner),
    uid: () => ownership.uid,
  };
}

Deno.test("locateBuild finds zuke.json in the cwd itself", async () => {
  const found = await locateBuild("/repo", probe(["/repo/zuke.json"]), []);
  assertEquals(found, { root: "/repo", frozen: false });
});

Deno.test("locateBuild walks up to the nearest ancestor holding zuke.json", async () => {
  // Two nested projects: the nearest one wins, so a monorepo's package-level
  // build is picked over the workspace root's.
  const found = await locateBuild(
    "/mono/packages/app/src/deep",
    probe(["/mono/zuke.json", "/mono/packages/app/zuke.json"]),
    [],
  );
  assertEquals(found?.root, "/mono/packages/app");
});

Deno.test("locateBuild reports a lockfile beside the config as frozen", async () => {
  const found = await locateBuild(
    "/repo/src",
    probe(["/repo/zuke.json", "/repo/deno.lock"]),
    [],
  );
  assertEquals(found, { root: "/repo", frozen: true });
  // A lockfile elsewhere on the walk does not count: only the root's does.
  const elsewhere = await locateBuild(
    "/repo/src",
    probe(["/repo/zuke.json", "/repo/src/deno.lock"]),
    [],
  );
  assertEquals(elsewhere?.frozen, false);
});

Deno.test("locateBuild returns null when no ancestor has zuke.json", async () => {
  assertEquals(await locateBuild("/a/b/c", probe([]), []), null);
  // The filesystem root is probed too, then the walk stops.
  const probed: string[] = [];
  const found = await locateBuild("/a/b", {
    exists: (path) => {
      probed.push(path);
      return Promise.resolve(false);
    },
    ownerOf: () => Promise.resolve(null),
    uid: () => null,
  }, []);
  assertEquals(found, null);
  assertEquals(probed, ["/a/b/zuke.json", "/a/zuke.json", "/zuke.json"]);
});

Deno.test("locateBuild accepts a Windows drive path", async () => {
  const found = await locateBuild(
    "C:\\work\\repo\\src",
    probe(["C:/work/repo/zuke.json"]),
    [],
  );
  assertEquals(found?.root, "C:/work/repo");
  assertEquals(await locateBuild("C:\\other", probe([]), []), null);
});

Deno.test("locateBuild accepts a root owned by the current user", async () => {
  const found = await locateBuild(
    "/home/me/app/src",
    probe(["/home/me/app/zuke.json"], { uid: 1000, owner: 1000 }),
    ["ci"],
  );
  assertEquals(found, { root: "/home/me/app", frozen: false });
});

Deno.test("locateBuild refuses a root owned by another user, naming the way forward", async () => {
  // A `zuke.json` planted by another local user in a shared parent (`/tmp`)
  // must not have `zuke ci` below it run their `zuke.ts` with -A.
  let caught: unknown;
  try {
    await locateBuild(
      "/tmp/scratch",
      probe(["/tmp/zuke.json"], { uid: 1000, owner: 0 }),
      ["ci", "--parallel"],
    );
  } catch (error) {
    caught = error;
  }
  assertEquals(caught instanceof UntrustedBuildError, true);
  if (!(caught instanceof UntrustedBuildError)) return;
  assertEquals(caught.name, "UntrustedBuildError");
  assertEquals(caught.root, "/tmp");
  assertEquals(caught.owner, 0);
  assertEquals(caught.uid, 1000);
  assertEquals(
    caught.message.includes("owned by user 0, not you (1000)"),
    true,
  );
  // The advice names the explicit alternative: that project's own launcher,
  // with the very arguments that were forwarded.
  assertEquals(
    caught.message.includes("cd /tmp && ./zuke ci --parallel"),
    true,
  );
});

Deno.test("locateBuild's trust gate is inert where ownership cannot be compared", async () => {
  // Windows: no user id at all — the owner is never even asked for.
  let asked = 0;
  const noUid: BuildProbe = {
    exists: (path) => Promise.resolve(path === "/repo/zuke.json"),
    ownerOf: () => {
      asked++;
      return Promise.resolve(7);
    },
    uid: () => null,
  };
  assertEquals((await locateBuild("/repo", noUid, []))?.root, "/repo");
  assertEquals(asked, 0);
  // A filesystem that reports no owner for the path.
  const noOwner = probe(["/repo/zuke.json"], { uid: 1000, owner: null });
  assertEquals((await locateBuild("/repo", noOwner, []))?.root, "/repo");
});

Deno.test("locateBuild gates the root it found, not every directory on the walk", async () => {
  // Only the directory holding zuke.json is judged: the subdirectories walked
  // through are the caller's business, and are never probed for ownership.
  const owners: string[] = [];
  const found = await locateBuild("/home/me/app/src/deep", {
    exists: (path) => Promise.resolve(path === "/home/me/app/zuke.json"),
    ownerOf: (path) => {
      owners.push(path);
      return Promise.resolve(1000);
    },
    uid: () => 1000,
  }, []);
  assertEquals(found?.root, "/home/me/app");
  assertEquals(owners, ["/home/me/app"]);
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
    assertEquals(await defaultBuildProbe.ownerOf(dir), defaultBuildProbe.uid());
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

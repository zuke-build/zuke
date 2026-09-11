// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  BUILD_FILE,
  buildRunArgs,
  defaultBuildRunner,
  locateBuild,
  LOCK_FILE,
  NO_LOCK_NOTICE,
} from "../src/dispatch.ts";
import { withTemp } from "../../core/tests/_temp.ts";

/** An existence probe over a fixed set of absolute paths. */
function probe(...present: string[]): (path: string) => Promise<boolean> {
  const set = new Set(present);
  return (path) => Promise.resolve(set.has(path));
}

Deno.test("locateBuild finds zuke.json in the cwd itself", async () => {
  const found = await locateBuild("/repo", probe("/repo/zuke.json"));
  assertEquals(found, { root: "/repo", frozen: false });
});

Deno.test("locateBuild walks up to the nearest ancestor holding zuke.json", async () => {
  // Two nested projects: the nearest one wins, so a monorepo's package-level
  // build is picked over the workspace root's.
  const found = await locateBuild(
    "/mono/packages/app/src/deep",
    probe("/mono/zuke.json", "/mono/packages/app/zuke.json"),
  );
  assertEquals(found?.root, "/mono/packages/app");
});

Deno.test("locateBuild reports a lockfile beside the config as frozen", async () => {
  const found = await locateBuild(
    "/repo/src",
    probe("/repo/zuke.json", "/repo/deno.lock"),
  );
  assertEquals(found, { root: "/repo", frozen: true });
  // A lockfile elsewhere on the walk does not count: only the root's does.
  const elsewhere = await locateBuild(
    "/repo/src",
    probe("/repo/zuke.json", "/repo/src/deno.lock"),
  );
  assertEquals(elsewhere?.frozen, false);
});

Deno.test("locateBuild returns null when no ancestor has zuke.json", async () => {
  assertEquals(await locateBuild("/a/b/c", probe()), null);
  // The filesystem root is probed too, then the walk stops.
  const probed: string[] = [];
  const found = await locateBuild("/a/b", (path) => {
    probed.push(path);
    return Promise.resolve(false);
  });
  assertEquals(found, null);
  assertEquals(probed, ["/a/b/zuke.json", "/a/zuke.json", "/zuke.json"]);
});

Deno.test("locateBuild accepts a Windows drive path", async () => {
  const found = await locateBuild(
    "C:\\work\\repo\\src",
    probe("C:/work/repo/zuke.json"),
  );
  assertEquals(found?.root, "C:/work/repo");
  assertEquals(await locateBuild("C:\\other", probe()), null);
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

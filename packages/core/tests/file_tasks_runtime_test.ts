// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "./_assert.ts";
import { FileTasks } from "../src/file.ts";
import { withTemp } from "./_temp.ts";

const WINDOWS = Deno.build.os === "windows";

Deno.test("readBytes and writeBytes round-trip bytes", async () => {
  await withTemp(async (dir) => {
    const path = `${dir}/data.bin`;
    await FileTasks.writeBytes(path, new Uint8Array([0, 1, 255]));
    assertEquals([...await FileTasks.readBytes(path)], [0, 1, 255]);
  });
});

Deno.test("writeBytes with createNew refuses an existing file", async () => {
  await withTemp(async (dir) => {
    const path = `${dir}/data.bin`;
    await FileTasks.writeBytes(path, new Uint8Array([1]), (s) => s.createNew());
    await assertRejects(() =>
      FileTasks.writeBytes(path, new Uint8Array([2]), (s) => s.createNew())
    );
    assertEquals([...await FileTasks.readBytes(path)], [1]);
  });
});

Deno.test("writeText applies the mode it is given", async () => {
  await withTemp(async (dir) => {
    const path = `${dir}/secret.txt`;
    await FileTasks.writeText(path, "hidden", (s) => s.mode(0o600));
    assertEquals(await FileTasks.readText(path), "hidden");
    const info = await FileTasks.stat(path);
    assertEquals(
      info.mode === null ? null : info.mode & 0o777,
      WINDOWS ? null : 0o600,
    );
  });
});

Deno.test("stat, statSync and lstat describe a file and a link to it", async () => {
  await withTemp(async (dir) => {
    await FileTasks.writeText(`${dir}/file.txt`, "four");
    const info = await FileTasks.stat(`${dir}/file.txt`);
    assertEquals([info.isFile, info.isDirectory, info.size], [true, false, 4]);
    assertEquals(info.uid, WINDOWS ? null : Deno.uid());
    assertEquals(FileTasks.statSync(dir).isDirectory, true);
    if (WINDOWS) return; // a symlink needs a privilege a CI runner lacks
    await FileTasks.symlink("file.txt", `${dir}/link`);
    assertEquals((await FileTasks.lstat(`${dir}/link`)).isSymlink, true);
    assertEquals((await FileTasks.stat(`${dir}/link`)).isSymlink, false);
    assertEquals(
      await FileTasks.realPath(`${dir}/link`),
      await FileTasks.realPath(`${dir}/file.txt`),
    );
  });
});

Deno.test("readDirectory lists files and directories", async () => {
  await withTemp(async (dir) => {
    await FileTasks.writeText(`${dir}/a.txt`, "");
    await FileTasks.createDirectory(`${dir}/sub`);
    const entries = (await FileTasks.readDirectory(dir))
      .sort((left, right) => left.name.localeCompare(right.name));
    assertEquals(entries, [
      { name: "a.txt", isFile: true, isDirectory: false },
      { name: "sub", isFile: false, isDirectory: true },
    ]);
  });
});

Deno.test("makeTempDirectory names it with the prefix", async () => {
  const dir = await FileTasks.makeTempDirectory((s) => s.prefix("zuke-tasks-"));
  try {
    assertEquals(dir.split(/[\\/]/).at(-1)?.startsWith("zuke-tasks-"), true);
    assertEquals((await FileTasks.stat(dir)).isDirectory, true);
  } finally {
    await FileTasks.remove(dir, { recursive: true });
  }
  const plain = await FileTasks.makeTempDirectory();
  await FileTasks.remove(plain, { recursive: true });
  assertEquals(plain.split(/[\\/]/).at(-1)?.startsWith("zuke-"), true);
});

Deno.test({
  name: "chmod sets the permission bits",
  ignore: WINDOWS,
  fn: async () => {
    await withTemp(async (dir) => {
      const path = `${dir}/run.sh`;
      await FileTasks.writeText(path, "");
      await FileTasks.chmod(path, 0o755);
      assertEquals(((await FileTasks.stat(path)).mode ?? 0) & 0o777, 0o755);
    });
  },
});

Deno.test("isNotFound tells a missing path from other failures", async () => {
  await withTemp(async (dir) => {
    const missing = await FileTasks.readText(`${dir}/none`).catch((e) => e);
    assertEquals(FileTasks.isNotFound(missing), true);
    const other = await FileTasks.readText(dir).catch((e) => e);
    assertEquals(FileTasks.isNotFound(other), false);
    assertEquals(FileTasks.isNotFound("ENOENT"), false);
  });
});

Deno.test("makeTempDirectory refuses a prefix that would leave the temp root", async () => {
  for (const prefix of ["../escape-", "a/b-", "a\\b-"]) {
    await assertRejects(() =>
      FileTasks.makeTempDirectory((s) => s.prefix(prefix))
    );
  }
});

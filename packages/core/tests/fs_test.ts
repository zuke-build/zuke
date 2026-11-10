// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Parity: every operation in `fs.ts` must give the result, and throw the
 * error class, of the `Deno.*` call it replaces. While both exist under Deno
 * they are run side by side on the same inputs.
 */

import { assertEquals } from "./_assert.ts";
import {
  lstat,
  lstatSync,
  mkdirRecursive,
  readFile,
  readTextFile,
  stat,
  writeFile,
} from "../src/fs.ts";
import { withTemp } from "./_temp.ts";

/** What a failed call threw: its class name and its code. */
interface Failure {
  /** The error's class name. */
  kind: string;
  /** The error's `code`, when it has one. */
  code: unknown;
}

/** Run `call` expecting it to fail, and describe the failure. */
async function failure(call: () => unknown): Promise<Failure> {
  try {
    await call();
  } catch (error) {
    if (error instanceof Error) {
      return {
        kind: error.constructor.name,
        code: "code" in error ? error.code : undefined,
      };
    }
    throw error;
  }
  throw new Error("expected the call to fail");
}

/** The fields of Deno's file info that `FileInfo` carries. */
function shared(info: Deno.FileInfo) {
  return {
    isFile: info.isFile,
    isDirectory: info.isDirectory,
    isSymlink: info.isSymlink,
    size: info.size,
    mode: info.mode,
  };
}

Deno.test("reads return what Deno's return, as plain bytes and text", async () => {
  await withTemp(async (dir) => {
    const path = `${dir}/data.bin`;
    await Deno.writeFile(path, new Uint8Array([0, 1, 2, 250, 255]));
    const bytes = await readFile(path);
    assertEquals(bytes, await Deno.readFile(path));
    // A plain Uint8Array, not a Buffer: callers compare and hash it.
    assertEquals(bytes.constructor.name, "Uint8Array");

    await Deno.writeTextFile(`${dir}/text.txt`, "héllo\nwörld\n");
    assertEquals(
      await readTextFile(`${dir}/text.txt`),
      await Deno.readTextFile(`${dir}/text.txt`),
    );
  });
});

Deno.test("stat and lstat describe a file, a directory and a link as Deno does", async () => {
  await withTemp(async (dir) => {
    await Deno.writeTextFile(`${dir}/file`, "12345");
    await Deno.mkdir(`${dir}/sub`);
    for (const path of [`${dir}/file`, `${dir}/sub`]) {
      assertEquals(await stat(path), shared(await Deno.stat(path)));
      assertEquals(await lstat(path), shared(await Deno.lstat(path)));
      assertEquals(lstatSync(path), shared(Deno.lstatSync(path)));
    }
  });
});

Deno.test({
  name: "lstat describes a link and stat follows it, as Deno does",
  // Creating a symlink needs a privilege a Windows runner does not have.
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTemp(async (dir) => {
      await Deno.writeTextFile(`${dir}/target`, "x");
      await Deno.symlink(`${dir}/target`, `${dir}/link`);
      assertEquals(
        await lstat(`${dir}/link`),
        shared(await Deno.lstat(`${dir}/link`)),
      );
      assertEquals((await lstat(`${dir}/link`)).isSymlink, true);
      assertEquals(
        await stat(`${dir}/link`),
        shared(await Deno.stat(`${dir}/link`)),
      );
      assertEquals((await stat(`${dir}/link`)).isSymlink, false);
      assertEquals(lstatSync(`${dir}/link`).isSymlink, true);
    });
  },
});

Deno.test("mkdirRecursive creates the whole path and accepts one that exists", async () => {
  await withTemp(async (dir) => {
    await mkdirRecursive(`${dir}/a/b/c`);
    assertEquals((await Deno.stat(`${dir}/a/b/c`)).isDirectory, true);
    await mkdirRecursive(`${dir}/a/b/c`);
  });
});

Deno.test("writeFile writes bytes and text, replacing what is there", async () => {
  await withTemp(async (dir) => {
    await writeFile(`${dir}/out`, new Uint8Array([9, 8, 7]));
    assertEquals(await Deno.readFile(`${dir}/out`), new Uint8Array([9, 8, 7]));
    await writeFile(`${dir}/out`, "text now");
    assertEquals(await Deno.readTextFile(`${dir}/out`), "text now");
  });
});

Deno.test({
  name:
    "writeFile sets the mode on a new file and on one that exists, as Deno does",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTemp(async (dir) => {
      const bits = async (path: string) =>
        ((await Deno.stat(path)).mode ?? 0) & 0o777;
      for (const name of ["ours", "denos"]) {
        const write = name === "ours"
          ? (mode: number) => writeFile(`${dir}/${name}`, "x", mode)
          : (mode: number) =>
            Deno.writeTextFile(`${dir}/${name}`, "x", { mode });
        await write(0o600);
        assertEquals(await bits(`${dir}/${name}`), 0o600);
        // node:fs alone would leave an existing file's mode; Deno changes it.
        await write(0o755);
        assertEquals(await bits(`${dir}/${name}`), 0o755);
      }
    });
  },
});

Deno.test("each failure surfaces as the Deno error class it always was, keeping its code", async () => {
  await withTemp(async (dir) => {
    await Deno.writeTextFile(`${dir}/file`, "x");
    const missing = `${dir}/nope`;
    const underFile = `${dir}/file/child`;
    const pairs: Array<[string, () => unknown, () => unknown]> = [
      [
        "readFile missing",
        () => readFile(missing),
        () => Deno.readFile(missing),
      ],
      [
        "readTextFile missing",
        () => readTextFile(missing),
        () => Deno.readTextFile(missing),
      ],
      ["stat missing", () => stat(missing), () => Deno.stat(missing)],
      ["lstat missing", () => lstat(missing), () => Deno.lstat(missing)],
      [
        "lstatSync missing",
        () => lstatSync(missing),
        () => Deno.lstatSync(missing),
      ],
      [
        "readFile of a directory",
        () => readFile(dir),
        () => Deno.readFile(dir),
      ],
      ["stat under a file", () => stat(underFile), () => Deno.stat(underFile)],
      [
        "readFile under a file",
        () => readFile(underFile),
        () => Deno.readFile(underFile),
      ],
      [
        "writeFile under a file",
        () => writeFile(underFile, "x"),
        () => Deno.writeTextFile(underFile, "x"),
      ],
      [
        "writeFile into a missing directory",
        () => writeFile(`${missing}/f`, "x"),
        () => Deno.writeTextFile(`${missing}/f`, "x"),
      ],
      [
        "mkdirRecursive under a file",
        () => mkdirRecursive(underFile),
        () => Deno.mkdir(underFile, { recursive: true }),
      ],
    ];
    for (const [name, ours, denos] of pairs) {
      const [a, b] = [await failure(ours), await failure(denos)];
      assertEquals(a, b, name);
    }
    // The class is the real one, so a build's own instanceof check matches.
    const caught = await readFile(missing).catch((error: unknown) => error);
    assertEquals(caught instanceof Deno.errors.NotFound, true);
    assertEquals(
      caught instanceof Error && caught.cause instanceof Error,
      true,
    );
  });
});

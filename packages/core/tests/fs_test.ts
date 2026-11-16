// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Parity: every operation in `fs.ts` must give the result, and throw the
 * error class, of the `Deno.*` call it replaces. While both exist under Deno
 * they are run side by side on the same inputs.
 */

import { assertEquals } from "./_assert.ts";
import {
  alreadyExists,
  chmod,
  copyFile,
  lstat,
  lstatSync,
  makeTempDir,
  mkdir,
  mkdirRecursive,
  readDir,
  readFile,
  readLink,
  readTextFile,
  remove,
  rename,
  stat,
  symlink,
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

/** Run `call` and describe how it failed, or that it did not. */
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
  // Described, not thrown: on some platform both sides may well succeed.
  return { kind: "no failure", code: undefined };
}

/** One operation, through this module and through the Deno call it replaces. */
type Pair = [name: string, ours: () => unknown, theirs: () => unknown];

/**
 * Every pair whose two failures differ, each with both sides spelled out, so
 * a run on a platform nobody has at hand says what that platform does.
 */
async function mismatches(pairs: Pair[]): Promise<string[]> {
  const found: string[] = [];
  for (const [name, ours, theirs] of pairs) {
    const [a, b] = [await failure(ours), await failure(theirs)];
    if (a.kind !== b.kind || a.code !== b.code) {
      found.push(`${name}: ours ${a.kind}/${a.code}, Deno ${b.kind}/${b.code}`);
    }
  }
  return found;
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

    await Deno.writeTextFile(`${dir}/text.txt`, "π ≈ 3.14\n日本語\n");
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

Deno.test({
  name: "a symlink loop surfaces as Deno's FilesystemLoop on every operation",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTemp(async (dir) => {
      await Deno.symlink(`${dir}/b`, `${dir}/a`);
      await Deno.symlink(`${dir}/a`, `${dir}/b`);
      const loop = `${dir}/a`;
      const pairs: Pair[] = [
        ["readFile", () => readFile(loop), () => Deno.readFile(loop)],
        ["stat", () => stat(loop), () => Deno.stat(loop)],
        ["lstat", () => lstat(`${loop}/x`), () => Deno.lstat(`${loop}/x`)],
        [
          "lstatSync",
          () => lstatSync(`${loop}/x`),
          () => Deno.lstatSync(`${loop}/x`),
        ],
        [
          "writeFile",
          () => writeFile(loop, "x"),
          () => Deno.writeTextFile(loop, "x"),
        ],
        [
          "mkdirRecursive",
          () => mkdirRecursive(`${loop}/x`),
          () => Deno.mkdir(`${loop}/x`, { recursive: true }),
        ],
      ];
      assertEquals(await mismatches(pairs), []);
      assertEquals((await failure(() => stat(loop))).kind, "FilesystemLoop");
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
    // With a mode, on every platform: Windows has no permission bits and
    // ignores it, as Deno's own write does, and the contents still land.
    await writeFile(`${dir}/out`, "with a mode", 0o644);
    assertEquals(await Deno.readTextFile(`${dir}/out`), "with a mode");
    await writeFile(`${dir}/fresh`, new Uint8Array([1, 2]), 0o600);
    assertEquals(await Deno.readFile(`${dir}/fresh`), new Uint8Array([1, 2]));
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
      for (const name of ["ours", "theirs"]) {
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
    const pairs: Pair[] = [
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
    assertEquals(await mismatches(pairs), []);
    // The class is the real one, so a build's own instanceof check matches.
    const caught = await readFile(missing).catch((error: unknown) => error);
    assertEquals(caught instanceof Deno.errors.NotFound, true);
    assertEquals(
      caught instanceof Error && caught.cause instanceof Error,
      true,
    );
  });
});

Deno.test("directories are made, listed, copied into, renamed and removed as Deno does", async () => {
  await withTemp(async (dir) => {
    await mkdir(`${dir}/d`);
    await mkdir(`${dir}/d/sub`);
    await writeFile(`${dir}/d/a.txt`, "a");
    const names = (entries: { name: string; isDirectory: boolean }[]) =>
      entries.map((entry) => `${entry.name}:${entry.isDirectory}`).sort();
    assertEquals(
      names(await readDir(`${dir}/d`)),
      names(await Array.fromAsync(Deno.readDir(`${dir}/d`))),
    );
    assertEquals(names(await readDir(`${dir}/d`)), ["a.txt:false", "sub:true"]);

    await copyFile(`${dir}/d/a.txt`, `${dir}/d/b.txt`);
    await writeFile(`${dir}/d/a.txt`, "changed");
    await copyFile(`${dir}/d/a.txt`, `${dir}/d/b.txt`);
    assertEquals(await readTextFile(`${dir}/d/b.txt`), "changed");

    await rename(`${dir}/d/b.txt`, `${dir}/d/a.txt`);
    assertEquals(names(await readDir(`${dir}/d`)), ["a.txt:false", "sub:true"]);

    await remove(`${dir}/d/a.txt`, false);
    await remove(`${dir}/d/sub`, false);
    assertEquals(await readDir(`${dir}/d`), []);
    await writeFile(`${dir}/d/kept`, "x");
    await remove(`${dir}/d`, true);
    assertEquals(await failure(() => stat(`${dir}/d`)), {
      kind: "NotFound",
      code: "ENOENT",
    });
  });
});

Deno.test({
  name: "a link holds its target as given, and is removed without its target",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTemp(async (dir) => {
      await mkdir(`${dir}/real`);
      await writeFile(`${dir}/real/file`, "x");
      await symlink("real", `${dir}/link`, "dir");
      assertEquals(await readLink(`${dir}/link`), "real");
      assertEquals(
        await readLink(`${dir}/link`),
        await Deno.readLink(`${dir}/link`),
      );
      // A link to a directory is listed as a link, so a walk does not follow it.
      const listed = await readDir(dir);
      assertEquals(
        listed.find((entry) => entry.name === "link")?.isDirectory,
        false,
      );
      for (const recursive of [false, true]) {
        await remove(`${dir}/link`, recursive);
        assertEquals(await readTextFile(`${dir}/real/file`), "x");
        await symlink("real", `${dir}/link`);
      }
    });
  },
});

Deno.test("directory, copy, rename and remove failures surface as Deno's do", async () => {
  // Some of these succeed on one platform or another, and change what is on
  // disk when they do, so each side of each pair gets a tree of its own.
  const inFreshTree = async (call: (dir: string) => unknown) => {
    let result: Failure = { kind: "not run", code: undefined };
    await withTemp(async (dir) => {
      await Deno.writeTextFile(`${dir}/file`, "x");
      await Deno.mkdir(`${dir}/full/inner`, { recursive: true });
      result = await failure(() => call(dir));
    });
    return result;
  };
  const pairs = (dir: string): Pair[] => {
    const missing = `${dir}/nope`;
    const full = `${dir}/full`;
    return [
      ["mkdir existing", () => mkdir(full), () => Deno.mkdir(full)],
      [
        "mkdir without its parent",
        () => mkdir(`${missing}/x`),
        () => Deno.mkdir(`${missing}/x`),
      ],
      [
        "mkdir under a file",
        () => mkdir(`${dir}/file/x`),
        () => Deno.mkdir(`${dir}/file/x`),
      ],
      [
        "readDir missing",
        () => readDir(missing),
        () => Array.fromAsync(Deno.readDir(missing)),
      ],
      [
        "readDir of a file",
        () => readDir(`${dir}/file`),
        () => Array.fromAsync(Deno.readDir(`${dir}/file`)),
      ],
      [
        "remove missing",
        () => remove(missing, false),
        () => Deno.remove(missing),
      ],
      [
        "remove missing, recursive",
        () => remove(missing, true),
        () => Deno.remove(missing, { recursive: true }),
      ],
      [
        "remove a directory that is not empty",
        () => remove(full, false),
        () => Deno.remove(full),
      ],
      [
        "copyFile missing",
        () => copyFile(missing, `${dir}/out`),
        () => Deno.copyFile(missing, `${dir}/out`),
      ],
      [
        "copyFile into a missing directory",
        () => copyFile(`${dir}/file`, `${missing}/out`),
        () => Deno.copyFile(`${dir}/file`, `${missing}/out`),
      ],
      [
        "copyFile of a directory",
        () => copyFile(full, `${dir}/out`),
        () => Deno.copyFile(full, `${dir}/out`),
      ],
      [
        "rename missing",
        () => rename(missing, `${dir}/out`),
        () => Deno.rename(missing, `${dir}/out`),
      ],
      [
        "rename a file over a directory",
        () => rename(`${dir}/file`, full),
        () => Deno.rename(`${dir}/file`, full),
      ],
      [
        "rename a directory over a file",
        () => rename(full, `${dir}/file`),
        () => Deno.rename(full, `${dir}/file`),
      ],
      [
        "readLink missing",
        () => readLink(missing),
        () => Deno.readLink(missing),
      ],
      [
        "readLink of a file",
        () => readLink(`${dir}/file`),
        () => Deno.readLink(`${dir}/file`),
      ],
    ];
  };
  const count = pairs("").length;
  const found: string[] = [];
  for (let index = 0; index < count; index++) {
    const name = pairs("")[index][0];
    const a = await inFreshTree((dir) => pairs(dir)[index][1]());
    const b = await inFreshTree((dir) => pairs(dir)[index][2]());
    if (a.kind !== b.kind || a.code !== b.code) {
      found.push(`${name}: ours ${a.kind}/${a.code}, Deno ${b.kind}/${b.code}`);
    }
  }
  // The class is the same on every platform. On Windows two codes are not:
  // Deno gives a wrong one for the first and none at all for the second,
  // where node:fs names the failure, and that is kept.
  assertEquals(
    found,
    Deno.build.os === "windows"
      ? [
        "readDir of a file: ours NotADirectory/ENOTDIR, Deno NotADirectory/ENOENT",
        "readLink of a file: ours Error/EINVAL, Deno Error/undefined",
      ]
      : [],
  );
});

Deno.test({
  name: "a link onto a taken path fails as Deno's does",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTemp(async (dir) => {
      await Deno.writeTextFile(`${dir}/file`, "x");
      const pairs: Pair[] = [
        [
          "symlink existing",
          () => symlink("target", `${dir}/file`),
          () => Deno.symlink("target", `${dir}/file`),
        ],
        [
          "symlink into a missing directory",
          () => symlink("target", `${dir}/nope/link`),
          () => Deno.symlink("target", `${dir}/nope/link`),
        ],
      ];
      assertEquals(await mismatches(pairs), []);
    });
  },
});

Deno.test("alreadyExists is the class and code of the file system's own refusal", async () => {
  await withTemp(async (dir) => {
    const made = alreadyExists("taken");
    assertEquals(made instanceof Deno.errors.AlreadyExists, true);
    assertEquals(made.message, "taken");
    const real = await failure(() => mkdir(dir));
    assertEquals(
      { kind: made.constructor.name, code: "code" in made && made.code },
      real,
    );
  });
});

Deno.test("makeTempDir makes a new, empty directory each time, where Deno makes its own", async () => {
  const [a, b, theirs] = [
    await makeTempDir(),
    await makeTempDir(),
    await Deno.makeTempDir(),
  ];
  try {
    assertEquals(a === b, false);
    assertEquals(await readDir(a), []);
    // Beside Deno's, compared as the system resolves them.
    const parent = async (path: string) => await Deno.realPath(`${path}/..`);
    assertEquals(await parent(a), await parent(theirs));
    if (Deno.build.os !== "windows") {
      assertEquals((await stat(a)).mode, (await Deno.stat(theirs)).mode);
    }
  } finally {
    for (const dir of [a, b, theirs]) await remove(dir, true);
  }
});

Deno.test({
  name: "chmod sets the bits Deno's sets, and fails as Deno's does",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTemp(async (dir) => {
      await writeFile(`${dir}/ours`, "x", 0o600);
      await writeFile(`${dir}/theirs`, "x", 0o600);
      await chmod(`${dir}/ours`, 0o755);
      await Deno.chmod(`${dir}/theirs`, 0o755);
      assertEquals(
        (await stat(`${dir}/ours`)).mode,
        (await stat(`${dir}/theirs`)).mode,
      );
      assertEquals(
        await mismatches([[
          "chmod missing",
          () => chmod(`${dir}/nope`, 0o755),
          () => Deno.chmod(`${dir}/nope`, 0o755),
        ]]),
        [],
      );
    });
  },
});

Deno.test({
  name: "makeTempDir works without permission to read the environment",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTemp(async (dir) => {
      const module = new URL("../src/fs.ts", import.meta.url).href;
      await Deno.writeTextFile(
        `${dir}/probe.ts`,
        `import { makeTempDir, remove } from ${JSON.stringify(module)};\n` +
          `const made = await makeTempDir();\n` +
          `await remove(made, true);\n` +
          `console.log(made);\n`,
      );
      const run = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--no-config",
          "--no-prompt",
          "--allow-read",
          "--allow-write",
          `${dir}/probe.ts`,
        ],
        stderr: "piped",
      }).output();
      assertEquals(new TextDecoder().decode(run.stderr), "");
      assertEquals(
        new TextDecoder().decode(run.stdout).startsWith("/tmp/zuke-"),
        true,
      );
    });
  },
});

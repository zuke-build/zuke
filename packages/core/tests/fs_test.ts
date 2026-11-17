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
  appendTextSync,
  chmod,
  copyFile,
  createNew,
  lstat,
  lstatSync,
  makeTempDir,
  mkdir,
  mkdirRecursive,
  openFile,
  readDir,
  readFile,
  readLink,
  readSmallTextSync,
  readTextFile,
  realPath,
  realPathSync,
  remove,
  rename,
  stat,
  statSync,
  symlink,
  userId,
  writeFile,
  writeStream,
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

Deno.test("createNew makes an empty file once, and refuses a taken path as Deno does", async () => {
  await withTemp(async (dir) => {
    await createNew(`${dir}/lock`);
    assertEquals(await readFile(`${dir}/lock`), new Uint8Array());
    await Deno.mkdir(`${dir}/sub`);
    const theirs = (path: string) => async () =>
      (await Deno.open(path, { createNew: true, write: true })).close();
    const pairs: Pair[] = [
      ["a taken path", () => createNew(`${dir}/lock`), theirs(`${dir}/lock`)],
      ["a directory", () => createNew(`${dir}/sub`), theirs(`${dir}/sub`)],
      [
        "a missing directory",
        () => createNew(`${dir}/nope/lock`),
        theirs(`${dir}/nope/lock`),
      ],
    ];
    assertEquals(await mismatches(pairs), []);
    // Refused, not replaced: what was there is untouched.
    await writeFile(`${dir}/lock`, "held");
    await failure(() => createNew(`${dir}/lock`));
    assertEquals(await readTextFile(`${dir}/lock`), "held");
  });
});

Deno.test("of many callers racing to createNew one path, exactly one succeeds", async () => {
  await withTemp(async (dir) => {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 20 }, () => createNew(`${dir}/lock`)),
    );
    assertEquals(
      outcomes.filter((outcome) => outcome.status === "fulfilled").length,
      1,
    );
  });
});

Deno.test("realPath gives the path Deno's gives, and fails as Deno's does", async () => {
  await withTemp(async (dir) => {
    await Deno.mkdir(`${dir}/a/b`, { recursive: true });
    for (const path of [dir, `${dir}/a/b/..`, `${dir}/a/./b`]) {
      assertEquals(await realPath(path), await Deno.realPath(path));
    }
    assertEquals(
      await mismatches([[
        "realPath missing",
        () => realPath(`${dir}/nope`),
        () => Deno.realPath(`${dir}/nope`),
      ]]),
      [],
    );
  });
});

Deno.test({
  name: "realPath resolves a link as Deno's does",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTemp(async (dir) => {
      await Deno.mkdir(`${dir}/real`);
      await Deno.symlink(`${dir}/real`, `${dir}/link`);
      assertEquals(
        await realPath(`${dir}/link`),
        await Deno.realPath(`${dir}/link`),
      );
      assertEquals(
        await realPath(`${dir}/link`),
        await realPath(`${dir}/real`),
      );
    });
  },
});

/** Everything a stream yields, as one array. */
async function drained(
  stream: ReadableStream<Uint8Array<ArrayBuffer>>,
): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A stream of `chunks`, then an error if `failure` is given. */
function chunked(
  chunks: Uint8Array<ArrayBuffer>[],
  failure?: Error,
): ReadableStream<Uint8Array<ArrayBuffer>> {
  let next = 0;
  return new ReadableStream({
    pull(controller) {
      if (next < chunks.length) return controller.enqueue(chunks[next++]);
      if (failure !== undefined) return controller.error(failure);
      controller.close();
    },
  });
}

Deno.test("openFile streams the bytes Deno's open does, with the owner and mode of its stat", async () => {
  await withTemp(async (dir) => {
    // Larger than one read, and not a multiple of it, so chunks are joined.
    const bytes = new Uint8Array(200_001).map((_, index) => index % 251);
    await Deno.writeFile(`${dir}/big`, bytes);
    await Deno.writeFile(`${dir}/empty`, new Uint8Array());
    for (const name of ["big", "empty"]) {
      const ours = await openFile(`${dir}/${name}`);
      using theirs = await Deno.open(`${dir}/${name}`);
      const info = await theirs.stat();
      assertEquals(ours.mode, info.mode);
      // Windows has no owner: Deno reports none, node:fs zero.
      assertEquals(ours.uid, info.uid ?? 0);
      assertEquals(
        await drained(ours.readable),
        await Deno.readFile(`${dir}/${name}`),
      );
    }
  });
});

Deno.test("openFile closes the file when it is closed unread or its stream is cancelled", async () => {
  await withTemp(async (dir) => {
    await Deno.writeFile(`${dir}/file`, new Uint8Array(100_000));
    // The test runner fails a test that leaves a file open.
    await (await openFile(`${dir}/file`)).close();
    const reader = (await openFile(`${dir}/file`)).readable.getReader();
    await reader.read();
    await reader.cancel();
  });
});

Deno.test("openFile fails as Deno's open does", async () => {
  await withTemp(async (dir) => {
    const theirs = (path: string) => async () =>
      (await Deno.open(path)).close();
    assertEquals(
      await mismatches([
        ["missing", () => openFile(`${dir}/nope`), theirs(`${dir}/nope`)],
        [
          "under a missing directory",
          () => openFile(`${dir}/nope/file`),
          theirs(`${dir}/nope/file`),
        ],
      ]),
      [],
    );
  });
});

Deno.test("writeStream writes every chunk in order, replacing what is there, as Deno's does", async () => {
  await withTemp(async (dir) => {
    const chunks = () => [
      new Uint8Array([1, 2, 3]),
      new Uint8Array(),
      new Uint8Array(70_000).fill(7),
      new Uint8Array([9]),
    ];
    await writeFile(`${dir}/ours`, "something longer than nothing");
    await writeStream(`${dir}/ours`, chunked(chunks()));
    await Deno.writeFile(`${dir}/theirs`, chunked(chunks()));
    assertEquals(
      await Deno.readFile(`${dir}/ours`),
      await Deno.readFile(`${dir}/theirs`),
    );
    await writeStream(`${dir}/ours`, chunked([]));
    assertEquals(await Deno.readFile(`${dir}/ours`), new Uint8Array());
  });
});

Deno.test("writeStream fails with the stream's own error, and with Deno's for a path it cannot open", async () => {
  await withTemp(async (dir) => {
    const reset = new Error("connection reset");
    const thrown = await writeStream(
      `${dir}/partial`,
      chunked([new Uint8Array([1])], reset),
    ).catch((error: unknown) => error);
    assertEquals(thrown, reset);

    let cancelled = false;
    const unread = () =>
      new ReadableStream<Uint8Array<ArrayBuffer>>({
        cancel() {
          cancelled = true;
        },
      });
    assertEquals(
      await mismatches([[
        "into a missing directory",
        () => writeStream(`${dir}/nope/file`, unread()),
        () => Deno.writeFile(`${dir}/nope/file`, unread()),
      ]]),
      [],
    );
    assertEquals(cancelled, false);
  });
});

Deno.test("userId is the id Deno gives", () => {
  assertEquals(userId(), Deno.uid());
});

Deno.test("the calls that do not wait give what Deno's give, and fail the same way", async () => {
  await withTemp(async (dir) => {
    await Deno.writeTextFile(`${dir}/file`, "12345");
    for (const path of [dir, `${dir}/file`]) {
      assertEquals(statSync(path), shared(Deno.statSync(path)));
      assertEquals(
        realPathSync(path),
        Deno.realPathSync(path),
      );
    }
    const missing = `${dir}/nope`;
    assertEquals(
      await mismatches([
        [
          "statSync missing",
          () => statSync(missing),
          () => Deno.statSync(missing),
        ],
        [
          "realPathSync missing",
          () => realPathSync(missing),
          () => Deno.realPathSync(missing),
        ],
        [
          "appendTextSync into a missing directory",
          () => appendTextSync(`${missing}/log`, "x"),
          () => Deno.writeTextFileSync(`${missing}/log`, "x", { append: true }),
        ],
      ]),
      [],
    );
  });
});

Deno.test("appendTextSync creates the file, then adds to its end, as Deno's append does", async () => {
  await withTemp(async (dir) => {
    for (const text of ["first\n", "second\n"]) {
      appendTextSync(`${dir}/ours`, text);
      Deno.writeTextFileSync(`${dir}/theirs`, text, { append: true });
    }
    assertEquals(await readTextFile(`${dir}/ours`), "first\nsecond\n");
    assertEquals(
      await readTextFile(`${dir}/ours`),
      await readTextFile(`${dir}/theirs`),
    );
  });
});

Deno.test({
  name: "appendTextSync leaves a file's mode alone, and makes one with Deno's",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTemp(async (dir) => {
      appendTextSync(`${dir}/ours`, "x");
      Deno.writeTextFileSync(`${dir}/theirs`, "x", { append: true });
      assertEquals(
        (await stat(`${dir}/ours`)).mode,
        (await stat(`${dir}/theirs`)).mode,
      );
      // A summary someone made private stays private.
      await writeFile(`${dir}/private`, "", 0o600);
      appendTextSync(`${dir}/private`, "x");
      assertEquals((await stat(`${dir}/private`)).mode & 0o777, 0o600);
    });
  },
});

Deno.test("readSmallTextSync reads a file within the limit, and nothing else", async () => {
  await withTemp(async (dir) => {
    await writeFile(`${dir}/small`, "12345");
    assertEquals(readSmallTextSync(`${dir}/small`, 5), "12345");
    assertEquals(readSmallTextSync(`${dir}/small`, 4), null);
    assertEquals(readSmallTextSync(`${dir}/nope`, 100), null);
    // A directory is not opened, whatever the limit.
    assertEquals(readSmallTextSync(dir, 1_000_000), null);
  });
});

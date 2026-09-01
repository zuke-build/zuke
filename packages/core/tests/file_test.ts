// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects, assertThrows } from "./_assert.ts";
import { FileTasks } from "../src/file.ts";
import { withTemp } from "./_temp.ts";

/** Run `fn` with HOME/USERPROFILE set to `values`, restoring them afterwards. */
function withHomeEnv(
  values: { HOME?: string; USERPROFILE?: string },
  fn: () => void,
): void {
  const saved = {
    HOME: Deno.env.get("HOME"),
    USERPROFILE: Deno.env.get("USERPROFILE"),
  };
  const apply = (name: "HOME" | "USERPROFILE", value: string | undefined) =>
    value === undefined ? Deno.env.delete(name) : Deno.env.set(name, value);
  try {
    apply("HOME", values.HOME);
    apply("USERPROFILE", values.USERPROFILE);
    fn();
  } finally {
    apply("HOME", saved.HOME);
    apply("USERPROFILE", saved.USERPROFILE);
  }
}

Deno.test("homeDirectory reads HOME, then USERPROFILE, else throws", () => {
  withHomeEnv({ HOME: "/home/zuke" }, () => {
    assertEquals(FileTasks.homeDirectory(), "/home/zuke");
  });
  // Falls back to USERPROFILE when HOME is unset (Windows).
  withHomeEnv({ HOME: undefined, USERPROFILE: "C:\\Users\\zuke" }, () => {
    assertEquals(FileTasks.homeDirectory(), "C:\\Users\\zuke");
  });
  // Neither set: a clear failure rather than an undefined path.
  withHomeEnv({ HOME: undefined, USERPROFILE: undefined }, () => {
    assertThrows(() => FileTasks.homeDirectory(), Error, "home directory");
  });
});

Deno.test("exists reports presence and absence", async () => {
  await withTemp(async (dir) => {
    assertEquals(await FileTasks.exists(dir), true);
    assertEquals(await FileTasks.exists(`${dir}/missing`), false);
  });
});

Deno.test("createDirectory makes nested dirs and is idempotent", async () => {
  await withTemp(async (dir) => {
    await FileTasks.createDirectory(`${dir}/a/b/c`);
    assertEquals(await FileTasks.exists(`${dir}/a/b/c`), true);
    // Recursive create over an existing path is a no-op, not an error.
    await FileTasks.createDirectory(`${dir}/a/b/c`);
  });
});

Deno.test("createDirectory without recursive fails on a missing parent", async () => {
  await withTemp(async (dir) => {
    await assertRejects(() =>
      FileTasks.createDirectory(`${dir}/x/y`, { recursive: false })
    );
  });
});

Deno.test("cleanDirectory empties contents but keeps the directory", async () => {
  await withTemp(async (dir) => {
    const target = `${dir}/build`;
    await Deno.mkdir(`${target}/nested`, { recursive: true });
    await Deno.writeTextFile(`${target}/file.txt`, "x");
    await Deno.writeTextFile(`${target}/nested/deep.txt`, "y");
    await FileTasks.cleanDirectory(target);
    assertEquals(await FileTasks.exists(target), true);
    const left = [];
    for await (const e of Deno.readDir(target)) left.push(e.name);
    assertEquals(left, []);
  });
});

Deno.test("cleanDirectory is a no-op for a missing directory", async () => {
  await withTemp(async (dir) => {
    await FileTasks.cleanDirectory(`${dir}/never`);
    assertEquals(await FileTasks.exists(`${dir}/never`), false);
  });
});

Deno.test("cleanDirectory rethrows non-NotFound errors", async () => {
  await withTemp(async (dir) => {
    const file = `${dir}/a-file`;
    await Deno.writeTextFile(file, "x");
    // readDir on a file is not a NotFound error, so it must propagate.
    await assertRejects(() => FileTasks.cleanDirectory(file));
  });
});

Deno.test("remove deletes and reports, tolerating a missing target", async () => {
  await withTemp(async (dir) => {
    const file = `${dir}/note.txt`;
    await Deno.writeTextFile(file, "x");
    assertEquals(await FileTasks.remove(file), true);
    assertEquals(await FileTasks.remove(file), false);

    const tree = `${dir}/tree`;
    await Deno.mkdir(`${tree}/sub`, { recursive: true });
    assertEquals(await FileTasks.remove(tree, { recursive: true }), true);
  });
});

Deno.test("remove rethrows non-NotFound errors", async () => {
  await withTemp(async (dir) => {
    await Deno.mkdir(`${dir}/full`);
    await Deno.writeTextFile(`${dir}/full/a.txt`, "a");
    // Removing a non-empty directory without recursive is not NotFound.
    await assertRejects(() => FileTasks.remove(`${dir}/full`));
  });
});

Deno.test("copy duplicates a single file", async () => {
  await withTemp(async (dir) => {
    await Deno.writeTextFile(`${dir}/src.txt`, "hello");
    await FileTasks.copy(`${dir}/src.txt`, `${dir}/dst.txt`);
    assertEquals(await Deno.readTextFile(`${dir}/dst.txt`), "hello");
  });
});

Deno.test("copy recurses through a directory tree", async () => {
  await withTemp(async (dir) => {
    await Deno.mkdir(`${dir}/src/inner`, { recursive: true });
    await Deno.writeTextFile(`${dir}/src/top.txt`, "t");
    await Deno.writeTextFile(`${dir}/src/inner/deep.txt`, "d");
    await FileTasks.copy(`${dir}/src`, `${dir}/out`);
    assertEquals(await Deno.readTextFile(`${dir}/out/top.txt`), "t");
    assertEquals(await Deno.readTextFile(`${dir}/out/inner/deep.txt`), "d");
  });
});

Deno.test("copy with overwrite false refuses an existing destination", async () => {
  await withTemp(async (dir) => {
    await Deno.writeTextFile(`${dir}/a.txt`, "a");
    await Deno.writeTextFile(`${dir}/b.txt`, "b");
    await assertRejects(
      () =>
        FileTasks.copy(`${dir}/a.txt`, `${dir}/b.txt`, { overwrite: false }),
      Deno.errors.AlreadyExists,
    );
    // Default overwrite replaces it.
    await FileTasks.copy(`${dir}/a.txt`, `${dir}/b.txt`);
    assertEquals(await Deno.readTextFile(`${dir}/b.txt`), "a");
  });
});

Deno.test("move renames a path", async () => {
  await withTemp(async (dir) => {
    await Deno.writeTextFile(`${dir}/from.txt`, "m");
    await FileTasks.move(`${dir}/from.txt`, `${dir}/to.txt`);
    assertEquals(await FileTasks.exists(`${dir}/from.txt`), false);
    assertEquals(await Deno.readTextFile(`${dir}/to.txt`), "m");
  });
});

Deno.test("readText and writeText round-trip", async () => {
  await withTemp(async (dir) => {
    await FileTasks.writeText(`${dir}/t.txt`, "round-trip");
    assertEquals(await FileTasks.readText(`${dir}/t.txt`), "round-trip");
  });
});

Deno.test("readJson parses a JSON file", async () => {
  await withTemp(async (dir) => {
    await Deno.writeTextFile(
      `${dir}/d.json`,
      JSON.stringify({ version: "1.0" }),
    );
    const parsed = await FileTasks.readJson<{ version: string }>(
      `${dir}/d.json`,
    );
    assertEquals(parsed.version, "1.0");
  });
});

// Creating a symlink is a privileged operation on Windows unless Developer
// Mode is on, so the link tests are POSIX-only — the same line the tar
// extractor's symlink tests draw.
const SYMLINKS_UNPRIVILEGED = Deno.build.os !== "windows";

Deno.test({
  name: "symlink creates a link readLink reads back verbatim",
  ignore: !SYMLINKS_UNPRIVILEGED,
  fn: async () => {
    await withTemp(async (dir) => {
      await Deno.writeTextFile(`${dir}/real.txt`, "linked");
      await FileTasks.symlink(`${dir}/real.txt`, `${dir}/link.txt`);
      assertEquals(await FileTasks.readText(`${dir}/link.txt`), "linked");
      assertEquals(
        await FileTasks.readLink(`${dir}/link.txt`),
        `${dir}/real.txt`,
      );
    });
  },
});

Deno.test({
  name: "symlink stores a relative target as given, not resolved",
  ignore: !SYMLINKS_UNPRIVILEGED,
  fn: async () => {
    // The relative target is what makes a link between sibling checkouts
    // survive both being moved together, so it must not be rewritten.
    await withTemp(async (dir) => {
      await Deno.mkdir(`${dir}/group`);
      await Deno.writeTextFile(`${dir}/real.txt`, "sibling");
      await FileTasks.symlink("../real.txt", `${dir}/group/link.txt`);
      assertEquals(
        await FileTasks.readLink(`${dir}/group/link.txt`),
        "../real.txt",
      );
      assertEquals(
        await FileTasks.readText(`${dir}/group/link.txt`),
        "sibling",
      );
    });
  },
});

Deno.test({
  name:
    "symlink without force refuses an occupied path, with force replaces it",
  ignore: !SYMLINKS_UNPRIVILEGED,
  fn: async () => {
    await withTemp(async (dir) => {
      await Deno.writeTextFile(`${dir}/one.txt`, "one");
      await Deno.writeTextFile(`${dir}/two.txt`, "two");
      await FileTasks.symlink(`${dir}/one.txt`, `${dir}/link.txt`);
      await assertRejects(
        () => FileTasks.symlink(`${dir}/two.txt`, `${dir}/link.txt`),
        Deno.errors.AlreadyExists,
      );
      assertEquals(
        await FileTasks.readLink(`${dir}/link.txt`),
        `${dir}/one.txt`,
      );

      // The `ln -sfn` case: re-pointing an existing link is what makes a
      // link-creating target re-runnable.
      await FileTasks.symlink(`${dir}/two.txt`, `${dir}/link.txt`, {
        force: true,
      });
      assertEquals(
        await FileTasks.readLink(`${dir}/link.txt`),
        `${dir}/two.txt`,
      );
      assertEquals(await FileTasks.readText(`${dir}/link.txt`), "two");
    });
  },
});

Deno.test({
  name: "force replaces a regular file, but never a directory",
  ignore: !SYMLINKS_UNPRIVILEGED,
  fn: async () => {
    await withTemp(async (dir) => {
      await Deno.writeTextFile(`${dir}/target.txt`, "t");
      await Deno.writeTextFile(`${dir}/occupied`, "a plain file");
      await FileTasks.symlink(`${dir}/target.txt`, `${dir}/occupied`, {
        force: true,
      });
      assertEquals(
        await FileTasks.readLink(`${dir}/occupied`),
        `${dir}/target.txt`,
      );

      // A directory is reported, not removed — empty or not. force replaces a
      // link or a file; losing a directory to a link request is not a thing a
      // build should do quietly, and the atomic rename refuses it outright.
      await Deno.mkdir(`${dir}/tree`);
      await Deno.writeTextFile(`${dir}/tree/kept.txt`, "kept");
      await assertRejects(() =>
        FileTasks.symlink(`${dir}/target.txt`, `${dir}/tree`, { force: true })
      );
      assertEquals(await FileTasks.readText(`${dir}/tree/kept.txt`), "kept");

      await Deno.mkdir(`${dir}/bare`);
      await assertRejects(() =>
        FileTasks.symlink(`${dir}/target.txt`, `${dir}/bare`, { force: true })
      );
      assertEquals((await Deno.lstat(`${dir}/bare`)).isDirectory, true);

      // A refused publish leaves nothing behind: the link written under a temp
      // name is taken back out before the failure is reported.
      const leftovers: string[] = [];
      for await (const entry of Deno.readDir(dir)) {
        if (entry.name.includes(".zuke-symlink-")) leftovers.push(entry.name);
      }
      assertEquals(leftovers, []);
    });
  },
});

Deno.test({
  name: "a forced replacement never leaves the path missing",
  ignore: !SYMLINKS_UNPRIVILEGED,
  fn: async () => {
    // The reason the replacement is a rename rather than an unlink-then-link:
    // a reader racing the swap must see one link or the other, never a gap.
    // Reading between every replacement is as close as an in-process test gets
    // to that, and it would catch a regression to unlink-first immediately.
    await withTemp(async (dir) => {
      await Deno.writeTextFile(`${dir}/one.txt`, "one");
      await Deno.writeTextFile(`${dir}/two.txt`, "two");
      await FileTasks.symlink(`${dir}/one.txt`, `${dir}/link.txt`);
      const seen: string[] = [];
      for (let i = 0; i < 5; i++) {
        const target = i % 2 === 0 ? "two.txt" : "one.txt";
        await FileTasks.symlink(`${dir}/${target}`, `${dir}/link.txt`, {
          force: true,
        });
        seen.push(await FileTasks.readText(`${dir}/link.txt`));
      }
      assertEquals(seen, ["two", "one", "two", "one", "two"]);
    });
  },
});

Deno.test({
  name: "a directory link takes type dir, and force re-points it",
  ignore: !SYMLINKS_UNPRIVILEGED,
  fn: async () => {
    await withTemp(async (dir) => {
      await Deno.mkdir(`${dir}/first`);
      await Deno.mkdir(`${dir}/second`);
      await Deno.writeTextFile(`${dir}/second/inside.txt`, "in");
      await FileTasks.symlink(`${dir}/first`, `${dir}/link`, { type: "dir" });
      await FileTasks.symlink(`${dir}/second`, `${dir}/link`, {
        type: "dir",
        force: true,
      });
      assertEquals(await FileTasks.readText(`${dir}/link/inside.txt`), "in");
    });
  },
});

Deno.test({
  name: "readLink refuses a path that is not a link",
  ignore: !SYMLINKS_UNPRIVILEGED,
  fn: async () => {
    await withTemp(async (dir) => {
      await Deno.writeTextFile(`${dir}/plain.txt`, "p");
      await assertRejects(() => FileTasks.readLink(`${dir}/plain.txt`));
    });
  },
});

Deno.test({
  name: "symlink surfaces a failure that is not an occupied path",
  ignore: !SYMLINKS_UNPRIVILEGED,
  fn: async () => {
    // A missing parent directory is a NotFound, which force has no business
    // swallowing — the caller asked for a link somewhere that does not exist.
    await withTemp(async (dir) => {
      await assertRejects(
        () =>
          FileTasks.symlink(`${dir}/t.txt`, `${dir}/absent/link.txt`, {
            force: true,
          }),
        Deno.errors.NotFound,
      );
    });
  },
});

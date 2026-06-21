import { assertEquals, assertRejects } from "./_assert.ts";
import { FileTasks } from "../src/file.ts";

/** Run `fn` against a fresh temp directory, cleaned up afterwards. */
async function withTemp(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

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

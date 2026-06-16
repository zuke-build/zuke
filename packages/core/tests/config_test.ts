import { assertEquals, assertThrows } from "./_assert.ts";
import {
  CONFIG_FILE,
  findConfigDir,
  pathExists,
  repoRoot,
  repoRootFrom,
} from "../src/config.ts";

Deno.test("findConfigDir returns the directory holding zuke.json", () => {
  const dir = findConfigDir(
    "/a/b/c",
    (p) => p === `/a/b/c/${CONFIG_FILE}`,
  );
  assertEquals(dir, "/a/b/c");
});

Deno.test("findConfigDir walks up to an ancestor", () => {
  const dir = findConfigDir("/a/b/c", (p) => p === `/a/${CONFIG_FILE}`);
  assertEquals(dir, "/a");
});

Deno.test("findConfigDir returns null when nothing is found", () => {
  assertEquals(findConfigDir("/a/b", () => false), null);
});

Deno.test("repoRootFrom resolves the root and joins segments", () => {
  const exists = (p: string) => p === `/proj/${CONFIG_FILE}`;
  assertEquals(repoRootFrom("/proj/pkg", exists, []).path, "/proj");
  assertEquals(
    repoRootFrom("/proj/pkg", exists, ["src", "main.ts"]).path,
    "/proj/src/main.ts",
  );
});

Deno.test("repoRootFrom throws a helpful error when not found", () => {
  assertThrows(
    () => repoRootFrom("/x", () => false, []),
    Error,
    "could not find zuke.json",
  );
});

Deno.test("pathExists reports existence and rethrows other errors", async () => {
  const file = await Deno.makeTempFile();
  try {
    assertEquals(pathExists(file), true);
    assertEquals(pathExists(`${file}-missing`), false);
    if (Deno.build.os !== "windows") {
      // Treating a file as a directory yields NotADirectory, not NotFound.
      assertThrows(() => pathExists(`${file}/child`));
    }
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("repoRoot resolves from the current working directory", async () => {
  const dir = await Deno.makeTempDir();
  const original = Deno.cwd();
  try {
    await Deno.writeTextFile(`${dir}/${CONFIG_FILE}`, "{}\n");
    Deno.chdir(dir);
    const here = Deno.cwd();
    assertEquals(repoRoot().path, here);
    assertEquals(repoRoot("src", "x.ts").path, `${here}/src/x.ts`);
  } finally {
    Deno.chdir(original);
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("repoRoot throws when no config exists above the cwd", async () => {
  const dir = await Deno.makeTempDir();
  const original = Deno.cwd();
  try {
    Deno.chdir(dir);
    assertThrows(() => repoRoot(), Error, "could not find zuke.json");
  } finally {
    Deno.chdir(original);
    await Deno.remove(dir, { recursive: true });
  }
});

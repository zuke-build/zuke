import { assertEquals } from "./_assert.ts";
import { glob, globToRegExp } from "../src/glob.ts";

Deno.test("globToRegExp compiles the supported syntax", () => {
  assertEquals(globToRegExp("*.ts").test("mod.ts"), true);
  assertEquals(globToRegExp("*.ts").test("a/mod.ts"), false); // * stops at /
  assertEquals(globToRegExp("src/**/*.ts").test("src/a/b/mod.ts"), true);
  assertEquals(globToRegExp("src/**/*.ts").test("src/mod.ts"), true); // **/ optional
  assertEquals(globToRegExp("a/**").test("a/b/c"), true); // ** spans /
  assertEquals(globToRegExp("?.ts").test("a.ts"), true);
  assertEquals(globToRegExp("?.ts").test("ab.ts"), false);
  assertEquals(globToRegExp("{a,b}.ts").test("a.ts"), true);
  assertEquals(globToRegExp("{a,b}.ts").test("b.ts"), true);
  assertEquals(globToRegExp("{a,b}.ts").test("c.ts"), false);
});

Deno.test("globToRegExp escapes regex metacharacters and unclosed braces", () => {
  assertEquals(globToRegExp("a.b+c").test("a.b+c"), true);
  assertEquals(globToRegExp("a.b+c").test("a-b-c"), false); // . and + are literal
  // An unclosed brace is matched literally.
  assertEquals(globToRegExp("a{b").test("a{b"), true);
});

Deno.test("glob expands patterns against a directory tree", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/src/sub`, { recursive: true });
    await Deno.writeTextFile(`${dir}/src/a.ts`, "");
    await Deno.writeTextFile(`${dir}/src/b.js`, "");
    await Deno.writeTextFile(`${dir}/src/sub/c.ts`, "");
    await Deno.writeTextFile(`${dir}/top.ts`, "");

    assertEquals(await glob("src/**/*.ts", { cwd: dir }), [
      "src/a.ts",
      "src/sub/c.ts",
    ]);
    assertEquals(await glob("src/*.ts", { cwd: dir }), ["src/a.ts"]);
    assertEquals(await glob("*.ts", { cwd: dir }), ["top.ts"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("glob with no static base walks from cwd; missing base yields nothing", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/pkg`);
    await Deno.writeTextFile(`${dir}/pkg/x.ts`, "");
    // A leading glob segment forces a walk from the root.
    assertEquals(await glob("**/*.ts", { cwd: dir }), ["pkg/x.ts"]);
    // A non-existent static base simply matches nothing.
    assertEquals(await glob("missing/**/*.ts", { cwd: dir }), []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("glob defaults cwd to Deno.cwd()", async () => {
  const original = Deno.cwd();
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/only.ts`, "");
    Deno.chdir(dir);
    assertEquals(await glob("*.ts"), ["only.ts"]);
  } finally {
    Deno.chdir(original);
    await Deno.remove(dir, { recursive: true });
  }
});

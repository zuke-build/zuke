import { assertEquals, assertThrows } from "./_assert.ts";
import { absolutePath } from "../src/path.ts";
import { tokenize } from "../src/shell.ts";

Deno.test("joins segments via call and .join, and normalises", () => {
  const root = absolutePath("/app");
  assertEquals(root("src", "main.ts").path, "/app/src/main.ts");
  assertEquals(root.join("src", "main.ts").path, "/app/src/main.ts");
  assertEquals(root("src")("main.ts").path, "/app/src/main.ts");
  // `.` and `..` resolve; duplicate and trailing slashes collapse.
  assertEquals(absolutePath("/app/./src/").path, "/app/src");
  assertEquals(absolutePath("/app/lib", "..", "src").path, "/app/src");
  assertEquals(absolutePath("/a//b///c").path, "/a/b/c");
});

Deno.test("preserves a Windows drive root and normalises backslashes", () => {
  assertEquals(absolutePath("C:\\repo", "x").path, "C:/repo/x");
  assertEquals(absolutePath("C:").path, "C:/");
  assertEquals(absolutePath("C:/repo").isRoot, false);
});

Deno.test("rejects a relative base", () => {
  assertThrows(
    () => absolutePath("src/main.ts"),
    Error,
    "expected an absolute path",
  );
  assertThrows(() => absolutePath(".."), Error, "expected an absolute path");
});

Deno.test("name, stem, and extension", () => {
  const f = absolutePath("/app/src/main.ts");
  assertEquals(f.name, "main.ts");
  assertEquals(f.stem, "main");
  assertEquals(f.extension, ".ts");

  const archive = absolutePath("/d/archive.tar.gz");
  assertEquals(archive.stem, "archive.tar");
  assertEquals(archive.extension, ".gz");

  const dotfile = absolutePath("/home/.gitignore");
  assertEquals(dotfile.extension, ""); // leading dot is not an extension
  assertEquals(dotfile.stem, ".gitignore");

  const binary = absolutePath("/usr/bin/deno");
  assertEquals(binary.extension, "");
  assertEquals(binary.stem, "deno");
});

Deno.test("root has empty name and is its own parent", () => {
  const root = absolutePath("/");
  assertEquals(root.isRoot, true);
  assertEquals(root.name, "");
  assertEquals(root.stem, "");
  assertEquals(root.extension, "");
  assertEquals(root.parent().path, "/");
  // climbing above the root is a no-op
  assertEquals(absolutePath("/..").path, "/");
  assertEquals(absolutePath("/a/../..").path, "/");
});

Deno.test("parent walks up the tree", () => {
  assertEquals(absolutePath("/app/src/main.ts").parent().path, "/app/src");
  assertEquals(absolutePath("/app").parent().path, "/");
  assertEquals(absolutePath("/app").parent().isRoot, true);
});

Deno.test("relativeTo computes descendant, ancestor, and sibling paths", () => {
  const base = absolutePath("/app");
  assertEquals(
    absolutePath("/app/src/main.ts").relativeTo(base),
    "src/main.ts",
  );
  assertEquals(absolutePath("/app").relativeTo(base), ".");
  assertEquals(
    absolutePath("/app/a").relativeTo(absolutePath("/app/b/c")),
    "../../a",
  );
  // accepts a plain string base too
  assertEquals(absolutePath("/app/x").relativeTo("/app"), "x");
});

Deno.test("relativeTo rejects mismatched roots", () => {
  assertThrows(
    () => absolutePath("/app").relativeTo("C:/app"),
    Error,
    "different roots",
  );
});

Deno.test("equals normalises both sides and accepts strings or paths", () => {
  const f = absolutePath("/app/src");
  assertEquals(f.equals("/app/lib/../src"), true);
  assertEquals(f.equals(absolutePath("/app/src")), true);
  assertEquals(f.equals("/app/other"), false);
  // normalisation also covers relative inputs (which never match an absolute)
  assertEquals(f.equals("../../x"), false);
});

Deno.test("toString lets a path interpolate into the $ tokenizer", () => {
  const f = absolutePath("/app/src/main.ts");
  assertEquals(`${f}`, "/app/src/main.ts");
  assertEquals(String(f), "/app/src/main.ts");
  // discrete argv entry — never re-split, even with an array of paths
  assertEquals(tokenize(["deno run ", ""], [f]), [
    "deno",
    "run",
    "/app/src/main.ts",
  ]);
  assertEquals(
    tokenize(["fmt ", ""], [[absolutePath("/a"), absolutePath("/b")]]),
    ["fmt", "/a", "/b"],
  );
});

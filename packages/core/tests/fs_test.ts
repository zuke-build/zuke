import { assertEquals, assertRejects } from "./_assert.ts";
import { remove } from "../src/fs.ts";

Deno.test("remove deletes an existing file and reports true", async () => {
  const dir = await Deno.makeTempDir();
  const file = `${dir}/note.txt`;
  await Deno.writeTextFile(file, "x");
  assertEquals(await remove(file), true);
  assertEquals(await remove(file), false); // already gone
  await Deno.remove(dir, { recursive: true });
});

Deno.test("remove on a missing path resolves to false", async () => {
  const dir = await Deno.makeTempDir();
  assertEquals(await remove(`${dir}/nope`), false);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("remove recursively clears a directory tree", async () => {
  const dir = await Deno.makeTempDir();
  const tree = `${dir}/dist`;
  await Deno.mkdir(`${tree}/nested`, { recursive: true });
  await Deno.writeTextFile(`${tree}/nested/a.txt`, "a");
  assertEquals(await remove(tree, { recursive: true }), true);
  assertEquals(await remove(tree, { recursive: true }), false);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("remove rethrows non-NotFound errors", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.mkdir(`${dir}/full`);
  await Deno.writeTextFile(`${dir}/full/a.txt`, "a");
  // Removing a non-empty directory without `recursive` is not a NotFound error,
  // so it must propagate rather than be swallowed as a no-op.
  await assertRejects(() => remove(`${dir}/full`));
  await Deno.remove(dir, { recursive: true });
});

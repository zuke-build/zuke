import { assertEquals, assertRejects } from "./_assert.ts";
import { $, CommandError, tokenize } from "../src/shell.ts";

// `deno` is guaranteed present (we are running under it) and shell-free, so it
// makes a reliable, cross-platform subject for these tests.
const DENO = Deno.execPath();

Deno.test("tokenize splits literals on whitespace", () => {
  assertEquals(tokenize(["deno  test   -A"], []), ["deno", "test", "-A"]);
});

Deno.test("tokenize keeps interpolated values as atomic args", () => {
  // `cmd ${"a b"}` → two template strings, one value with a space inside.
  assertEquals(tokenize(["cmd ", ""], ["a b"]), ["cmd", "a b"]);
});

Deno.test("tokenize attaches a value to an adjacent literal", () => {
  // `--flag=${"v"}` → no whitespace boundary.
  assertEquals(tokenize(["--flag=", ""], ["v"]), ["--flag=v"]);
});

Deno.test("tokenize expands arrays into multiple args", () => {
  assertEquals(tokenize(["cmd ", ""], [["a", "b", "c"]]), [
    "cmd",
    "a",
    "b",
    "c",
  ]);
});

Deno.test("$ captures trimmed stdout via .text()", async () => {
  const out = await $`${DENO} eval ${"console.log('hello world')"}`.text();
  assertEquals(out, "hello world");
});

Deno.test("$ .lines() splits stdout into lines", async () => {
  const lines = await $`${DENO} eval ${"console.log('a');console.log('b')"}`
    .lines();
  assertEquals(lines, ["a", "b"]);
});

Deno.test("$ .code() returns the exit code without throwing", async () => {
  const code = await $`${DENO} eval ${"Deno.exit(3)"}`.noThrow().code();
  assertEquals(code, 3);
});

Deno.test("$ throws CommandError on non-zero exit by default", async () => {
  const err = await assertRejects(
    () => $`${DENO} eval ${"Deno.exit(2)"}`.quiet().then(),
    CommandError,
  );
  assertEquals((err as CommandError).code, 2);
});

Deno.test("$ .noThrow() suppresses the throw", async () => {
  const result = await $`${DENO} eval ${"Deno.exit(5)"}`.noThrow();
  assertEquals(result.code, 5);
});

Deno.test("$ .env() injects environment variables", async () => {
  const out = await $`${DENO} eval ${"console.log(Deno.env.get('ZUKE_T'))"}`
    .env({ ZUKE_T: "present" })
    .text();
  assertEquals(out, "present");
});

Deno.test("$ .cwd() sets the working directory", async () => {
  const dir = await Deno.makeTempDir();
  const out = await $`${DENO} eval ${"console.log(Deno.cwd())"}`.cwd(dir)
    .text();
  // realPath collapses any symlinks (e.g. /tmp → /private/tmp) for comparison.
  assertEquals(out, await Deno.realPath(dir));
});

Deno.test("$ interpolated values are not re-split (injection safe)", async () => {
  // The whole string is one argv entry, printed verbatim — not run as a command.
  const payload = "; rm -rf /";
  const out = await $`${DENO} eval ${"console.log(Deno.args[0])"} ${payload}`
    .text();
  assertEquals(out, payload);
});

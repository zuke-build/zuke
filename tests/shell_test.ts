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
  // Canonicalise inside the child too: on Windows `Deno.cwd()` can report the
  // 8.3 short form (RUNNER~1) while the parent's realPath returns the long form;
  // realPath on both sides also collapses symlinks (e.g. /tmp → /private/tmp).
  const out =
    await $`${DENO} eval ${"console.log(Deno.realPathSync(Deno.cwd()))"}`
      .cwd(dir)
      .text();
  assertEquals(out, await Deno.realPath(dir));
});

Deno.test("$ interpolated values are not re-split (injection safe)", async () => {
  // The whole string is one argv entry, printed verbatim — not run as a command.
  const payload = "; rm -rf /";
  const out = await $`${DENO} eval ${"console.log(Deno.args[0])"} ${payload}`
    .text();
  assertEquals(out, payload);
});

Deno.test("$ .text() throws on non-zero exit by default", async () => {
  const err = await assertRejects(
    () => $`${DENO} eval ${"console.log('x'); Deno.exit(1)"}`.text(),
    CommandError,
  );
  assertEquals(err instanceof CommandError && err.code === 1, true);
});

Deno.test("$ .lines() on empty output is an empty array", async () => {
  const lines = await $`${DENO} eval ${"// prints nothing"}`.lines();
  assertEquals(lines, []);
});

Deno.test("$ .quiet() suppresses streaming but still captures", async () => {
  const out = await $`${DENO} eval ${"console.log('quiet capture')"}`
    .quiet()
    .text();
  assertEquals(out, "quiet capture");
});

Deno.test("$ awaited result exposes code/stdout and CommandOutput.text()", async () => {
  const result = await $`${DENO} eval ${"console.log('  hi  ')"}`.quiet();
  assertEquals(result.code, 0);
  assertEquals(result.text(), "hi");
});

Deno.test("$ on an empty command rejects", async () => {
  await assertRejects(() => $``.quiet(), Error, "empty command");
});

import { assertEquals, assertRejects } from "./_assert.ts";
import {
  $,
  CommandError,
  CommandTimeoutError,
  tokenize,
} from "../src/shell.ts";
import { withAmbientSignal } from "../src/ambient_signal.ts";
import { withAmbientEcho } from "../src/ambient_echo.ts";

/** A command that sleeps far longer than any test would wait. */
const SLEEP = "await new Promise((r) => setTimeout(r, 30000))";

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

Deno.test("$ .killAfter() kills a slow process and throws", async () => {
  const err = await assertRejects(
    () =>
      $`${DENO} eval ${"await new Promise((r) => setTimeout(r, 30000))"}`
        .quiet()
        .killAfter(100)
        .then(),
    CommandTimeoutError,
  );
  assertEquals(
    err instanceof CommandTimeoutError && err.timeoutMs === 100,
    true,
  );
});

Deno.test("$ .killAfter() does not fire for a fast process", async () => {
  const out = await $`${DENO} eval ${"console.log('quick')"}`
    .killAfter(30000)
    .text();
  assertEquals(out, "quick");
});

Deno.test("$ .killAfter() fires even under .noThrow()", async () => {
  await assertRejects(
    () =>
      $`${DENO} eval ${"await new Promise((r) => setTimeout(r, 30000))"}`
        .quiet()
        .noThrow()
        .killAfter(100)
        .then(),
    CommandTimeoutError,
  );
});

Deno.test("$ .signal() terminates a running command when it aborts", async () => {
  const controller = new AbortController();
  const running = $`${DENO} eval ${SLEEP}`
    .quiet()
    .noThrow()
    .signal(controller.signal)
    .then();
  setTimeout(() => controller.abort(), 50);
  const result = await running;
  // The child was killed rather than sleeping 30s — a non-zero termination code.
  assertEquals(result.code !== 0, true);
});

Deno.test("$ picks up the ambient signal and is terminated on abort", async () => {
  const controller = new AbortController();
  await withAmbientSignal(controller.signal, async () => {
    const running = $`${DENO} eval ${SLEEP}`.quiet().noThrow().then();
    setTimeout(() => controller.abort(), 50);
    const result = await running;
    assertEquals(result.code !== 0, true);
  });
});

Deno.test("$ .signal() overrides the ambient signal", async () => {
  // Ambient stays un-aborted; the explicit per-command signal does the killing.
  const ambient = new AbortController();
  await withAmbientSignal(ambient.signal, async () => {
    const explicit = new AbortController();
    const running = $`${DENO} eval ${SLEEP}`
      .quiet()
      .noThrow()
      .signal(explicit.signal)
      .then();
    setTimeout(() => explicit.abort(), 50);
    const result = await running;
    assertEquals(result.code !== 0, true);
    assertEquals(ambient.signal.aborted, false);
  });
});

Deno.test("$ .killAfter() and .signal() combine — either can end it", async () => {
  // A generous timeout is armed, but the abort signal fires first and kills it.
  const controller = new AbortController();
  const running = $`${DENO} eval ${SLEEP}`
    .quiet()
    .noThrow()
    .killAfter(30000)
    .signal(controller.signal)
    .then();
  setTimeout(() => controller.abort(), 50);
  const result = await running;
  assertEquals(result.code !== 0, true);
});

Deno.test("under an ambient echo sink, a command is echoed, not spawned", async () => {
  const echoed: string[] = [];
  // Would exit 3 (→ CommandError) if actually run; echo mode returns empty success.
  const out = await withAmbientEcho(
    (line) => echoed.push(line),
    async () => await $`${DENO} eval ${"Deno.exit(3)"}`,
  );
  assertEquals(out.code, 0);
  assertEquals(out.stdout, "");
  assertEquals(echoed, [`${DENO} eval Deno.exit(3)`]);
});

Deno.test("echo mode makes .text() return empty without running", async () => {
  const echoed: string[] = [];
  const text = await withAmbientEcho(
    (line) => echoed.push(line),
    () => $`${DENO} eval ${"console.log('hi')"}`.text(),
  );
  assertEquals(text, "");
  assertEquals(echoed.length, 1);
});

Deno.test("echo mode is scoped to the withAmbientEcho subtree", async () => {
  await withAmbientEcho(() => {}, () => Promise.resolve());
  // Outside the scope, commands run for real again.
  const code = await $`${DENO} eval ${"Deno.exit(7)"}`.noThrow().code();
  assertEquals(code, 7);
});

Deno.test("under echo, .spawn() echoes and returns a no-op stub", async () => {
  const echoed: string[] = [];
  // Would start a real process (exit 5) if not intercepted.
  const proc = await withAmbientEcho(
    (line) => echoed.push(line),
    () => Promise.resolve($`${DENO} eval ${"Deno.exit(5)"}`.spawn()),
  );
  assertEquals(echoed, [`${DENO} eval Deno.exit(5)`]);
  assertEquals(proc.pid, -1); // stub, no real process
  assertEquals((await proc.status).code, 0);
  await proc.stop(); // no-op, does not throw
});

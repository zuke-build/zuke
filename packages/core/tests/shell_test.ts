// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "../../../tests/_testing.ts";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
  messageOf,
} from "../../../tests/_assert.ts";
import {
  $,
  CommandError,
  CommandTimeoutError,
  tokenize,
} from "../src/shell.ts";
import { withAmbientSignal } from "../src/ambient_signal.ts";
import { withAmbientEcho } from "../src/ambient_echo.ts";
import { withAmbientRedactor } from "../src/ambient_redactor.ts";
import { REDACTED, Redactor } from "../src/redact.ts";
import { FileTasks, RuntimeTasks } from "../mod.ts";
import { ARGS, EVAL } from "../../../tests/_eval.ts";

/** A command that sleeps far longer than any test would wait. */
const SLEEP = "await new Promise((r) => setTimeout(r, 30000))";

// `deno` is guaranteed present (we are running under it) and shell-free, so it
// makes a reliable, cross-platform subject for these tests.
const DENO = RuntimeTasks.execPath();

test("tokenize splits literals on whitespace", () => {
  assertEquals(tokenize(["deno  test   -A"], []), ["deno", "test", "-A"]);
});

test("tokenize keeps interpolated values as atomic args", () => {
  // `cmd ${"a b"}` → two template strings, one value with a space inside.
  assertEquals(tokenize(["cmd ", ""], ["a b"]), ["cmd", "a b"]);
});

test("tokenize attaches a value to an adjacent literal", () => {
  // `--flag=${"v"}` → no whitespace boundary.
  assertEquals(tokenize(["--flag=", ""], ["v"]), ["--flag=v"]);
});

test("tokenize expands arrays into multiple args", () => {
  assertEquals(tokenize(["cmd ", ""], [["a", "b", "c"]]), [
    "cmd",
    "a",
    "b",
    "c",
  ]);
});

test("$ captures trimmed stdout via .text()", async () => {
  const out = await $`${DENO} ${EVAL} ${"console.log('hello world')"}`.text();
  assertEquals(out, "hello world");
});

test("$ .lines() splits stdout into lines", async () => {
  const lines = await $`${DENO} ${EVAL} ${"console.log('a');console.log('b')"}`
    .lines();
  assertEquals(lines, ["a", "b"]);
});

test("$ .code() returns the exit code without throwing", async () => {
  const code = await $`${DENO} ${EVAL} ${"process.exit(3)"}`.noThrow().code();
  assertEquals(code, 3);
});

test("$ throws CommandError on non-zero exit by default", async () => {
  const err = await assertRejects(
    () => $`${DENO} ${EVAL} ${"process.exit(2)"}`.quiet().then(),
    CommandError,
  );
  assertEquals((err as CommandError).code, 2);
});

test("$ .noThrow() suppresses the throw", async () => {
  const result = await $`${DENO} ${EVAL} ${"process.exit(5)"}`.noThrow();
  assertEquals(result.code, 5);
});

test("$ .env() injects environment variables", async () => {
  const out = await $`${DENO} ${EVAL} ${"console.log(process.env['ZUKE_T'])"}`
    .env({ ZUKE_T: "present" })
    .text();
  assertEquals(out, "present");
});

test("$ .cwd() sets the working directory", async () => {
  const dir = await FileTasks.makeTempDirectory();
  // Canonicalise inside the child too: on Windows the working directory can report the
  // 8.3 short form (RUNNER~1) while the parent's realPath returns the long form;
  // realPath on both sides also collapses symlinks (e.g. /tmp → /private/tmp).
  const out =
    await $`${DENO} ${EVAL} ${"console.log(process.getBuiltinModule('node:fs').realpathSync.native(process.cwd()))"}`
      .cwd(dir)
      .text();
  assertEquals(out, await FileTasks.realPath(dir));
});

test("$ interpolated values are not re-split (injection safe)", async () => {
  // The whole string is one argv entry, printed verbatim — not run as a command.
  const payload = "; rm -rf /";
  const out = await $`${DENO} ${EVAL} ${`console.log(${ARGS}[0])`} ${payload}`
    .text();
  assertEquals(out, payload);
});

test("$ .text() throws on non-zero exit by default", async () => {
  const err = await assertRejects(
    () => $`${DENO} ${EVAL} ${"console.log('x'); process.exit(1)"}`.text(),
    CommandError,
  );
  assertEquals(err instanceof CommandError && err.code === 1, true);
});

test("$ .lines() on empty output is an empty array", async () => {
  const lines = await $`${DENO} ${EVAL} ${"// prints nothing"}`.lines();
  assertEquals(lines, []);
});

test("$ .quiet() suppresses streaming but still captures", async () => {
  const out = await $`${DENO} ${EVAL} ${"console.log('quiet capture')"}`
    .quiet()
    .text();
  assertEquals(out, "quiet capture");
});

test("$ awaited result exposes code/stdout and CommandOutput.text()", async () => {
  const result = await $`${DENO} ${EVAL} ${"console.log('  hi  ')"}`.quiet();
  assertEquals(result.code, 0);
  assertEquals(result.text(), "hi");
});

test("$ on an empty command rejects", async () => {
  await assertRejects(() => $``.quiet(), Error, "empty command");
});

test("$ .killAfter() kills a slow process and throws", async () => {
  const err = await assertRejects(
    () =>
      $`${DENO} ${EVAL} ${"await new Promise((r) => setTimeout(r, 30000))"}`
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

test("$ .killAfter() does not fire for a fast process", async () => {
  const out = await $`${DENO} ${EVAL} ${"console.log('quick')"}`
    .killAfter(30000)
    .text();
  assertEquals(out, "quick");
});

test("$ .killAfter() fires even under .noThrow()", async () => {
  await assertRejects(
    () =>
      $`${DENO} ${EVAL} ${"await new Promise((r) => setTimeout(r, 30000))"}`
        .quiet()
        .noThrow()
        .killAfter(100)
        .then(),
    CommandTimeoutError,
  );
});

test("$ caps captured output and keeps the tail", async () => {
  // 40 lines of 1 KiB, numbered, into a 4 KiB cap: only the last few survive.
  const emit =
    `for (let i = 0; i < 40; i++) console.log(String(i).padStart(4, "0") + "x".repeat(1019));`;
  const out = await $`${DENO} ${EVAL} ${emit}`
    .quiet()
    .maxCapturedBytes(4096)
    .then();
  assertEquals(out.truncated, true);
  // The bytes kept are the LAST ones written…
  assertEquals(out.stdout.trimEnd().endsWith("x".repeat(1019)), true);
  assertEquals(out.stdout.includes("0039"), true);
  // …not the first, and the buffer really is bounded (a memory proxy).
  assertEquals(out.stdout.includes("0000"), false);
  assertEquals(out.stdout.length <= 4096, true, `kept ${out.stdout.length}`);
  // The notice makes the loss visible instead of silently truncating.
  assertEquals(out.text().startsWith("[output truncated to last 4 KiB]"), true);
});

test("$ leaves output under the cap untouched and not truncated", async () => {
  const out = await $`${DENO} ${EVAL} ${"console.log('small')"}`
    .maxCapturedBytes(4096)
    .then();
  assertEquals(out.truncated, false);
  assertEquals(out.text(), "small");
});

test("$ .maxCapturedBytes() rejects a cap capture cannot honour", () => {
  // `-1` is the conventional "no limit" idiom and used to spin the trim loop
  // into an internal TypeError mid-stream; a fractional cap hit a RangeError
  // deep in a subarray. Both must fail at the setter, naming the setting.
  for (const bad of [-1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const err = assertThrows(
      () => $`${DENO} ${EVAL} ${"1"}`.maxCapturedBytes(bad),
      RangeError,
    );
    assertStringIncludes(messageOf(err), "maxCapturedBytes");
    assertStringIncludes(messageOf(err), String(bad));
  }
});

test("$ caps stderr independently of stdout", async () => {
  const emit =
    `console.log("out"); for (let i = 0; i < 8; i++) console.error("e".repeat(1024));`;
  const out = await $`${DENO} ${EVAL} ${emit}`.quiet().maxCapturedBytes(2048)
    .then();
  assertEquals(out.truncated, true);
  assertEquals(out.stdout.includes("out"), true); // stdout was never over cap
  assertEquals(out.stderr.length <= 2048, true);
});

test("$ .signal() terminates a running command when it aborts", async () => {
  const controller = new AbortController();
  const running = $`${DENO} ${EVAL} ${SLEEP}`
    .quiet()
    .noThrow()
    .signal(controller.signal)
    .then();
  setTimeout(() => controller.abort(), 50);
  const result = await running;
  // The child was killed rather than sleeping 30s — a non-zero termination code.
  assertEquals(result.code !== 0, true);
});

test("$ picks up the ambient signal and is terminated on abort", async () => {
  const controller = new AbortController();
  await withAmbientSignal(controller.signal, async () => {
    const running = $`${DENO} ${EVAL} ${SLEEP}`.quiet().noThrow().then();
    setTimeout(() => controller.abort(), 50);
    const result = await running;
    assertEquals(result.code !== 0, true);
  });
});

test("$ .signal() overrides the ambient signal", async () => {
  // Ambient stays un-aborted; the explicit per-command signal does the killing.
  const ambient = new AbortController();
  await withAmbientSignal(ambient.signal, async () => {
    const explicit = new AbortController();
    const running = $`${DENO} ${EVAL} ${SLEEP}`
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

test("$ .killAfter() and .signal() combine — either can end it", async () => {
  // A generous timeout is armed, but the abort signal fires first and kills it.
  const controller = new AbortController();
  const running = $`${DENO} ${EVAL} ${SLEEP}`
    .quiet()
    .noThrow()
    .killAfter(30000)
    .signal(controller.signal)
    .then();
  setTimeout(() => controller.abort(), 50);
  const result = await running;
  assertEquals(result.code !== 0, true);
});

test("commandLine masks an ambient secret but the OS still gets it raw", async () => {
  const redactor = new Redactor();
  redactor.add("hunter2");
  await withAmbientRedactor(redactor, async () => {
    const cmd = $`${DENO} ${EVAL} ${`console.log(${ARGS}[0])`} -- ${"hunter2"}`;
    // The rendered line is masked…
    assertStringIncludes(cmd.commandLine, REDACTED);
    assertEquals(cmd.commandLine.includes("hunter2"), false);
    // …while the argv handed to the process is untouched: the child echoes the
    // real value back.
    assertEquals(await cmd.text(), "hunter2");
  });
});

test("a failed command's error message masks an ambient secret", async () => {
  const redactor = new Redactor();
  redactor.add("hunter2");
  await withAmbientRedactor(redactor, async () => {
    const err = await assertRejects(
      () =>
        $`${DENO} ${EVAL} ${"process.exit(9)"} -- ${"hunter2"}`.quiet().then(),
      CommandError,
    );
    assertEquals(err.message.includes("hunter2"), false);
    assertStringIncludes(err.message, REDACTED);
  });
});

test("a dry-run echo of a secret argv token is masked", async () => {
  const redactor = new Redactor();
  redactor.add("hunter2");
  const echoed: string[] = [];
  await withAmbientRedactor(
    redactor,
    () =>
      withAmbientEcho(
        (line) => echoed.push(line),
        async () => await $`login --password ${"hunter2"}`,
      ),
  );
  assertEquals(echoed, [`login --password ${REDACTED}`]);
});

test("without an ambient redactor the command line is verbatim", () => {
  const cmd = $`login --password ${"hunter2"}`;
  assertEquals(cmd.commandLine, "login --password hunter2");
});

test("under an ambient echo sink, a command is echoed, not spawned", async () => {
  const echoed: string[] = [];
  // Would exit 3 (→ CommandError) if actually run; echo mode returns empty success.
  const out = await withAmbientEcho(
    (line) => echoed.push(line),
    async () => await $`${DENO} ${EVAL} ${"process.exit(3)"}`,
  );
  assertEquals(out.code, 0);
  assertEquals(out.stdout, "");
  assertEquals(echoed, [`${DENO} ${EVAL} process.exit(3)`]);
});

test("echo mode makes .text() return empty without running", async () => {
  const echoed: string[] = [];
  const text = await withAmbientEcho(
    (line) => echoed.push(line),
    () => $`${DENO} ${EVAL} ${"console.log('hi')"}`.text(),
  );
  assertEquals(text, "");
  assertEquals(echoed.length, 1);
});

test("echo mode is scoped to the withAmbientEcho subtree", async () => {
  await withAmbientEcho(() => {}, () => Promise.resolve());
  // Outside the scope, commands run for real again.
  const code = await $`${DENO} ${EVAL} ${"process.exit(7)"}`.noThrow().code();
  assertEquals(code, 7);
});

test("under echo, .spawn() echoes and returns a no-op stub", async () => {
  const echoed: string[] = [];
  // Would start a real process (exit 5) if not intercepted.
  const proc = await withAmbientEcho(
    (line) => echoed.push(line),
    () => Promise.resolve($`${DENO} ${EVAL} ${"process.exit(5)"}`.spawn()),
  );
  assertEquals(echoed, [`${DENO} ${EVAL} process.exit(5)`]);
  assertEquals(proc.pid, -1); // stub, no real process
  assertEquals((await proc.status).code, 0);
  await proc.stop(); // no-op, does not throw
});

test("stdin writes to the child and closes the stream", async () => {
  // A real subprocess, because the property is about a real pipe: the child has
  // to see end-of-input, or a tool reading a credential from stdin hangs.
  const out = await $`${DENO} ${EVAL} ${
    "let n=0;for await(const c of process.stdin)n+=c.length;" +
    "console.log('read',n)"
  }`.stdin("hunter2").quiet().text();
  assertEquals(out.trim(), "read 7");
});

test("a credential passed on stdin stays out of the command line", async () => {
  // The whole reason the setter exists. argv is what `ps` and `/proc` expose,
  // and what every rendered form of the command is built from.
  const command = $`${DENO} ${EVAL} ${"console.log(1)"}`
    .stdin("s3cr3t").quiet();
  assertEquals(command.commandLine.includes("s3cr3t"), false);
  await command;
});

test("stdin does not deadlock on a child that outruns its pipe", async () => {
  // Writing before draining stdout would wedge here: the child fills its output
  // pipe and stops, while the parent is still blocked writing input. Both sides
  // have to move at once.
  const script = "console.log('x'.repeat(200000));" +
    "let n=0;for await(const c of process.stdin)n+=c.length;" +
    "console.error('read',n)";
  const result = await $`${DENO} ${EVAL} ${script}`
    .stdin("y".repeat(100000)).quiet();
  assertEquals(result.code, 0);
  assertStringIncludes(result.stderr, "read 100000");
});

test("without stdin the child keeps an inherited stream", async () => {
  // The non-breaking half: nothing changes for every existing call site.
  const result = await $`${DENO} ${EVAL} ${"console.log('ok')"}`
    .quiet();
  assertEquals(result.code, 0);
  assertStringIncludes(result.stdout, "ok");
});

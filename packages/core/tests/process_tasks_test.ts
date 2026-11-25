// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { FileTasks, RuntimeTasks } from "../mod.ts";
import { test } from "../../../tests/_testing.ts";
import { assertEquals, assertRejects } from "../../../tests/_assert.ts";
import { ProcessTasks } from "../src/process_tasks.ts";
import { EVAL } from "../../../tests/_eval.ts";

test("ProcessTasks.run collects a child's piped output", async () => {
  const output = await ProcessTasks.run(
    RuntimeTasks.execPath(),
    (s) =>
      s.args(EVAL, "console.log('out'); console.error('err'); process.exit(3)")
        .stdout("piped")
        .stderr("piped"),
  );
  assertEquals(output.code, 3);
  assertEquals(output.success, false);
  assertEquals(new TextDecoder().decode(output.stdout).trim(), "out");
  assertEquals(new TextDecoder().decode(output.stderr).trim(), "err");
});

test("ProcessTasks.spawn starts a child that can be stopped", async () => {
  const child = ProcessTasks.spawn(
    RuntimeTasks.execPath(),
    (s) =>
      s.args(EVAL, "setTimeout(() => {}, 60_000)")
        .stdin("null")
        .stdout("null")
        .stderr("null"),
  );
  child.kill("SIGKILL");
  const status = await child.status;
  assertEquals(status.success, false);
});

test("ProcessTasks signal listeners are added and removed", () => {
  const handler = () => {};
  ProcessTasks.addSignalListener("SIGINT", handler);
  ProcessTasks.removeSignalListener("SIGINT", handler);
});

test("ProcessTasks passes the working directory and environment it is given", async () => {
  const dir = await FileTasks.makeTempDirectory();
  try {
    const output = await ProcessTasks.run(
      RuntimeTasks.execPath(),
      (s) =>
        s.args(
          EVAL,
          "console.log(process.cwd(), process.env['ZUKE_ONLY'], process.env['HOME'])",
        )
          .cwd(dir)
          .env("ZUKE_ONLY", "set")
          .clearEnv()
          .stdout("piped"),
    );
    assertEquals(
      new TextDecoder().decode(output.stdout).trim(),
      `${await FileTasks.realPath(dir)} set undefined`,
    );
  } finally {
    await FileTasks.remove(dir, { recursive: true });
  }
});

test("ProcessTasks stops a child when its signal aborts", async () => {
  const abort = new AbortController();
  const child = ProcessTasks.spawn(
    RuntimeTasks.execPath(),
    (s) => s.args(EVAL, "setTimeout(() => {}, 60_000)").signal(abort.signal),
  );
  abort.abort();
  assertEquals((await child.status).success, false);
});

test("ProcessTasks fails to run a command that does not exist", async () => {
  // No settings at all: a missing program is refused before anything runs.
  await assertRejects(() => ProcessTasks.run("zuke-no-such-program"));
});

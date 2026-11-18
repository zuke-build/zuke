// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "./_assert.ts";
import { ProcessTasks } from "../src/process_tasks.ts";

Deno.test("ProcessTasks.run collects a child's piped output", async () => {
  const output = await ProcessTasks.run(
    Deno.execPath(),
    (s) =>
      s.args("eval", "console.log('out'); console.error('err'); Deno.exit(3)")
        .stdout("piped")
        .stderr("piped"),
  );
  assertEquals(output.code, 3);
  assertEquals(output.success, false);
  assertEquals(new TextDecoder().decode(output.stdout).trim(), "out");
  assertEquals(new TextDecoder().decode(output.stderr).trim(), "err");
});

Deno.test("ProcessTasks.spawn starts a child that can be stopped", async () => {
  const child = ProcessTasks.spawn(
    Deno.execPath(),
    (s) =>
      s.args("eval", "setTimeout(() => {}, 60_000)")
        .stdin("null")
        .stdout("null")
        .stderr("null"),
  );
  child.kill("SIGKILL");
  const status = await child.status;
  assertEquals(status.success, false);
});

Deno.test("ProcessTasks signal listeners are added and removed", () => {
  const handler = () => {};
  ProcessTasks.addSignalListener("SIGINT", handler);
  ProcessTasks.removeSignalListener("SIGINT", handler);
});

Deno.test("ProcessTasks passes the working directory and environment it is given", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const output = await ProcessTasks.run(
      Deno.execPath(),
      (s) =>
        s.args(
          "eval",
          "console.log(Deno.realPathSync(Deno.cwd()), Deno.env.get('ZUKE_ONLY'), Deno.env.get('HOME'))",
        )
          .cwd(dir)
          .env("ZUKE_ONLY", "set")
          .clearEnv()
          .stdout("piped"),
    );
    assertEquals(
      new TextDecoder().decode(output.stdout).trim(),
      `${await Deno.realPath(dir)} set undefined`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("ProcessTasks stops a child when its signal aborts", async () => {
  const abort = new AbortController();
  const child = ProcessTasks.spawn(
    Deno.execPath(),
    (s) => s.args("eval", "setTimeout(() => {}, 60_000)").signal(abort.signal),
  );
  abort.abort();
  assertEquals((await child.status).success, false);
});

Deno.test("ProcessTasks fails to run a command that does not exist", async () => {
  // No settings at all: a missing program is refused before anything runs.
  await assertRejects(() => ProcessTasks.run("zuke-no-such-program"));
});

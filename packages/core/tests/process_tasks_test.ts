// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "./_assert.ts";
import { ProcessTasks } from "../src/process_tasks.ts";

Deno.test("ProcessTasks.run collects a child's piped output", async () => {
  const output = await ProcessTasks.run(Deno.execPath(), {
    args: ["eval", "console.log('out'); console.error('err'); Deno.exit(3)"],
    stdout: "piped",
    stderr: "piped",
  });
  assertEquals(output.code, 3);
  assertEquals(output.success, false);
  assertEquals(new TextDecoder().decode(output.stdout).trim(), "out");
  assertEquals(new TextDecoder().decode(output.stderr).trim(), "err");
});

Deno.test("ProcessTasks.spawn starts a child that can be stopped", async () => {
  const child = ProcessTasks.spawn(Deno.execPath(), {
    args: ["eval", "setTimeout(() => {}, 60_000)"],
    stdin: "null",
    stdout: "null",
    stderr: "null",
  });
  child.kill("SIGKILL");
  const status = await child.status;
  assertEquals(status.success, false);
});

Deno.test("ProcessTasks signal listeners are added and removed", () => {
  const handler = () => {};
  ProcessTasks.addSignalListener("SIGINT", handler);
  ProcessTasks.removeSignalListener("SIGINT", handler);
});

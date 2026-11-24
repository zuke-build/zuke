// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "./_testing.ts";
import { assertEquals } from "./_assert.ts";
import { EnvTasks } from "../src/env.ts";
import { RuntimeTasks } from "../src/runtime_tasks.ts";

test("RuntimeTasks reports this Deno process", () => {
  assertEquals(RuntimeTasks.facts().name, "deno");
  assertEquals(RuntimeTasks.facts().version, Deno.version.deno);
  assertEquals(RuntimeTasks.os(), Deno.build.os);
  assertEquals(RuntimeTasks.execPath(), Deno.execPath());
  assertEquals(RuntimeTasks.mainModule(), Deno.mainModule);
  assertEquals(RuntimeTasks.args(), Deno.args);
  assertEquals(
    RuntimeTasks.userId(),
    Deno.build.os === "windows" ? null : Deno.uid(),
  );
  assertEquals(RuntimeTasks.arch(), Deno.build.arch);
  assertEquals(RuntimeTasks.cwd(), Deno.cwd());
  assertEquals(RuntimeTasks.isTerminal("stdin"), Deno.stdin.isTerminal());
  assertEquals(RuntimeTasks.isTerminal("stdout"), Deno.stdout.isTerminal());
  assertEquals(RuntimeTasks.isTerminal("stderr"), Deno.stderr.isTerminal());
});

test("RuntimeTasks.cwd follows a change of directory", () => {
  const before = Deno.cwd();
  const dir = Deno.makeTempDirSync();
  try {
    Deno.chdir(dir);
    assertEquals(RuntimeTasks.cwd(), Deno.cwd());
  } finally {
    Deno.chdir(before);
    Deno.removeSync(dir);
  }
});

test("RuntimeTasks.exit ends the process with the code", async () => {
  const runtimeTasks = new URL("../src/runtime_tasks.ts", import.meta.url).href;
  const { code, stdout } = await new Deno.Command(Deno.execPath(), {
    args: [
      "eval",
      `import { RuntimeTasks } from ${JSON.stringify(runtimeTasks)};
       RuntimeTasks.exit(7);
       console.log("not reached");`,
    ],
    stdout: "piped",
    stderr: "null",
  }).output();
  assertEquals(code, 7);
  assertEquals(new TextDecoder().decode(stdout), "");
});

test("EnvTasks reads a variable, and an unset one as undefined", () => {
  const name = `ZUKE_ENV_TASKS_${crypto.randomUUID().replaceAll("-", "_")}`;
  assertEquals(EnvTasks.get(name), undefined);
  Deno.env.set(name, "value");
  try {
    assertEquals(EnvTasks.get(name), "value");
  } finally {
    Deno.env.delete(name);
  }
});

test({
  name: "EnvTasks reads a denied environment as unset",
  permissions: { env: false },
  fn: () => {
    assertEquals(EnvTasks.get("PATH"), undefined);
  },
});

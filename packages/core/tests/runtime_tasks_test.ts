// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "../../../tests/_testing.ts";
import { assertEquals } from "../../../tests/_assert.ts";
import { EnvTasks } from "../src/env.ts";
import { RuntimeTasks } from "../src/runtime_tasks.ts";
import { FileTasks, ProcessTasks } from "../mod.ts";
import { withTempCwd } from "../../../tests/_temp.ts";
import { EVAL } from "../../../tests/_eval.ts";

test({
  name: "RuntimeTasks reports this Deno process",
  denoOnly: "compares the answers with Deno's own",
  fn: () => {
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
  },
});

test("RuntimeTasks.cwd follows a change of directory", async () => {
  await withTempCwd(async (dir) => {
    assertEquals(
      await FileTasks.realPath(RuntimeTasks.cwd()),
      await FileTasks.realPath(dir),
    );
  });
});

test("RuntimeTasks.exit ends the process with the code", async () => {
  const runtimeTasks = new URL("../src/runtime_tasks.ts", import.meta.url).href;
  const { code, stdout } = await ProcessTasks.run(
    RuntimeTasks.execPath(),
    (s) =>
      s.args(
        EVAL,
        `import { RuntimeTasks } from ${JSON.stringify(runtimeTasks)};
         RuntimeTasks.exit(7);
         console.log("not reached");`,
      ).stdout("piped").stderr("null"),
  );
  assertEquals(code, 7);
  assertEquals(new TextDecoder().decode(stdout), "");
});

test("EnvTasks reads a variable, and an unset one as undefined", () => {
  const name = `ZUKE_ENV_TASKS_${crypto.randomUUID().replaceAll("-", "_")}`;
  assertEquals(EnvTasks.get(name), undefined);
  EnvTasks.set(name, "value");
  try {
    assertEquals(EnvTasks.get(name), "value");
  } finally {
    EnvTasks.delete(name);
  }
});

test({
  name: "EnvTasks reads a denied environment as unset",
  permissions: { env: false },
  fn: () => {
    assertEquals(EnvTasks.get("PATH"), undefined);
  },
});

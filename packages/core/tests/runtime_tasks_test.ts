// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "./_assert.ts";
import { EnvTasks } from "../src/env.ts";
import { RuntimeTasks } from "../src/runtime_tasks.ts";

Deno.test("RuntimeTasks reports this Deno process", () => {
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
});

Deno.test("EnvTasks reads a variable, and an unset one as undefined", () => {
  const name = `ZUKE_ENV_TASKS_${crypto.randomUUID().replaceAll("-", "_")}`;
  assertEquals(EnvTasks.get(name), undefined);
  Deno.env.set(name, "value");
  try {
    assertEquals(EnvTasks.get(name), "value");
  } finally {
    Deno.env.delete(name);
  }
});

Deno.test({
  name: "EnvTasks reads a denied environment as unset",
  permissions: { env: false },
  fn: () => {
    assertEquals(EnvTasks.get("PATH"), undefined);
  },
});

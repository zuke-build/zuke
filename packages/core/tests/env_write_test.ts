// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/** Tests for `EnvTasks.set` and `EnvTasks.delete`. */

import { test } from "../../../tests/_testing.ts";
import { assertEquals } from "../../../tests/_assert.ts";
import { withEnv } from "../../../tests/_env.ts";
import { EnvTasks } from "../src/env.ts";
import { ProcessTasks } from "../src/process_tasks.ts";
import { RuntimeTasks } from "../src/runtime_tasks.ts";

const NAME = "ZUKE_ENV_WRITE_TEST";

test("EnvTasks.set makes a variable readable, and delete removes it", async () => {
  await withEnv({ [NAME]: undefined }, () => {
    EnvTasks.set(NAME, "one");
    assertEquals(EnvTasks.get(NAME), "one");
    EnvTasks.set(NAME, "");
    assertEquals(EnvTasks.get(NAME), "");
    EnvTasks.delete(NAME);
    assertEquals(EnvTasks.get(NAME), undefined);
    // Deleting what is not set is a no-op.
    EnvTasks.delete(NAME);
    assertEquals(EnvTasks.get(NAME), undefined);
  });
});

test("a variable EnvTasks.set reaches a process started afterwards", async () => {
  await withEnv({ [NAME]: undefined }, async () => {
    EnvTasks.set(NAME, "inherited");
    const runtime = RuntimeTasks.facts().name;
    const script = `console.log(process.env.${NAME})`;
    const args = runtime === "deno"
      ? ["eval", `import process from "node:process"; ${script}`]
      : ["-e", script];
    const out = await ProcessTasks.run(
      RuntimeTasks.execPath(),
      (s) => s.args(...args).stdout("piped"),
    );
    assertEquals(new TextDecoder().decode(out.stdout).trim(), "inherited");
  });
});

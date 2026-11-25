// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A real build, run through the CLI, whose targets use the runtime tasks core
 * gained so tests and builds need no runtime of their own: an environment
 * variable set by one target and read by the next, a working directory
 * changed, a temporary file, and an HTTP server answering a TCP client.
 */

import { test } from "../_testing.ts";
import { assertEquals } from "../_assert.ts";
import {
  Build,
  EnvTasks,
  FileTasks,
  NetTasks,
  RuntimeTasks,
  target,
} from "../../packages/core/mod.ts";
import { runCli } from "./_harness.ts";
import { withEnv } from "../_env.ts";
import { withTemp } from "../_temp.ts";

const NAME = "ZUKE_RUNTIME_SEAMS_IT";

test("a build sets the environment, moves directory, makes a temp file and serves HTTP through core's tasks", async () => {
  const seen: string[] = [];
  await withEnv({ [NAME]: undefined }, () =>
    withTemp(async (dir) => {
      const before = RuntimeTasks.cwd();
      class Seams extends Build {
        set = target().executes(() => {
          EnvTasks.set(NAME, "from set");
        });
        read = target().dependsOn(this.set).executes(() => {
          seen.push(`env ${EnvTasks.get(NAME)}`);
          EnvTasks.delete(NAME);
          seen.push(`deleted ${EnvTasks.get(NAME)}`);
        });
        move = target().dependsOn(this.read).executes(async () => {
          RuntimeTasks.chdir(dir);
          try {
            await FileTasks.writeText("here.txt", "x");
          } finally {
            RuntimeTasks.chdir(before);
          }
          seen.push(`moved ${await FileTasks.exists(`${dir}/here.txt`)}`);
        });
        temp = target().dependsOn(this.move).executes(async () => {
          const file = await FileTasks.makeTempFile((s) => s.suffix(".txt"));
          seen.push(`temp ${file.endsWith(".txt")}`);
          await FileTasks.remove(file);
        });
        serve = target().dependsOn(this.temp).executes(async () => {
          const server = await NetTasks.serve(() => new Response("served"));
          try {
            const response = await fetch(`http://127.0.0.1:${server.port}/`);
            seen.push(await response.text());
            const connection = await NetTasks.connect(server.port);
            connection.close();
            seen.push("connected");
          } finally {
            await server.close();
          }
        });
      }
      const result = await runCli(Seams, ["serve"]);
      assertEquals(result.code, 0, result.err);
      assertEquals(RuntimeTasks.cwd(), before);
    }));
  assertEquals(seen, [
    "env from set",
    "deleted undefined",
    "moved true",
    "temp true",
    "served",
    "connected",
  ]);
});

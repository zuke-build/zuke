// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration test for core's runtime task objects, driven through the real
 * CLI: a build whose targets stage a file through `FileTasks` and
 * `StreamTasks`, read the environment through `EnvTasks`, run a child through
 * `ProcessTasks`, and talk to themselves over a `NetTasks` socket, each
 * target reading what the one before it left.
 *
 * @module
 */

import { test } from "../_testing.ts";
import { assertEquals } from "../_assert.ts";
import {
  Build,
  EnvTasks,
  FileTasks,
  NetTasks,
  ProcessTasks,
  RuntimeTasks,
  StreamTasks,
  target,
} from "../../packages/core/mod.ts";
import { runCli } from "./_harness.ts";
import { ARGS, EVAL } from "../_eval.ts";

/** What the targets of {@link RuntimeTasksBuild} observed, in order. */
const seen: string[] = [];

/** Where the build stages its files; set per test run. */
let staging = "";

/** A build using each runtime task object, a target depending on the last. */
class RuntimeTasksBuild extends Build {
  stage = target().executes(async () => {
    const body = new Blob(["streamed"]).stream();
    await StreamTasks.toFile(
      `${staging}/payload.txt`,
      body,
      (s) => s.createNew(),
    );
    const entries = await FileTasks.readDirectory(staging);
    seen.push(`staged ${entries.map((entry) => entry.name).join(",")}`);
    seen.push(
      `in ${await FileTasks.exists(RuntimeTasks.cwd())} on ${
        ["x86_64", "aarch64"].includes(RuntimeTasks.arch())
      }`,
    );
  });

  run = target().dependsOn(this.stage).executes(async () => {
    const output = await ProcessTasks.run(
      RuntimeTasks.execPath(),
      (s) =>
        s.args(
          EVAL,
          `console.log(process.getBuiltinModule('node:fs').readFileSync(${ARGS}[0], 'utf8') + process.env["SUFFIX"])`,
          `${staging}/payload.txt`,
        )
          .env("SUFFIX", EnvTasks.get("ZUKE_RUNTIME_TASKS") ?? "unset")
          .stdout("piped"),
    );
    seen.push(`child said ${new TextDecoder().decode(output.stdout).trim()}`);
  });

  talk = target().dependsOn(this.run).executes(async () => {
    const listener = await NetTasks.listen();
    const client = await NetTasks.connect(listener.port);
    const server = await listener.accept();
    listener.close();
    await server.write(await FileTasks.readBytes(`${staging}/payload.txt`));
    await server.closeWrite();
    seen.push(`socket carried ${await new Response(client.readable).text()}`);
    server.close();
  });
}

test("a build stages, runs and talks through core's runtime tasks", async () => {
  staging = await FileTasks.makeTempDirectory((s) => s.prefix("zuke-runtime-"));
  seen.length = 0;
  EnvTasks.set("ZUKE_RUNTIME_TASKS", "!");
  try {
    const { code, err } = await runCli(RuntimeTasksBuild, ["talk"]);
    assertEquals(code, 0, err);
    assertEquals(seen, [
      "staged payload.txt",
      "in true on true",
      "child said streamed!",
      "socket carried streamed",
    ]);
  } finally {
    EnvTasks.delete("ZUKE_RUNTIME_TASKS");
    await FileTasks.remove(staging, { recursive: true });
  }
});

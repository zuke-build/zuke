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

import { assertEquals } from "../../packages/core/tests/_assert.ts";
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
      `in ${RuntimeTasks.cwd() === Deno.cwd()} on ${
        RuntimeTasks.arch() === Deno.build.arch
      }`,
    );
  });

  run = target().dependsOn(this.stage).executes(async () => {
    const output = await ProcessTasks.run(
      RuntimeTasks.execPath(),
      (s) =>
        s.args(
          "eval",
          `console.log(await Deno.readTextFile(Deno.args[0]) + Deno.env.get("SUFFIX"))`,
          `${staging}/payload.txt`,
        )
          .env("SUFFIX", EnvTasks.get("ZUKE_RUNTIME_TASKS") ?? "unset")
          .stdout("piped"),
    );
    seen.push(`child said ${new TextDecoder().decode(output.stdout).trim()}`);
  });

  talk = target().dependsOn(this.run).executes(async () => {
    const listener = await NetTasks.listen();
    const client = await Deno.connect({
      hostname: "127.0.0.1",
      port: listener.port,
    });
    const server = await listener.accept();
    listener.close();
    await server.write(await FileTasks.readBytes(`${staging}/payload.txt`));
    await server.closeWrite();
    seen.push(`socket carried ${await new Response(client.readable).text()}`);
    server.close();
  });
}

Deno.test("a build stages, runs and talks through core's runtime tasks", async () => {
  staging = await FileTasks.makeTempDirectory((s) => s.prefix("zuke-runtime-"));
  seen.length = 0;
  Deno.env.set("ZUKE_RUNTIME_TASKS", "!");
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
    Deno.env.delete("ZUKE_RUNTIME_TASKS");
    await FileTasks.remove(staging, { recursive: true });
  }
});

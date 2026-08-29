// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import { missingTool } from "@zuke/core/tooling/conformance";
import {
  DenoBenchSettings,
  DenoEvalSettings,
  DenoServeSettings,
  DenoTasks,
} from "../mod.ts";

Deno.test("serve: permissions, address and the module operand", () => {
  const argv = new DenoServeSettings()
    .allow("net", "0.0.0.0:8000")
    .frozen()
    .config("deno.json")
    .port(8000)
    .host("127.0.0.1")
    .parallel()
    .open()
    .watch()
    .script("main.ts")
    .scriptArgs("--verbose")
    .argv()
    .slice(1);
  assertEquals(argv, [
    "serve",
    "--allow-net=0.0.0.0:8000",
    "--frozen",
    "--config",
    "deno.json",
    "--port",
    "8000",
    "--host",
    "127.0.0.1",
    "--parallel",
    "--open",
    "--watch",
    "main.ts",
    "--verbose",
  ]);
});

Deno.test("serve: port 0 is a real choice, not an unset one", () => {
  assertEquals(
    new DenoServeSettings().port(0).script("main.ts").argv().slice(1),
    ["serve", "--port", "0", "main.ts"],
  );
});

Deno.test("serve: the module is required", () => {
  const error = assertThrows(() => new DenoServeSettings().argv(), Error);
  assertEquals(error.message.includes(".script() is required"), true);
});

Deno.test("eval: the source is one argv entry, never a shell string", () => {
  const source = 'console.log("a b"); // ; rm -rf /';
  const argv = new DenoEvalSettings()
    .allowAll()
    .ext("js")
    .print()
    .code(source)
    .argv()
    .slice(1);
  assertEquals(argv, [
    "eval",
    "--allow-all",
    "--ext",
    "js",
    "--print",
    source,
  ]);
});

Deno.test("eval: the source is required", () => {
  const error = assertThrows(() => new DenoEvalSettings().argv(), Error);
  assertEquals(error.message.includes(".code() is required"), true);
});

Deno.test("bench: bare run is just the subcommand", () => {
  assertEquals(new DenoBenchSettings().argv().slice(1), ["bench"]);
});

Deno.test("bench: flags precede the paths", () => {
  const argv = new DenoBenchSettings()
    .allowAll()
    .config("deno.json")
    .filter("parse")
    .json()
    .noRun()
    .permitNoFiles()
    .ignore("bench/fixtures", "bench/slow")
    .paths("bench/")
    .argv()
    .slice(1);
  assertEquals(argv, [
    "bench",
    "--allow-all",
    "--config",
    "deno.json",
    "--filter",
    "parse",
    "--json",
    "--no-run",
    "--permit-no-files",
    "--ignore=bench/fixtures,bench/slow",
    "bench/",
  ]);
});

Deno.test("every new DenoTasks function reaches execution", async () => {
  // Each entry configures the settings only as far as its own required
  // operands, so the reach it proves is the tool resolution, not the argv.
  const reaches: Array<[string, () => Promise<unknown>]> = [
    ["serve", () => DenoTasks.serve((s) => missingTool(s).script("main.ts"))],
    ["eval", () => DenoTasks.eval((s) => missingTool(s).code("1"))],
    ["bench", () => DenoTasks.bench(missingTool)],
    ["compile", () => DenoTasks.compile((s) => missingTool(s).script("m.ts"))],
    ["clean", () => DenoTasks.clean(missingTool)],
    ["info", () => DenoTasks.info(missingTool)],
    ["init", () => DenoTasks.init(missingTool)],
    ["upgrade", () => DenoTasks.upgrade(missingTool)],
    ["add", () => DenoTasks.add((s) => missingTool(s).packages("npm:x"))],
    ["remove", () => DenoTasks.remove((s) => missingTool(s).packages("x"))],
    [
      "uninstall",
      () => DenoTasks.uninstall((s) => missingTool(s).packages("x")),
    ],
    ["outdated", () => DenoTasks.outdated(missingTool)],
    ["why", () => DenoTasks.why((s) => missingTool(s).packageName("x"))],
    ["ci", () => DenoTasks.ci(missingTool)],
    [
      "approveScripts",
      () => DenoTasks.approveScripts((s) => missingTool(s).packages("npm:x")),
    ],
    ["bumpVersion", () => DenoTasks.bumpVersion(missingTool)],
    ["pack", () => DenoTasks.pack(missingTool)],
  ];
  for (const [name, reach] of reaches) {
    try {
      await assertRejects(reach, ToolNotFoundError);
    } catch (error) {
      throw new Error(
        `DenoTasks.${name} did not reach tool resolution`,
        { cause: error },
      );
    }
  }
});

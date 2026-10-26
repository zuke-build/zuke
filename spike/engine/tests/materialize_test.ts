// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { discoverTargets } from "@zuke/core";
import {
  assertEquals,
  assertThrows,
} from "../../../packages/core/tests/_assert.ts";
import { materialize, type TargetRunner } from "../src/materialize.ts";

function recorder(): { runner: TargetRunner; finished: number[] } {
  const finished: number[] = [];
  return {
    finished,
    runner: {
      runTarget: () => Promise.resolve(),
      finish: (code) => {
        finished.push(code);
        return Promise.resolve();
      },
    },
  };
}

Deno.test("materialize declares one target field per manifest entry, in order", () => {
  const Remote = materialize({
    name: "B",
    targets: [
      { name: "lint", description: "lint it", dependsOn: [] },
      { name: "test", description: "test it", dependsOn: ["lint"] },
      { name: "default", description: "", dependsOn: ["lint", "test"] },
    ],
  }, recorder().runner);
  const targets = discoverTargets(new Remote());
  assertEquals([...targets.keys()], ["lint", "test", "default"]);
  assertEquals(targets.get("test")?.description_, "test it");
  assertEquals(
    targets.get("default")?.dependsOn_.map((d) => d.name_),
    ["lint", "test"],
  );
});

Deno.test("materialize refuses a duplicate or a forward reference, naming it", () => {
  const twice = materialize({
    name: "B",
    targets: [
      { name: "a", description: "", dependsOn: [] },
      { name: "a", description: "", dependsOn: [] },
    ],
  }, recorder().runner);
  assertThrows(() => new twice(), Error, 'target "a" is declared twice');
  const forward = materialize({
    name: "B",
    targets: [
      { name: "a", description: "", dependsOn: ["b"] },
      { name: "b", description: "", dependsOn: [] },
    ],
  }, recorder().runner);
  assertThrows(
    () => new forward(),
    Error,
    'target "a" depends on "b", which is not declared before it',
  );
});

Deno.test("onFinish tells the host the run's exit code", async () => {
  const { runner, finished } = recorder();
  const Remote = materialize({ name: "B", targets: [] }, runner);
  const build = new Remote();
  await build.onFinish({ ok: true, executed: [] });
  await build.onFinish({ ok: false, executed: [] });
  assertEquals(finished, [0, 1]);
});

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { discoverParameters, discoverTargets } from "@zuke/core";
import {
  assertEquals,
  assertThrows,
} from "../../../packages/core/tests/_assert.ts";
import { materialize, type TargetRunner } from "../src/materialize.ts";
import { parseManifest } from "../src/protocol.ts";

function recorder(): { runner: TargetRunner; finished: number[] } {
  const finished: number[] = [];
  return {
    finished,
    runner: {
      configure: () => Promise.resolve(),
      runTarget: () => Promise.resolve(),
      finish: (code) => {
        finished.push(code);
        return Promise.resolve();
      },
    },
  };
}

/** Materialise a JSON manifest, defaults filled by the parser. */
function remote(manifest: unknown): new () => InstanceType<
  ReturnType<typeof materialize>
> {
  return materialize(parseManifest(manifest), recorder().runner);
}

Deno.test("materialize declares one target field per manifest entry, in order", () => {
  const Remote = remote({
    name: "B",
    targets: [
      { name: "lint", description: "lint it" },
      { name: "test", description: "test it", dependsOn: ["lint"] },
      { name: "default", description: "", dependsOn: ["lint", "test"] },
    ],
  });
  const targets = discoverTargets(new Remote());
  assertEquals([...targets.keys()], ["lint", "test", "default"]);
  assertEquals(targets.get("test")?.description_, "test it");
  assertEquals(
    targets.get("default")?.dependsOn_.map((d) => d.name_),
    ["lint", "test"],
  );
});

Deno.test("materialize applies every target setting, group and config field", () => {
  const Remote = remote({
    name: "B",
    targets: [
      {
        name: "a",
        unlisted: true,
        inputs: ["src/**"],
        outputs: ["out"],
        produces: ["dist.tgz"],
        retry: { times: 2, delayMs: 50 },
        timeoutMs: 1000,
        before: ["b"],
        after: ["c"],
        triggers: ["c"],
        proceedAfterFailure: true,
        always: true,
        dryRunnable: true,
        requires: ["tag"],
        onCancel: "c",
        onFailure: "b",
      },
      { name: "b", onFailure: "cancel-run" },
      { name: "c", onFailure: "fail" },
    ],
    parameters: [{ name: "tag" }],
    groups: [{ name: "g", members: ["a", "b"] }],
    config: { deadline: "45m", unforceable: ["c"] },
  });
  const build = new Remote();
  const targets = discoverTargets(build);
  discoverParameters(build); // Names the parameters, as the CLI does.
  const a = targets.get("a");
  assertEquals(a?.unlisted_, true);
  assertEquals(a?.inputs_, ["src/**"]);
  assertEquals(a?.outputs_, ["out"]);
  assertEquals(a?.produces_, ["dist.tgz"]);
  assertEquals([a?.retries_, a?.retryDelay_, a?.timeout_], [2, 50, 1000]);
  assertEquals(a?.before_.map((t) => t.name_), ["b"]);
  assertEquals(a?.after_.map((t) => t.name_), ["c"]);
  assertEquals(a?.triggers_.map((t) => t.name_), ["c"]);
  assertEquals(
    [a?.proceedAfterFailure_, a?.always_, a?.dryRunnable_],
    [true, true, true],
  );
  assertEquals(a?.requires_.map((p) => p.name_), ["tag"]);
  assertEquals(a?.onCancel_?.().name_, "c");
  const disposition = (name: string) => {
    const result = targets.get(name)?.onFailure_?.();
    return typeof result === "string" ? result : result?.name_;
  };
  assertEquals([disposition("a"), disposition("b"), disposition("c")], [
    "b",
    "cancel-run",
    "fail",
  ]);
  assertEquals(a?.group_?.members_.map((t) => t.name_), ["a", "b"]);
  assertEquals(build.deadline(), "45m");
  assertEquals(build.unforceable().map((t) => t.name_), ["c"]);
});

Deno.test("materialize declares each parameter kind as parameter() would", () => {
  const Remote = remote({
    name: "B",
    targets: [],
    parameters: [
      { name: "tag", description: "t", default: "dev", options: ["dev", "ci"] },
      { name: "items", required: true, array: true },
      { name: "n", kind: "number", default: 3 },
      { name: "ns", kind: "number", array: true },
      { name: "req", kind: "number", required: true },
      { name: "v", kind: "boolean", default: true, flag: "verbose" },
      { name: "must", kind: "boolean", required: true },
      { name: "s", secret: true, env: "S" },
    ],
  });
  const params = discoverParameters(new Remote());
  assertEquals(
    [...params.values()].map((p) => [
      p.name_,
      p.kind_,
      p.required_,
      p.array_,
      p.default_,
    ]),
    [
      ["tag", "string", false, false, "dev"],
      ["items", "string", true, true, undefined],
      ["n", "number", false, false, "3"],
      ["ns", "number", false, true, undefined],
      ["req", "number", true, false, undefined],
      ["v", "boolean", false, false, "true"],
      ["must", "boolean", true, false, undefined],
      ["s", "string", false, false, undefined],
    ],
  );
  assertEquals(params.get("tag")?.options_, ["dev", "ci"]);
  assertEquals(params.get("v")?.flagName_, "verbose");
  assertEquals([params.get("s")?.secret_, params.get("s")?.envName_], [
    true,
    "S",
  ]);
});

Deno.test("materialize refuses a duplicate, a forward dependency, or an undeclared name", () => {
  const refuse = (manifest: unknown, message: string) =>
    assertThrows(() => new (remote(manifest))(), Error, message);
  refuse(
    { name: "B", targets: [{ name: "a" }, { name: "a" }] },
    '"a" is declared twice',
  );
  refuse(
    { name: "B", targets: [{ name: "a" }], parameters: [{ name: "a" }] },
    '"a" is declared twice',
  );
  refuse(
    { name: "B", targets: [{ name: "a", dependsOn: ["b"] }, { name: "b" }] },
    'target "a" depends on "b", which is not declared before it',
  );
  refuse(
    { name: "B", targets: [{ name: "a", before: ["x"] }] },
    'target "a"\'s "before" names "x", which is not declared',
  );
  refuse(
    { name: "B", targets: [{ name: "a", requires: ["x"] }] },
    'target "a"\'s "requires" names "x", which is not declared',
  );
  refuse(
    { name: "B", targets: [{ name: "a", onCancel: "x" }] },
    'target "a"\'s "onCancel" names "x"',
  );
  refuse(
    { name: "B", targets: [{ name: "a", onFailure: "x" }] },
    'target "a"\'s "onFailure" names "x"',
  );
  refuse(
    { name: "B", targets: [], groups: [{ name: "g", members: ["x"] }] },
    'group "g" names "x"',
  );
  refuse(
    { name: "B", targets: [], config: { unforceable: ["x"] } },
    '"unforceable" names "x"',
  );
});

Deno.test("onFinish tells the host the run's exit code", async () => {
  const { runner, finished } = recorder();
  const Remote = materialize(
    parseManifest({ name: "B", targets: [] }),
    runner,
  );
  const build = new Remote();
  await build.onFinish({ ok: true, executed: [] });
  await build.onFinish({ ok: false, executed: [] });
  assertEquals(finished, [0, 1]);
});

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../packages/core/tests/_assert.ts";
import {
  checkExamples,
  discoverExamples,
  type Example,
  type ExampleRunner,
  formatExampleFailures,
} from "../build/examples.ts";

/** A runner that records the order of its calls and answers from a script. */
function fakeRunner(
  verdicts: {
    check?: Record<string, string>;
    list?: Record<string, string>;
    pipeline?: Record<string, string>;
  },
): ExampleRunner & { calls: string[] } {
  const calls: string[] = [];
  const step =
    (name: string, scripted?: Record<string, string>) => (key: string) => {
      calls.push(`${name} ${key}`);
      const detail = scripted?.[key];
      return Promise.resolve({
        ok: detail === undefined,
        detail: detail ?? "",
      });
    };
  return {
    calls,
    check: step("check", verdicts.check),
    list: step("list", verdicts.list),
    pipeline: step("pipeline", verdicts.pipeline),
  };
}

const EXAMPLES: Example[] = [
  { dir: "examples/a", file: "examples/a/zuke.ts" },
  { dir: "examples/b", file: "examples/b/zuke.ts" },
];

Deno.test("discoverExamples finds every build file, sorted, with its directory", async () => {
  const root = await Deno.makeTempDir({
    dir: Deno.cwd(),
    prefix: ".examples-",
  });
  try {
    for (const name of ["zeta", "alpha"]) {
      await Deno.mkdir(`${root}/${name}`);
      await Deno.writeTextFile(`${root}/${name}/zuke.ts`, "");
    }
    // A directory without a build file is not an example.
    await Deno.mkdir(`${root}/notes`);
    await Deno.writeTextFile(`${root}/notes/README.md`, "");
    const found = await discoverExamples(`${root}/*/zuke.ts`);
    assertEquals(found.map((e) => e.dir), [`${root}/alpha`, `${root}/zeta`]);
    assertEquals(found.map((e) => e.file), [
      `${root}/alpha/zuke.ts`,
      `${root}/zeta/zuke.ts`,
    ]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("discoverExamples refuses an empty match rather than passing vacuously", async () => {
  let message = "";
  try {
    await discoverExamples("examples/no-such-dir-*/zuke.ts");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertEquals(message.includes("No example builds match"), true);
});

Deno.test("checkExamples runs all three steps per example, in order", async () => {
  const runner = fakeRunner({});
  assertEquals(await checkExamples(EXAMPLES, runner), []);
  assertEquals(runner.calls, [
    "check examples/a/zuke.ts",
    "list examples/a",
    "pipeline examples/a",
    "check examples/b/zuke.ts",
    "list examples/b",
    "pipeline examples/b",
  ]);
});

Deno.test("a build that fails to type-check is reported once and not listed", async () => {
  const runner = fakeRunner({
    check: { "examples/a/zuke.ts": "TS2339: no such method" },
  });
  const failures = await checkExamples(EXAMPLES, runner);
  assertEquals(failures, [
    { dir: "examples/a", step: "check", detail: "TS2339: no such method" },
  ]);
  assertEquals(runner.calls.includes("list examples/a"), false);
  assertEquals(runner.calls.includes("pipeline examples/a"), false);
  assertEquals(runner.calls.includes("list examples/b"), true);
});

Deno.test("a build whose --list fails is reported with the list output", async () => {
  const runner = fakeRunner({
    list: { "examples/b": "forward reference to this.test" },
  });
  assertEquals(await checkExamples(EXAMPLES, runner), [
    {
      dir: "examples/b",
      step: "list",
      detail: "forward reference to this.test",
    },
  ]);
  // The pipeline step would only repeat a build that does not run.
  assertEquals(runner.calls.includes("pipeline examples/b"), false);
});

Deno.test("an example whose committed pipeline drifted is reported", async () => {
  // The step this covers: an example commits the workflow files `cicd()`
  // renders, and a change to the renderer leaves them stale. Type-checking and
  // `--list` both still pass, so without this the gate is blind to it.
  const runner = fakeRunner({
    pipeline: {
      "examples/a": "CI configuration is out of date: .gitlab-ci.yml.",
    },
  });
  assertEquals(await checkExamples(EXAMPLES, runner), [
    {
      dir: "examples/a",
      step: "pipeline",
      detail: "CI configuration is out of date: .gitlab-ci.yml.",
    },
  ]);
});

Deno.test("formatExampleFailures names the example, the step, and the output", () => {
  const text = formatExampleFailures([
    { dir: "examples/a", step: "check", detail: "line one\nline two" },
    { dir: "examples/b", step: "list", detail: "boom" },
    { dir: "examples/c", step: "pipeline", detail: "stale .gitlab-ci.yml" },
  ]);
  assertEquals(text.startsWith("3 example(s) failed the gate:"), true);
  assertEquals(
    text.includes(
      "  examples/a does not type-check:\n    line one\n    line two",
    ),
    true,
  );
  assertEquals(text.includes("  examples/b fails --list:\n    boom"), true);
  assertEquals(
    text.includes(
      "  examples/c has stale pipeline files:\n    stale .gitlab-ci.yml",
    ),
    true,
  );
  assertEquals(text.includes("it is what readers copy"), true);
});

Deno.test("the shipped examples are discovered and pass the real gate", async () => {
  // Integration: the default runner spawns the real `deno check` and
  // `deno run … --list` (Deno.execPath() via the wrapper) over every shipped
  // example, resolving their jsr:@zuke/* imports to this workspace — the same
  // work `./zuke examplesCheck` does in the gate, so the normal test lane
  // proves the runner and the examples end to end on every OS the suite runs.
  const all = await discoverExamples();
  assertEquals(
    all.map((e) => e.dir.replace(/^.*[\\/]/, "")),
    [
      "ci-only",
      "deno-library",
      "node-app",
      "release-library",
      "scripts-to-zuke",
    ],
  );
  assertEquals(await checkExamples(all), []);
});

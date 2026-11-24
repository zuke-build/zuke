// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "../../../tests/_testing.ts";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "../../../tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import { missingTool } from "@zuke/core/tooling/conformance";
import { NodeEvaluateSettings, parsePayload } from "../src/evaluate.ts";
import { NodeTasks } from "../src/node.ts";

/** The driver source of a configured evaluation — argv's last token. */
function driverOf(settings: NodeEvaluateSettings): string {
  const argv = settings.argv();
  return argv[argv.length - 1] ?? "";
}

test("evaluate runs node with an inline ES module driver", () => {
  const argv = new NodeEvaluateSettings("tools/openapi.mjs").argv();
  assertEquals(argv.slice(0, 3), ["node", "--input-type=module", "--eval"]);
  assertEquals(argv.length, 4);
});

test("evaluate defaults to the default export and no arguments", () => {
  const driver = driverOf(new NodeEvaluateSettings("tools/openapi.mjs"));
  assertStringIncludes(driver, `pathToFileURL("tools/openapi.mjs")`);
  assertStringIncludes(driver, `namespace["default"]`);
  assertStringIncludes(driver, `await picked(...[])`);
});

test("evaluate embeds the export name and the call arguments as JSON", () => {
  const driver = driverOf(
    new NodeEvaluateSettings("dist/app.module.js")
      .export("openApiDocument")
      .callWith("v1", { pretty: true }, 3),
  );
  assertStringIncludes(driver, `namespace["openApiDocument"]`);
  assertStringIncludes(driver, `await picked(...["v1",{"pretty":true},3])`);
});

test("evaluate cannot be injected through the module path or an argument", () => {
  const driver = driverOf(
    new NodeEvaluateSettings(`a".js`).callWith(`");process.exit(1);//`),
  );
  // Both values survive as JSON string literals — quotes escaped, not closed.
  assertStringIncludes(driver, `pathToFileURL("a\\".js")`);
  assertStringIncludes(driver, `["\\");process.exit(1);//"]`);
});

test("evaluate waits for the module's own exit by default", () => {
  const driver = driverOf(new NodeEvaluateSettings("tools/openapi.mjs"));
  assertStringIncludes(driver, `process.stdout.write("\\n<<<zuke:evaluate>>>"`);
  assertEquals(driver.includes("process.exit"), false);
});

test("exitAfterResult exits from the write callback, once the payload has flushed", () => {
  const driver = driverOf(
    new NodeEvaluateSettings("tools/openapi.mjs").exitAfterResult(),
  );
  // The exit hangs off the *write*, not a statement after it: a bare
  // `process.exit(0)` on the next line can truncate a payload still in the pipe.
  assertStringIncludes(driver, `\\n", () => process.exit(0));`);
});

test("exitAfterResult composes with the export and the call arguments", () => {
  const driver = driverOf(
    new NodeEvaluateSettings("dist/app.module.js")
      .exitAfterResult()
      .export("buildDocument")
      .callWith("v1"),
  );
  assertStringIncludes(driver, `namespace["buildDocument"]`);
  assertStringIncludes(driver, `await picked(...["v1"])`);
  assertStringIncludes(driver, `() => process.exit(0));`);
});

test("parsePayload reads the value between the markers", () => {
  const stdout =
    'boot log\n<<<zuke:evaluate>>>{"openapi":"3.1.0"}<<</zuke:evaluate>>>\n';
  assertEquals(parsePayload(stdout, "m.mjs"), { openapi: "3.1.0" });
});

test("parsePayload takes the last payload, so earlier output cannot pose as one", () => {
  const stdout = [
    "<<<zuke:evaluate>>>1<<</zuke:evaluate>>>",
    "<<<zuke:evaluate>>>2<<</zuke:evaluate>>>",
  ].join("\n");
  assertEquals(parsePayload(stdout, "m.mjs"), 2);
});

test("parsePayload fails loudly when the module produced no result", () => {
  assertThrows(
    () => parsePayload("boot log\n", "tools/openapi.mjs"),
    Error,
    "tools/openapi.mjs produced no result",
  );
  // An opening marker with no close is just as much a missing result.
  assertThrows(
    () => parsePayload("<<<zuke:evaluate>>>{", "tools/openapi.mjs"),
    Error,
    "produced no result",
  );
});

test("parsePayload blames the capture cap when the run was truncated", () => {
  assertThrows(
    () =>
      parsePayload('{"openapi":"3.1.0"}<<</zuke:evaluate>>>', "m.mjs", true),
    Error,
    "larger than the capture cap",
  );
});

test("NodeTasks.evaluate reaches execution", async () => {
  await assertRejects(
    () => NodeTasks.evaluate("tools/openapi.mjs", missingTool),
    ToolNotFoundError,
  );
});

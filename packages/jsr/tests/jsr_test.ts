// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import {
  JsrAddSettings,
  JsrPublishSettings,
  JsrRemoveSettings,
  JsrTasks,
} from "../src/jsr.ts";

Deno.test("the default binary is jsr", () => {
  assertEquals(new JsrPublishSettings().argv()[0], "jsr");
});

Deno.test("publish: bare and all options", () => {
  assertEquals(new JsrPublishSettings().argv().slice(1), ["publish"]);
  assertEquals(
    new JsrPublishSettings()
      .dryRun()
      .allowSlowTypes()
      .allowDirty()
      .noCheck()
      .provenance()
      .token("xyz")
      .argv()
      .slice(1),
    [
      "publish",
      "--dry-run",
      "--allow-slow-types",
      "--allow-dirty",
      "--no-check",
      "--provenance",
      "--token",
      "xyz",
    ],
  );
});

Deno.test("add: packages required; --save-dev", () => {
  assertThrows(
    () => new JsrAddSettings().argv(),
    Error,
    "JsrTasks.add: .packages() requires at least one spec",
  );
  assertEquals(
    new JsrAddSettings().dev().packages("@std/assert", "@std/path").argv()
      .slice(
        1,
      ),
    ["add", "--save-dev", "@std/assert", "@std/path"],
  );
});

Deno.test("remove: names required", () => {
  assertThrows(
    () => new JsrRemoveSettings().argv(),
    Error,
    "JsrTasks.remove: .packages() requires at least one name",
  );
  assertEquals(
    new JsrRemoveSettings().packages("@std/assert").argv().slice(1),
    ["remove", "@std/assert"],
  );
});

Deno.test("every JsrTasks function reaches execution", async () => {
  await assertRejects(() => JsrTasks.publish(missingTool), ToolNotFoundError);
  await assertRejects(
    () => JsrTasks.add((s) => missingTool(s).packages("@std/assert")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => JsrTasks.remove((s) => missingTool(s).packages("@std/assert")),
    ToolNotFoundError,
  );
});

Deno.test("jsr: conforms to the wrapper contract", async () => {
  await assertWrapperConformance(() => new JsrPublishSettings(), "jsr", {
    resolution: "path",
  });
});

Deno.test("the publish token is registered as a secret, and still in argv", () => {
  // Both halves, because only one of them can be fixed here. `jsr publish`
  // takes the token as a flag and offers no environment variable, so the value
  // reaches the child's argv where `ps` and `/proc/<pid>/cmdline` expose it.
  // What the wrapper can do is register it, so every *rendering* of the command
  // masks it — and the JSDoc says exactly that rather than implying more.
  class Spy extends JsrPublishSettings {
    readonly marked: string[] = [];
    protected override markSecret(value: string): void {
      this.marked.push(value);
    }
  }
  const settings = new Spy().token("publish-token");
  assertEquals(settings.marked, ["publish-token"]);
  // Pinned deliberately: a later change that drops the flag would break
  // publishing, and one that "fixes" the exposure by inventing an environment
  // variable would be shipping a route the tool does not read.
  assertEquals(settings.argv().includes("--token"), true);
});

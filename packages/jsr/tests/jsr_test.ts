import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
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

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zuke-no-such-jsr-xyz");
};

Deno.test("every JsrTasks function reaches execution", async () => {
  await assertRejects(() => JsrTasks.publish(missing), ToolNotFoundError);
  await assertRejects(
    () => JsrTasks.add((s) => missing(s).packages("@std/assert")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => JsrTasks.remove((s) => missing(s).packages("@std/assert")),
    ToolNotFoundError,
  );
});

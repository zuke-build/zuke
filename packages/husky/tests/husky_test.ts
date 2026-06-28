import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import {
  HuskyInitSettings,
  HuskyInstallSettings,
  HuskyTasks,
} from "../src/husky.ts";

Deno.test("the default binary is husky and the bare install emits just husky", () => {
  assertEquals(new HuskyInstallSettings().argv(), ["husky"]);
  assertEquals(new HuskyInitSettings().argv(), ["husky", "init"]);
});

Deno.test("init with dir renders the positional directory", () => {
  assertEquals(
    new HuskyInitSettings().dir(".husky").argv(),
    ["husky", "init", ".husky"],
  );
});

Deno.test("install with dir renders the positional directory", () => {
  assertEquals(
    new HuskyInstallSettings().dir(".husky").argv(),
    ["husky", ".husky"],
  );
});

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zz-no-such-husky-zz");
};

Deno.test("HuskyTasks.init reaches execution", async () => {
  await assertRejects(() => HuskyTasks.init(missing), ToolNotFoundError);
});

Deno.test("HuskyTasks.install reaches execution", async () => {
  await assertRejects(() => HuskyTasks.install(missing), ToolNotFoundError);
});

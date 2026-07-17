import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import { NpxSettings, NpxTasks } from "../src/npx.ts";

Deno.test("the default binary is npx", () => {
  assertEquals(new NpxSettings().command("x").argv()[0], "npx");
});

Deno.test("npx: command required (or a call)", () => {
  assertThrows(
    () => new NpxSettings().argv(),
    Error,
    "NpxTasks.npx: .command() or .call() is required",
  );
});

Deno.test("npx: bare command", () => {
  assertEquals(new NpxSettings().command("cowsay").argv().slice(1), ["cowsay"]);
});

Deno.test("npx: packages, --yes, --ignore-existing, forwarded args", () => {
  assertEquals(
    new NpxSettings()
      .package("cowsay@1", "left-pad")
      .yes()
      .ignoreExisting()
      .command("cowsay")
      .execArgs("hello", 1)
      .argv()
      .slice(1),
    [
      "--package=cowsay@1",
      "--package=left-pad",
      "--yes",
      "--ignore-existing",
      "cowsay",
      "hello",
      "1",
    ],
  );
});

Deno.test("npx: --no suppresses auto-install", () => {
  assertEquals(new NpxSettings().no().command("tsc").argv().slice(1), [
    "--no",
    "tsc",
  ]);
});

Deno.test("npx: --call runs a string without a command", () => {
  assertEquals(
    new NpxSettings().package("cowsay").call("cowsay hi").argv().slice(1),
    ["--package=cowsay", "--call", "cowsay hi"],
  );
});

/**
 * Point a settings object at a guaranteed-missing binary with the shim
 * fallback disabled, so the NpxTasks function reaches execution WITHOUT ever
 * invoking a real npx (tests must stay hermetic).
 */
const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zuke-no-such-npx-xyz");
};

Deno.test("NpxTasks.npx reaches execution", async () => {
  await assertRejects(
    () => NpxTasks.npx((s) => missing(s).command("x")),
    ToolNotFoundError,
  );
});

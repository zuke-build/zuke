import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import {
  BunAddSettings,
  BunInstallSettings,
  BunRemoveSettings,
  BunRunSettings,
  BunTasks,
  BunTestSettings,
  BunXSettings,
} from "../src/bun.ts";

Deno.test("the default binary is bun", () => {
  assertEquals(new BunInstallSettings().argv()[0], "bun");
});

Deno.test("install: bare, --production, --frozen-lockfile", () => {
  assertEquals(new BunInstallSettings().argv().slice(1), ["install"]);
  assertEquals(
    new BunInstallSettings().production().frozenLockfile().argv().slice(1),
    ["install", "--production", "--frozen-lockfile"],
  );
});

Deno.test("add: packages required; --dev, --optional, --exact, --global", () => {
  assertThrows(
    () => new BunAddSettings().argv(),
    Error,
    "BunTasks.add: .packages() requires at least one spec",
  );
  assertEquals(
    new BunAddSettings()
      .dev()
      .optional()
      .exact()
      .global()
      .packages("zod@3", "hono")
      .argv()
      .slice(1),
    ["add", "--dev", "--optional", "--exact", "--global", "zod@3", "hono"],
  );
});

Deno.test("remove: names required", () => {
  assertThrows(
    () => new BunRemoveSettings().argv(),
    Error,
    "BunTasks.remove: .packages() requires at least one name",
  );
  assertEquals(
    new BunRemoveSettings().packages("zod", "hono").argv().slice(1),
    ["remove", "zod", "hono"],
  );
});

Deno.test("run: script required; forwarded args", () => {
  assertThrows(
    () => new BunRunSettings().argv(),
    Error,
    "BunTasks.run: .script() is required",
  );
  assertEquals(
    new BunRunSettings().script("build").scriptArgs("--watch", 1).argv().slice(
      1,
    ),
    ["run", "build", "--watch", "1"],
  );
});

Deno.test("x: command required; forwarded args", () => {
  assertThrows(
    () => new BunXSettings().argv(),
    Error,
    "BunTasks.x: .command() is required",
  );
  assertEquals(
    new BunXSettings().command("cowsay").execArgs("hello").argv().slice(1),
    ["x", "cowsay", "hello"],
  );
});

Deno.test("test: bare, --coverage, --bail, and paths", () => {
  assertEquals(new BunTestSettings().argv().slice(1), ["test"]);
  assertEquals(
    new BunTestSettings().coverage().bail().paths("src/**").argv().slice(1),
    ["test", "--coverage", "--bail", "src/**"],
  );
});

/**
 * Point a settings object at a guaranteed-missing binary with the shim
 * fallback disabled, so each BunTasks function reaches execution WITHOUT
 * ever invoking a real bun (tests must stay hermetic).
 */
const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zuke-no-such-bun-xyz");
};

Deno.test("every BunTasks function reaches execution", async () => {
  await assertRejects(() => BunTasks.install(missing), ToolNotFoundError);
  await assertRejects(
    () => BunTasks.add((s) => missing(s).packages("x")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => BunTasks.remove((s) => missing(s).packages("x")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => BunTasks.run((s) => missing(s).script("x")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => BunTasks.x((s) => missing(s).command("x")),
    ToolNotFoundError,
  );
  await assertRejects(() => BunTasks.test(missing), ToolNotFoundError);
});

import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import {
  YarnAddSettings,
  YarnDlxSettings,
  YarnInstallSettings,
  YarnRemoveSettings,
  YarnRunSettings,
  YarnTasks,
} from "../src/yarn.ts";

Deno.test("the default binary is yarn", () => {
  assertEquals(new YarnInstallSettings().argv()[0], "yarn");
});

Deno.test("install: bare, --immutable (Berry), --frozen-lockfile (Classic)", () => {
  assertEquals(new YarnInstallSettings().argv().slice(1), ["install"]);
  assertEquals(
    new YarnInstallSettings().immutable().frozenLockfile().argv().slice(1),
    ["install", "--immutable", "--frozen-lockfile"],
  );
});

Deno.test("add: packages required; --dev, --exact", () => {
  assertThrows(
    () => new YarnAddSettings().argv(),
    Error,
    "YarnTasks.add: .packages() requires at least one spec",
  );
  assertEquals(
    new YarnAddSettings()
      .dev()
      .exact()
      .packages("typescript@5", "eslint")
      .argv()
      .slice(1),
    ["add", "--dev", "--exact", "typescript@5", "eslint"],
  );
});

Deno.test("remove: names required", () => {
  assertThrows(
    () => new YarnRemoveSettings().argv(),
    Error,
    "YarnTasks.remove: .packages() requires at least one name",
  );
  assertEquals(
    new YarnRemoveSettings().packages("eslint").argv().slice(1),
    ["remove", "eslint"],
  );
});

Deno.test("run: script required; forwarded args", () => {
  assertThrows(
    () => new YarnRunSettings().argv(),
    Error,
    "YarnTasks.run: .script() is required",
  );
  assertEquals(
    new YarnRunSettings().script("build").scriptArgs("--watch", 1).argv().slice(
      1,
    ),
    ["run", "build", "--watch", "1"],
  );
});

Deno.test("dlx: command required; --package and forwarded args", () => {
  assertThrows(
    () => new YarnDlxSettings().argv(),
    Error,
    "YarnTasks.dlx: .command() is required",
  );
  assertEquals(
    new YarnDlxSettings()
      .package("create-react-app")
      .command("create-react-app")
      .execArgs("my-app")
      .argv()
      .slice(1),
    ["dlx", "--package", "create-react-app", "create-react-app", "my-app"],
  );
});

/**
 * Point a settings object at a guaranteed-missing binary with the shim
 * fallback disabled, so each YarnTasks function reaches execution WITHOUT
 * ever invoking a real yarn (tests must stay hermetic).
 */
const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zuke-no-such-yarn-xyz");
};

Deno.test("every YarnTasks function reaches execution", async () => {
  await assertRejects(() => YarnTasks.install(missing), ToolNotFoundError);
  await assertRejects(
    () => YarnTasks.add((s) => missing(s).packages("x")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => YarnTasks.remove((s) => missing(s).packages("x")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => YarnTasks.run((s) => missing(s).script("x")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => YarnTasks.dlx((s) => missing(s).command("x")),
    ToolNotFoundError,
  );
});

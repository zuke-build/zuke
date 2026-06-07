import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import {
  NpmCiSettings,
  NpmExecSettings,
  NpmInstallSettings,
  NpmPublishSettings,
  NpmRunSettings,
  NpmTasks,
  NpmVersionSettings,
} from "../src/npm.ts";

Deno.test("the default binary is npm", () => {
  assertEquals(new NpmInstallSettings().argv()[0], "npm");
});

Deno.test("install: bare, packages, --save-dev, --save-exact", () => {
  assertEquals(new NpmInstallSettings().argv().slice(1), ["install"]);
  assertEquals(
    new NpmInstallSettings()
      .saveDev()
      .saveExact()
      .packages("typescript@5", "eslint")
      .argv()
      .slice(1),
    ["install", "--save-dev", "--save-exact", "typescript@5", "eslint"],
  );
});

Deno.test("ci: bare and with --omit flags", () => {
  assertEquals(new NpmCiSettings().argv().slice(1), ["ci"]);
  assertEquals(
    new NpmCiSettings().omit("dev").omit("optional").argv().slice(1),
    ["ci", "--omit=dev", "--omit=optional"],
  );
});

Deno.test("run: script required; workspace, --if-present, forwarded args", () => {
  assertThrows(
    () => new NpmRunSettings().argv(),
    Error,
    "NpmTasks.run: .script() is required",
  );
  assertEquals(
    new NpmRunSettings()
      .script("build")
      .workspace("app")
      .ifPresent()
      .scriptArgs("--watch", 1)
      .argv()
      .slice(1),
    ["run", "--workspace=app", "--if-present", "build", "--", "--watch", "1"],
  );
});

Deno.test("run: no -- separator when there are no script args", () => {
  assertEquals(new NpmRunSettings().script("build").argv().slice(1), [
    "run",
    "build",
  ]);
});

Deno.test("exec: command required; --yes, --package, forwarded args", () => {
  assertThrows(
    () => new NpmExecSettings().argv(),
    Error,
    "NpmTasks.exec: .command() is required",
  );
  assertEquals(
    new NpmExecSettings()
      .yes()
      .package("cowsay@1")
      .command("cowsay")
      .execArgs("hello")
      .argv()
      .slice(1),
    ["exec", "--yes", "--package=cowsay@1", "cowsay", "--", "hello"],
  );
});

Deno.test("publish: tag, access, --dry-run, otp", () => {
  assertEquals(new NpmPublishSettings().argv().slice(1), ["publish"]);
  assertEquals(
    new NpmPublishSettings()
      .tag("next")
      .access("public")
      .dryRun()
      .otp("123456")
      .argv()
      .slice(1),
    [
      "publish",
      "--tag=next",
      "--access=public",
      "--dry-run",
      "--otp=123456",
    ],
  );
});

Deno.test("version: bump required; message and --no-git-tag-version", () => {
  assertThrows(
    () => new NpmVersionSettings().argv(),
    Error,
    "NpmTasks.version: .bump() is required",
  );
  assertEquals(
    new NpmVersionSettings()
      .bump("patch")
      .message("release %s")
      .noGitTagVersion()
      .argv()
      .slice(1),
    ["version", "patch", "--message", "release %s", "--no-git-tag-version"],
  );
});

/**
 * Point a settings object at a guaranteed-missing binary with the shim
 * fallback disabled, so each NpmTasks function reaches execution WITHOUT
 * ever invoking a real npm (tests must stay hermetic).
 */
const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zuke-no-such-npm-xyz");
};

Deno.test("every NpmTasks function reaches execution", async () => {
  await assertRejects(() => NpmTasks.install(missing), ToolNotFoundError);
  await assertRejects(() => NpmTasks.ci(missing), ToolNotFoundError);
  await assertRejects(
    () => NpmTasks.run((s) => missing(s).script("x")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => NpmTasks.exec((s) => missing(s).command("x")),
    ToolNotFoundError,
  );
  await assertRejects(() => NpmTasks.publish(missing), ToolNotFoundError);
  await assertRejects(
    () => NpmTasks.version((s) => missing(s).bump("patch")),
    ToolNotFoundError,
  );
});

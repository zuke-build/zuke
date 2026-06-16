import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import { GhSettings, GhTasks } from "../src/gh.ts";

Deno.test("the default binary is gh", () => {
  assertEquals(new GhSettings().argv(), ["gh"]);
});

Deno.test("gh: command, repo, then flags", () => {
  const argv = new GhSettings()
    .command("release", "create", "v1.2.3")
    .repo("acme/app")
    .flag("title", "v1.2.3")
    .flag("generate-notes")
    .argv();
  assertEquals(argv, [
    "gh",
    "release",
    "create",
    "v1.2.3",
    "--repo",
    "acme/app",
    "--title",
    "v1.2.3",
    "--generate-notes",
  ]);
});

Deno.test("gh: minimal runs just the command", () => {
  assertEquals(new GhSettings().command("pr", "list").argv(), [
    "gh",
    "pr",
    "list",
  ]);
});

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zz-no-such-gh-zz");
};

Deno.test("GhTasks.run reaches execution", async () => {
  await assertRejects(
    () => GhTasks.run((s) => missing(s.command("auth", "status"))),
    ToolNotFoundError,
  );
});

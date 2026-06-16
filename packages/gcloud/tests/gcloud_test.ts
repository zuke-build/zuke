import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import { GcloudSettings, GcloudTasks } from "../src/gcloud.ts";

Deno.test("the default binary is gcloud", () => {
  assertEquals(new GcloudSettings().argv(), ["gcloud"]);
});

Deno.test("gcloud: command, global flags, then extra flags", () => {
  const argv = new GcloudSettings()
    .command("run", "deploy", "api")
    .project("proj").account("me@example.com").configuration("default")
    .format("json").verbosity("info").noPrompt()
    .flag("region", "us-central1").flag("async")
    .argv();
  assertEquals(argv, [
    "gcloud",
    "run",
    "deploy",
    "api",
    "--project",
    "proj",
    "--account",
    "me@example.com",
    "--configuration",
    "default",
    "--format",
    "json",
    "--verbosity",
    "info",
    "--quiet",
    "--region",
    "us-central1",
    "--async",
  ]);
});

Deno.test("gcloud: minimal runs just the command", () => {
  assertEquals(new GcloudSettings().command("auth", "list").argv(), [
    "gcloud",
    "auth",
    "list",
  ]);
});

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zz-no-such-gcloud-zz");
};

Deno.test("GcloudTasks.run reaches execution", async () => {
  await assertRejects(
    () => GcloudTasks.run((s) => missing(s.command("version"))),
    ToolNotFoundError,
  );
});

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import {
  ReleasePleaseGithubReleaseSettings,
  ReleasePleaseReleasePrSettings,
  ReleasePleaseTasks,
} from "../src/release_please.ts";

Deno.test("the default binary is release-please", () => {
  assertEquals(
    new ReleasePleaseReleasePrSettings().argv()[0],
    "release-please",
  );
});

Deno.test("release-pr: bare subcommand and all options", () => {
  assertEquals(
    new ReleasePleaseReleasePrSettings().argv().slice(1),
    ["release-pr"],
  );
  assertEquals(
    new ReleasePleaseReleasePrSettings()
      .token("xyz")
      .repoUrl("owner/repo")
      .targetBranch("main")
      .configFile(".release-please-config.json")
      .manifestFile(".release-please-manifest.json")
      .dryRun()
      .debug()
      .argv()
      .slice(1),
    [
      "release-pr",
      "--token",
      "xyz",
      "--repo-url",
      "owner/repo",
      "--target-branch",
      "main",
      "--config-file",
      ".release-please-config.json",
      "--manifest-file",
      ".release-please-manifest.json",
      "--dry-run",
      "--debug",
    ],
  );
});

Deno.test("github-release: subcommand token", () => {
  assertEquals(
    new ReleasePleaseGithubReleaseSettings().token("t").argv().slice(1),
    ["github-release", "--token", "t"],
  );
});

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zuke-no-such-release-please-xyz");
};

Deno.test("every ReleasePleaseTasks function reaches execution", async () => {
  await assertRejects(
    () => ReleasePleaseTasks.releasePr(missing),
    ToolNotFoundError,
  );
  await assertRejects(
    () => ReleasePleaseTasks.githubRelease(missing),
    ToolNotFoundError,
  );
});

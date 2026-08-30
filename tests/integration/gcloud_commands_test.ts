// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration coverage for `@zuke/gcloud`'s typed commands: real builds, driven
 * through the CLI `main()` entry point, proving the refusals reach a target as
 * a failed build and that the value readers fail rather than hand back a
 * confident empty string when gcloud cannot be found.
 *
 * The tests stay hermetic. gcloud is an ambient tool, so nothing here runs a
 * real one — every task is pointed at a binary that cannot exist, which is also
 * the only way to assert the readers' failure path on a runner that may or may
 * not have the SDK installed.
 *
 * @module
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { GcloudTasks } from "../../packages/gcloud/mod.ts";
import { runCli } from "./_harness.ts";

/** A tool path that cannot exist, so resolution fails before any process runs. */
const ABSENT = "/nonexistent/zuke-test-gcloud";

Deno.test("a settings refusal fails the target and names the fix", async () => {
  class RefusalBuild extends Build {
    // gcloud: "At most one of --config | --pack | --tag can be specified."
    submit = target().executes(async () => {
      await GcloudTasks.buildsSubmit((s) =>
        s.toolPath(ABSENT).tag("gcr.io/p/i").config("cloudbuild.yaml")
      );
    });
    // The pairing gcloud accepts silently, where the difference is whether the
    // service is reachable by anyone on the internet.
    deploy = target().executes(async () => {
      await GcloudTasks.runDeploy((s) =>
        s.toolPath(ABSENT).service("api").allowUnauthenticated()
          .noAllowUnauthenticated()
      );
    });
  }
  const submit = await runCli(RefusalBuild, ["submit"]);
  assertEquals(submit.code, 1);
  assertEquals(submit.err.includes("at most one of --config"), true);

  const deploy = await runCli(RefusalBuild, ["deploy"]);
  assertEquals(deploy.code, 1);
  assertEquals(deploy.err.includes("publicly invokable"), true);
});

Deno.test("the value readers fail on an absent gcloud rather than returning empty", async () => {
  // These return strings a build interpolates into a URL, an Authorization
  // header, or a secret. An empty one that looked like an answer would fail far
  // from the cause, so resolution has to surface here.
  const produced: string[] = [];
  class ReaderBuild extends Build {
    token = target().executes(async () => {
      produced.push(await GcloudTasks.accessToken((s) => s.toolPath(ABSENT)));
    });
    url = target().executes(async () => {
      produced.push(
        await GcloudTasks.runServiceUrl((s) =>
          s.toolPath(ABSENT).service("api").region("us-central1")
        ),
      );
    });
    project = target().executes(async () => {
      produced.push(
        await GcloudTasks.configValue((s) =>
          s.toolPath(ABSENT).property("project")
        ),
      );
    });
    secret = target().executes(async () => {
      produced.push(
        await GcloudTasks.secretValue((s) => s.toolPath(ABSENT).secret("k")),
      );
    });
  }
  for (const name of ["token", "url", "project", "secret"]) {
    const { code } = await runCli(ReaderBuild, [name]);
    assertEquals(code, 1, name);
  }
  assertEquals(produced, []);
});

Deno.test("a deploy pipeline runs its targets in dependency order", async () => {
  const order: string[] = [];
  class PipelineBuild extends Build {
    authenticate = target().description("activate the service account")
      .executes(() => {
        order.push("authenticate");
      });
    build = target().description("submit the image").dependsOn(
      this.authenticate,
    )
      .executes(() => {
        order.push("build");
      });
    deploy = target().description("roll it out").dependsOn(this.build)
      .executes(() => {
        order.push("deploy");
      });
  }
  const { code } = await runCli(PipelineBuild, ["deploy"]);
  assertEquals(code, 0);
  assertEquals(order, ["authenticate", "build", "deploy"]);

  const listed = await runCli(PipelineBuild, ["--list"]);
  assertEquals(listed.code, 0);
  assertEquals(listed.out.includes("roll it out"), true);
});

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the broadened `@zuke/kubectl` surface driven from a real build
 * through the CLI `main()`. The unit tests assert argv; this proves the tasks
 * are reachable as a target's body — that a value-returning one fails the
 * build when kubectl is missing rather than reporting an empty cluster, and
 * that a settings class's own validation surfaces as a failed target.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { missingTool } from "../../packages/core/src/tooling_conformance.ts";
import { KubectlTasks } from "../../packages/kubectl/mod.ts";
import { runCli } from "./_harness.ts";

class DeployBuild extends Build {
  drift = target()
    .description("report whether the manifests differ from the cluster")
    .executes(async () => {
      const changed = await KubectlTasks.diffHasChanges((s) =>
        missingTool(s).file("k8s/").serverSide()
      );
      console.log(`drift=${changed}`);
    });

  permitted = target()
    .description("check the deploy credentials before spending a rollout")
    .executes(async () => {
      const allowed = await KubectlTasks.canI((s) =>
        missingTool(s).verb("create").resource("deployments")
      );
      console.log(`allowed=${allowed}`);
    });

  cluster = target()
    .description("report which cluster the build is pointed at")
    .executes(async () => {
      const context = await KubectlTasks.currentContext((s) => missingTool(s));
      console.log(`context=${context}`);
    });

  inventory = target()
    .description("report the pods the release owns")
    .executes(async () => {
      const entries = await KubectlTasks.getEntries((s) =>
        missingTool(s).resource("pods").selector("app=api")
      );
      console.log(`pods=${entries.length}`);
    });

  why = target()
    .description("read the events behind a stalled rollout")
    .executes(async () => {
      const events = await KubectlTasks.eventEntries((s) =>
        missingTool(s).namespace("prod").forResource("deploy/api")
      );
      console.log(`events=${events.length}`);
    });

  hold = target()
    .description("pause the rollout half way through a canary")
    .executes(async () => {
      await KubectlTasks.rollout((s) =>
        missingTool(s).pause().resource("deployment/api")
      );
      console.log("paused");
    });

  collect = target()
    .description("copy a report out of the pod that produced it")
    .executes(async () => {
      await KubectlTasks.cp((s) =>
        missingTool(s).from("prod/api-0:/out/report.xml").to("reports/")
      );
      console.log("collected");
    });

  maintain = target()
    .description("take a node out of service for maintenance")
    .executes(async () => {
      await KubectlTasks.drain((s) =>
        missingTool(s).node("worker-1").ignoreDaemonSets().deleteEmptyDirData()
      );
      console.log("drained");
    });

  mistake = target()
    .description("ask for a diff of nothing")
    .executes(async () => {
      // The settings refuse this before kubectl is ever spawned: there is
      // nothing to diff without a manifest or a kustomization.
      await KubectlTasks.diff((s) => missingTool(s).serverSide());
      console.log("diffed");
    });
}

const FAILS_ON_MISSING_KUBECTL: Array<[string, string]> = [
  ["drift", "drift="],
  ["permitted", "allowed="],
  ["cluster", "context="],
  ["inventory", "pods="],
  ["why", "events="],
  ["hold", "paused"],
  ["collect", "collected"],
  ["maintain", "drained"],
];

for (const [name, marker] of FAILS_ON_MISSING_KUBECTL) {
  Deno.test(`the ${name} target fails with the tool-not-found error`, async () => {
    const { code, out, err } = await runCli(DeployBuild, [name]);
    assertEquals(code, 1);
    assertStringIncludes(err, "zuke-no-such-tool-xyz");
    assertEquals(out.includes(marker), false);
  });
}

Deno.test("a settings validation failure fails the target, naming the fix", async () => {
  const { code, out, err } = await runCli(DeployBuild, ["mistake"]);
  assertEquals(code, 1);
  assertStringIncludes(err, ".file() or .kustomize() is required");
  assertEquals(out.includes("diffed"), false);
});

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: `@zuke/argo-rollouts` driven from a real build through the CLI
 * `main()`. The unit tests assert argv; this proves the tasks are reachable as
 * target bodies, render the right command lines in plan order under a dry run,
 * and compose with `.onFailure(...)` so a failed status check aborts the
 * rollout through the run's compensation walk.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import {
  Build,
  defaultStateHost,
  FileSystemStateStore,
  target,
} from "../../packages/core/mod.ts";
import { missingTool } from "../../packages/core/src/tooling_conformance.ts";
import { ArgoRolloutsTasks } from "../../packages/argo-rollouts/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";

/** A rollout chain: start it, wait on it, promote it; abort on a bad status. */
class Rollout extends Build {
  start = target()
    .dryRunnable()
    .executes(() =>
      ArgoRolloutsTasks.setImage((s) =>
        s.name("api").image("api", "acme/api:1.4.0").namespace("prod")
      )
    )
    .onCancel(() => this.abort);
  wait = target()
    .dependsOn(this.start)
    .dryRunnable()
    .onFailure(() => "cancel-run")
    .executes(() =>
      ArgoRolloutsTasks.status((s) =>
        s.name("api").namespace("prod").timeout("10m")
      )
    );
  promote = target()
    .dependsOn(this.wait)
    .dryRunnable()
    .executes(() =>
      ArgoRolloutsTasks.promote((s) => s.name("api").namespace("prod").full())
    );
  abort = target()
    .unlisted()
    .executes(() => ArgoRolloutsTasks.abort((s) => missingTool(s).name("api")));
}

Deno.test("a dry run renders the rollout's command lines in plan order", async () => {
  const { code, out } = await runCli(Rollout, ["promote", "--dry-run"]);
  assertEquals(code, 0);
  const setImage = out.indexOf(
    "kubectl-argo-rollouts set image api api=acme/api:1.4.0 --namespace prod",
  );
  const status = out.indexOf(
    "kubectl-argo-rollouts status api --namespace prod --timeout 10m",
  );
  const promote = out.indexOf(
    "kubectl-argo-rollouts promote api --namespace prod --full",
  );
  // Each command line is present, and they appear in the plan's order.
  assertEquals(setImage >= 0, true, "set image was not rendered");
  assertEquals(status > setImage, true, "status did not follow set image");
  assertEquals(promote > status, true, "promote did not follow status");
});

/** The same chain, where the status check cannot reach the plugin. */
class BrokenRollout extends Build {
  start = target()
    .executes((ctx) => ctx.state.set({ image: "acme/api:1.4.0" }))
    .onCancel(() => this.abort);
  wait = target()
    .dependsOn(this.start)
    .onFailure(() => "cancel-run")
    .executes(() =>
      ArgoRolloutsTasks.status((s) => missingTool(s).name("api"))
    );
  abort = target()
    .unlisted()
    .executes(() => ArgoRolloutsTasks.abort((s) => missingTool(s).name("api")));
}

Deno.test("a failed status check aborts the rollout through the compensation walk", async () => {
  await withStateDir(async (dir) => {
    const { code, out, err } = await runCli(BrokenRollout, ["wait"]);
    assertEquals(code, 1);
    assertStringIncludes(out, "wait failed and its .onFailure(...)");
    assertStringIncludes(err, "zuke-no-such-tool-xyz");

    const store = new FileSystemStateStore(dir, defaultStateHost);
    const [run] = await store.listRuns({});
    const record = (await store.getRun(run.id))?.record;
    assertEquals(record?.status, "cancelled");
    // The abort ran as the start target's compensation. It could not reach
    // the plugin either, which the walk records rather than stopping on.
    const compensate = record?.events.find((e) => e.tool === "compensate");
    assertEquals(compensate?.outcome, "error");
  });
});

/** A build that calls a task without its required operand. */
class Mistake extends Build {
  oops = target().executes(() =>
    ArgoRolloutsTasks.promote((s) => missingTool(s))
  );
}

Deno.test("a settings validation failure fails the target, naming the fix", async () => {
  const { code, err } = await runCli(Mistake, ["oops"]);
  assertEquals(code, 1);
  assertStringIncludes(err, "ArgoRolloutsTasks.promote: .name() is required.");
});

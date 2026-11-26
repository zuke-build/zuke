// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Replay every case under `packages/engine/conformance/` through the real CLI
 * `main()`: the fake worker answers the case's manifest, and the run must make
 * exactly the calls the case lists, exit as it says, and list what it says.
 * The suite itself is `tests/_conformance.ts`; the e2e suite runs the same
 * cases through the `zuke` binary.
 */

import { EnvTasks, RuntimeTasks } from "../../packages/core/mod.ts";
import { WorkerHost } from "../../packages/engine/src/host.ts";
import { materialize } from "../../packages/engine/src/materialize.ts";
import { conformanceSuite, WORKER_COMMAND } from "../_conformance.ts";
import { runCli } from "./_harness.ts";
import { RUN } from "../_eval.ts";

/** The engine entrypoint, run as a process for the engine-death case. */
const ENGINE = `${import.meta.dirname ?? "."}/../../packages/engine/mod.ts`;
/**
 * The workspace config, which a run from a temp directory would not find. The
 * flag takes an OS path, never a URL, so it is built from the module's
 * directory as the OS names it.
 */
const CONFIG = `${import.meta.dirname ?? "."}/../../deno.json`;

await conformanceSuite("conformance", () =>
  Promise.resolve({
    // Start a fake worker on `manifest`, materialise its build, run it.
    run: async (manifest, argv) => {
      EnvTasks.set("ZUKE_FAKE_PLAN", JSON.stringify(manifest));
      EnvTasks.delete("ZUKE_FAKE_BAD_TOKEN");
      const host = await WorkerHost.start({
        command: WORKER_COMMAND,
        cwd: RuntimeTasks.cwd(),
        graceMs: 1_000,
      });
      try {
        return await runCli(materialize(await host.describe(), host), argv);
      } finally {
        await host.finish(0);
      }
    },
    // Deno needs the workspace config; Node resolves the workspace's imports
    // through its node_modules.
    engine: RuntimeTasks.facts().name === "deno"
      ? [RuntimeTasks.execPath(), ...RUN, "--config", CONFIG, ENGINE]
      : [RuntimeTasks.execPath(), ENGINE],
  }));

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for starting the Python SDK's engine sync from the release pipeline:
 * which workflow is dispatched, where, and with which token.
 */

import { assertEquals } from "../packages/core/tests/_assert.ts";
import { GhWorkflowRunSettings } from "@zuke/gh";
import {
  PYTHON_REPO,
  PYTHON_SYNC_WORKFLOW,
  startPythonSync,
} from "../build/python_sync.ts";

Deno.test("startPythonSync dispatches the SDK's sync workflow on main, as the app token", async () => {
  const argvs: string[][] = [];
  const envs: Record<string, string>[] = [];
  await startPythonSync("ghs_app", (configure) => {
    // Settings that also record the environment the dispatch is given.
    class Recording extends GhWorkflowRunSettings {
      override env(record: Record<string, string>): this {
        envs.push(record);
        return super.env(record);
      }
    }
    argvs.push(configure(new Recording()).argv().slice(1));
    return Promise.resolve();
  });
  assertEquals(PYTHON_REPO, "zuke-build/zuke-python");
  const [argv] = argvs;
  assertEquals(argv.slice(0, 3), ["workflow", "run", PYTHON_SYNC_WORKFLOW]);
  assertEquals(argv[argv.indexOf("--ref") + 1], "main");
  assertEquals(argv[argv.indexOf("--repo") + 1], PYTHON_REPO);
  assertEquals(envs, [{ GH_TOKEN: "ghs_app" }]);
});

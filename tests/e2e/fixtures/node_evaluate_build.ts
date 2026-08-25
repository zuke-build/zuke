// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Fixture for {@link file://../node_evaluate_e2e.ts}: evaluate a Node module
 * that never lets Node exit. The `hanging` target opts into
 * `exitAfterResult`, so it must print the value and finish; `waiting` is the
 * same evaluation without the option, which is the hang it exists to contrast
 * with — it is only ever run under a timeout.
 *
 * @module
 */

import { Build, run, target } from "../../../packages/core/mod.ts";
import { NodeTasks } from "../../../packages/node/mod.ts";

/** The module to evaluate, resolved against this file rather than the cwd. */
const MODULE = `${import.meta.dirname}/hanging_module.mjs`;

class NodeEvaluateBuild extends Build {
  hanging = target()
    .description("evaluate a module that never exits, and stop waiting for it")
    .executes(async () => {
      const value = await NodeTasks.evaluate(
        MODULE,
        (s) => s.export("build").exitAfterResult(),
      );
      console.log(`VALUE=${JSON.stringify(value)}`);
    });

  waiting = target()
    .description("the same evaluation without the option — never settles")
    .executes(async () => {
      const value = await NodeTasks.evaluate(MODULE, (s) => s.export("build"));
      console.log(`VALUE=${JSON.stringify(value)}`);
    });
}

await run(NodeEvaluateBuild);

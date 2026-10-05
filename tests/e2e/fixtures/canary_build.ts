// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Fixture for {@link file://../canary_e2e.ts}: a durable canary on a platform
 * that appends every call — with what its state held — to the file named by
 * `ZUKE_E2E_CANARY_LOG`. Each invocation is its own `deno` process; the state
 * directory and the log are all they share. `ZUKE_E2E_CANARY_BAKE` sets the
 * bake, and `ZUKE_E2E_CANARY_UNHEALTHY` makes the analysis fail.
 *
 * @module
 */

import { Build, run, target } from "../../../packages/core/mod.ts";
import { canary, type CanaryContext } from "../../../packages/canary/mod.ts";

const LOG = Deno.env.get("ZUKE_E2E_CANARY_LOG") ?? "canary.log";
const BAKE = Deno.env.get("ZUKE_E2E_CANARY_BAKE") ?? "1s";
const UNHEALTHY = Deno.env.get("ZUKE_E2E_CANARY_UNHEALTHY") === "1";

/** Append one line to the shared log. */
async function log(line: string): Promise<void> {
  await Deno.writeTextFile(LOG, `${line}\n`, { append: true });
}

/** What the platform state says, for the log. */
function held(ctx: CanaryContext, key: string): string {
  return String(ctx.state.get()[key] ?? "-");
}

class CanaryBuild extends Build {
  rollout = canary((c) =>
    c.platform({
      exposure: "traffic",
      describe: () => "e2e service",
      stage: async (ctx) => {
        await ctx.state.set({ candidate: `rev-${Deno.pid}`, stable: "rev-1" });
        await log("stage");
      },
      expose: async (percent, ctx) => {
        await log(`expose ${percent} ${held(ctx, "candidate")}`);
        return percent;
      },
      promote: (ctx) => log(`promote ${held(ctx, "candidate")}`),
      abort: (ctx) => log(`abort ${held(ctx, "stable")}`),
    })
      .steps(25)
      .bake(BAKE)
      .durable()
      .analysis({
        validate: async ({ exposure }) => {
          await log(`analyse ${exposure}`);
          if (UNHEALTHY) throw new Error("canary unhealthy");
        },
      })
  );

  ship = target()
    .description("after the rollout")
    .dependsOn(this.rollout.promote)
    .executes(() => log("shipped"));
}

await run(CanaryBuild);

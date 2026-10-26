// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A canary rollout you can run with nothing but Deno. The candidate takes
 * 10 % and then 50 % of the traffic, each step bakes while an HTTP probe
 * checks the router, and it is promoted — or, when it fails, rolled back.
 *
 *   zuke ship          # 10 % → 50 % → promoted
 *   zuke ship --broken # the probe fails; rolled back
 *   zuke --list        # every target the rollout makes
 */
import { Build, parameter, run, target } from "jsr:@zuke/core@^1";
import { canary, httpProbe } from "jsr:@zuke/canary@^1";
import { localRouter } from "./local_router.ts";

/** The release build. Exported so the repository's tests can drive it. */
export class Release extends Build {
  port = parameter("Port the router listens on (0 picks a free one)")
    .number().default(8080);
  broken = parameter("Roll out a candidate that answers 500").boolean();

  router = localRouter((r) =>
    r.port(this.port.value).stable("v1").candidate("v2")
      .broken(this.broken.value)
  );

  rollout = canary((c) =>
    c.platform(this.router)
      .steps(10, 50)
      .bake("2s")
      .analysisInterval("1s")
      .analysis(httpProbe((h) =>
        h.url(this.router.url).samples(20).interval(0).maxFailures(0)
      ))
  );

  ship = target()
    .description("Announce the release")
    .dependsOn(this.rollout.promote)
    .executes(() => {
      console.log("v2 serves all traffic.");
    });

  /** Stop the local router however the build ends. */
  override async onFinish(): Promise<void> {
    await this.router.close();
  }
}

await run(Release);

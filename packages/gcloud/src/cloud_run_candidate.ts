// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Which Cloud Run revision is the canary. Internal to the package: the
 * `cloudMonitoring(...)` analysis reads it so a rollout driven by
 * `cloudRunCanary(...)` can be judged on the candidate's own metrics or logs.
 *
 * The candidate is the service's **latest created revision** — the one
 * `cloudRunCanary`'s `stage` creates, and the one its `promote` checks is
 * still the staged candidate before moving traffic. It is read through
 * gcloud's own `value(...)` projection, as `cloudRunCanary` reads it, so no
 * JSON document is parsed.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { GcloudRunServicesDescribeSettings } from "./cloud_run.ts";
import { LATEST_REVISION_FORMAT } from "./cloud_run_canary.ts";
import { readScalar } from "./scalar_output.ts";
import { failOnExit, type GcloudSettings } from "./settings.ts";
import { operand } from "./validate.ts";

/** A Cloud Run service, and the region it runs in when one is named. */
export interface CloudRunService {
  /** The service's name. */
  service: string;
  /** Its region (`--region`); gcloud's `run/region` when omitted. */
  region?: string;
}

/**
 * The service's latest created revision, read quietly in `project` (when
 * named) with the `gcloud` lambda's global flags applied after it — so the
 * lambda may still override the project — through the instance that lambda
 * returns, and refused unless the command succeeded, whatever `.noThrow()`
 * said. Without the project, a different default gcloud project would name
 * another service's revision, and a filter on it would match nothing.
 */
export async function candidateRevision(
  target: CloudRunService,
  project: string | undefined,
  gcloud: Configure<GcloudSettings>,
  task: string,
): Promise<string> {
  const describe = new GcloudRunServicesDescribeSettings().service(
    operand(task, "Cloud Run service", target.service),
  );
  if (target.region !== undefined) describe.region(target.region);
  if (project !== undefined) describe.project(project);
  const command = gcloud(describe).format(LATEST_REVISION_FORMAT).quiet();
  const output = await command.run();
  failOnExit(command, output);
  return readScalar(output, task, "latest revision");
}

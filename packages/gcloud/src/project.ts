// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Which Google Cloud project a REST call targets. Internal to the package:
 * {@link "./secret_manager.ts".SecretManagerTasks} and
 * {@link "./cloud_monitoring.ts".CloudMonitoringTasks} resolve it the same
 * way, from one implementation.
 *
 * @module
 */

import { defaultReadEnv } from "@zuke/core";

/** Where a project id may come from: the caller, or the environment. */
export interface ProjectSource {
  /** The project id, when the caller named one. */
  project?: string;
  /** Reads an environment variable; defaults to `Deno.env.get`. */
  readEnv?: (name: string) => string | undefined;
}

/**
 * The project the caller named, or the one in `GOOGLE_CLOUD_PROJECT` (then
 * `GCLOUD_PROJECT`) — refused when there is neither, with `caller` and the
 * way to name one (`how`) in the message.
 */
export function resolveProject(
  source: ProjectSource,
  caller: string,
  how: string,
): string {
  if (source.project !== undefined) return source.project;
  const readEnv = source.readEnv ?? defaultReadEnv;
  const project = readEnv("GOOGLE_CLOUD_PROJECT") ?? readEnv("GCLOUD_PROJECT");
  if (project === undefined || project === "") {
    throw new Error(
      `${caller}: no project — ${how} or set GOOGLE_CLOUD_PROJECT.`,
    );
  }
  return project;
}

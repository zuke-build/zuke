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

/**
 * A project id (lowercase letters, digits and hyphens, starting with a
 * letter, optionally behind a legacy `domain:` scope) or a project number.
 * It goes into a URL path, so `.`, `..` and anything with a `/` must not.
 */
const PROJECT_SHAPE =
  /^(?:(?:[a-z0-9-]+\.)+[a-z]+:)?[a-z](?:[a-z0-9-]*[a-z0-9])?$|^\d+$/;

/** Where a project id may come from: the caller, or the environment. */
interface ProjectSource {
  /** The project id, when the caller named one. */
  project?: string;
  /** Reads an environment variable; defaults to `Deno.env.get`. */
  readEnv?: (name: string) => string | undefined;
}

/**
 * The project the caller named, or the one in `GOOGLE_CLOUD_PROJECT` (then
 * `GCLOUD_PROJECT`) — refused when there is neither, or when it is not the
 * shape of a project id or number, with `caller` and the way to name one
 * (`how`) in the message.
 */
export function resolveProject(
  source: ProjectSource,
  caller: string,
  how: string,
): string {
  const readEnv = source.readEnv ?? defaultReadEnv;
  const project = source.project ?? readEnv("GOOGLE_CLOUD_PROJECT") ??
    readEnv("GCLOUD_PROJECT");
  if (project === undefined || project === "") {
    throw new Error(
      `${caller}: no project — ${how} or set GOOGLE_CLOUD_PROJECT.`,
    );
  }
  if (!PROJECT_SHAPE.test(project)) {
    throw new Error(
      `${caller}: "${project}" is not a project id or number — it goes into ` +
        "the request's path, so it is refused rather than sent.",
    );
  }
  return project;
}

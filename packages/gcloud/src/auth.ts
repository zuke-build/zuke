/**
 * Google Cloud access-token resolution for the REST task groups
 * ({@link "./gcs.ts".GcsTasks} and {@link "./secret_manager.ts".SecretManagerTasks}).
 *
 * The default provider shells out to `gcloud auth print-access-token`, so no
 * Google SDK — and no extra dependency — is needed: the token comes from the
 * same credentials `gcloud` already uses. Inject a different {@link AccessTokenProvider}
 * (a secret parameter, a metadata-server fetch, a workload-identity exchange)
 * wherever that fits better.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";
import { type GcloudSettings, GcloudTasks } from "./gcloud.ts";

/** Supplies a Google Cloud OAuth access token for a REST call. */
export type AccessTokenProvider = () => Promise<string>;

/**
 * Runs a `gcloud` command — the seam {@link gcloudAccessToken} resolves the
 * token through. Defaults to {@link "./gcloud.ts".GcloudTasks} `.run`; injectable
 * so the default provider is unit-testable without invoking `gcloud`.
 */
export type GcloudRunner = (
  configure?: Configure<GcloudSettings>,
) => Promise<CommandOutput>;

/**
 * The default {@link AccessTokenProvider}: the trimmed stdout of
 * `gcloud auth print-access-token`, run with `--quiet` so the token never
 * streams to the build log. `run` defaults to {@link "./gcloud.ts".GcloudTasks}
 * `.run` and is injectable for tests.
 */
export function gcloudAccessToken(
  run: GcloudRunner = GcloudTasks.run,
): Promise<string> {
  return run((s) => s.command("auth", "print-access-token").quiet())
    .then((out) => out.text());
}

/**
 * Resolve a bearer token from an explicit `token` or, when it is omitted, the
 * `tokenProvider` (defaulting to {@link gcloudAccessToken}). Shared by the REST
 * task groups so every call resolves auth the same way.
 */
export function resolveAccessToken(
  options: { token?: string; tokenProvider?: AccessTokenProvider },
): Promise<string> {
  if (options.token !== undefined) return Promise.resolve(options.token);
  return (options.tokenProvider ?? gcloudAccessToken)();
}

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

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
import { hasControl } from "./control.ts";
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
 *
 * A token holding a line break or another control character inside it is
 * refused here, without quoting it: it cannot be an OAuth token — it is what
 * a provider that printed something else as well looks like — and the
 * runtime's own refusal of such a header value would quote the whole value,
 * token and all, into the error.
 */
export async function resolveAccessToken(
  options: { token?: string; tokenProvider?: AccessTokenProvider },
): Promise<string> {
  const token = options.token !== undefined
    ? options.token
    : await (options.tokenProvider ?? gcloudAccessToken)();
  if (hasControl(token.trim())) {
    throw new Error(
      "Google Cloud auth: the access token holds a line break or another " +
        "control character, so it cannot be sent as a bearer header. It is " +
        "not quoted here. Check what the token provider printed.",
    );
  }
  return token;
}

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
import { GcloudTasks } from "./gcloud.ts";
import { readScalar } from "./scalar_output.ts";
import { failOnExit, GcloudSettings } from "./settings.ts";

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
 * The default {@link AccessTokenProvider}: the one line
 * `gcloud auth print-access-token` prints, run with `--quiet` so the token
 * never streams to the build log. A failed exit is an error even when the
 * runner's settings say `.noThrow()`, and an empty, multi-line or truncated
 * answer is refused — each would otherwise be sent as a broken token. `run` defaults to {@link "./gcloud.ts".GcloudTasks}
 * `.run` and is injectable for tests.
 */
export async function gcloudAccessToken(
  run: GcloudRunner = GcloudTasks.run,
): Promise<string> {
  const output = await run((s) =>
    s.command("auth", "print-access-token").quiet()
  );
  failOnExit(
    new GcloudSettings().command("auth", "print-access-token"),
    output,
  );
  return readScalar(output, "gcloudAccessToken", "access token");
}

/** HTTP's own whitespace, which a header value is trimmed of. */
const HTTP_WHITESPACE = /^[\t\n\r ]+|[\t\n\r ]+$/g;

/**
 * Resolve a bearer token from an explicit `token` or, when it is omitted, the
 * `tokenProvider` (defaulting to {@link gcloudAccessToken}). Shared by the REST
 * task groups so every call resolves auth the same way. The token is returned
 * trimmed of the whitespace a header drops anyway.
 *
 * An empty token is refused, and so is one holding a control character after
 * that trim — a line break inside it, or a `\v` or `\f` at either end. It
 * cannot be an OAuth token, it is not quoted here, and the runtime's own
 * refusal of such a header value would quote the whole value, token and all,
 * into the error.
 */
export async function resolveAccessToken(
  options: { token?: string; tokenProvider?: AccessTokenProvider },
): Promise<string> {
  const raw = options.token !== undefined
    ? options.token
    : await (options.tokenProvider ?? gcloudAccessToken)();
  const token = raw.replace(HTTP_WHITESPACE, "");
  if (token === "") {
    throw new Error(
      "Google Cloud auth: the access token is empty. Check that gcloud is " +
        "signed in, or what the token provider returned.",
    );
  }
  if (hasControl(token)) {
    throw new Error(
      "Google Cloud auth: the access token holds a line break or another " +
        "control character, so it cannot be sent as a bearer header. It is " +
        "not quoted here. Check what the token provider printed.",
    );
  }
  return token;
}

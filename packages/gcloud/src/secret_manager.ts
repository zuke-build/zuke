/**
 * `SecretManagerTasks` — read and write Google Secret Manager secrets over its
 * REST API, without a Google SDK. Auth is a bearer token from an injected
 * {@link "./auth.ts".AccessTokenProvider} (default: `gcloud auth print-access-token`).
 *
 * ```ts
 * import { SecretManagerTasks } from "jsr:@zuke/gcloud";
 *
 * // Create-if-absent, then add a version (idempotent, write-before-create):
 * await SecretManagerTasks.addVersion("db-password", secret, { project: "p" });
 * const value = await SecretManagerTasks.access("db-password", { project: "p" });
 * ```
 *
 * **Handling.** `access` returns the plaintext secret — route it straight into a
 * `.secret()` parameter or the run's redactor; never log it.
 *
 * @module
 */

import { type AccessTokenProvider, resolveAccessToken } from "./auth.ts";
import { gcpJson, isRecord, readString } from "./rest.ts";

/** The Secret Manager v1 API root (overridable only via the `fetch` seam in tests). */
const SECRET_MANAGER_BASE = "https://secretmanager.googleapis.com/v1";

/** The `409 Conflict` a create returns when the secret already exists (tolerated). */
const ALREADY_EXISTS = 409;

/** Auth + transport + project options common to every {@link SecretManagerTasks} call. */
export interface SecretManagerOptions {
  /** The Google Cloud project id; when omitted, resolved from the environment. */
  project?: string;
  /** A pre-resolved OAuth token; when omitted, {@link tokenProvider} supplies one. */
  token?: string;
  /** Resolves the token when `token` is omitted (default: {@link "./auth.ts".gcloudAccessToken}). */
  tokenProvider?: AccessTokenProvider;
  /** The `fetch` implementation; defaults to the global. Overridable for tests. */
  fetch?: typeof fetch;
  /** Reads an environment variable for project resolution; defaults to `Deno.env.get`. */
  readEnv?: (name: string) => string | undefined;
}

/** Options for {@link SecretManagerTasksApi.access}: the common options plus a version. */
export interface SecretManagerAccessOptions extends SecretManagerOptions {
  /** The version to access; defaults to `"latest"`. */
  version?: string;
}

/** Read an environment variable, treating missing env access as unset. */
function defaultReadEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

/** Resolve the target project from the option or the standard gcloud env vars. */
function resolveProject(options: SecretManagerOptions): string {
  if (options.project !== undefined) return options.project;
  const readEnv = options.readEnv ?? defaultReadEnv;
  const project = readEnv("GOOGLE_CLOUD_PROJECT") ?? readEnv("GCLOUD_PROJECT");
  if (project === undefined || project === "") {
    throw new Error(
      "secret manager: no project — pass { project } or set GOOGLE_CLOUD_PROJECT.",
    );
  }
  return project;
}

/** Base64-encode a UTF-8 string (the payload wire format), dependency-free. */
function base64Encode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Decode a base64 payload back to its UTF-8 string. Uses a **fatal** decoder, so
 * a non-UTF-8 (binary) payload throws rather than being silently mangled into
 * U+FFFD replacement characters — {@link SecretManagerTasks} `access` turns that
 * into a friendly error naming the secret.
 */
function base64Decode(encoded: string): string {
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/** The shape of {@link SecretManagerTasks}. */
export interface SecretManagerTasksApi {
  /** Access secret `name`'s payload as a string (version defaults to `"latest"`). */
  access(
    name: string,
    options?: SecretManagerAccessOptions,
  ): Promise<string>;
  /**
   * Add a new version holding `value` to secret `name`, **creating the secret
   * first if it does not exist** (an already-exists `409` is ignored) — the
   * write-before-create idempotency a deploy relies on. Returns the new version's
   * resource name.
   */
  addVersion(
    name: string,
    value: string,
    options?: SecretManagerOptions,
  ): Promise<string>;
}

/** Typed Google Secret Manager operations. */
export const SecretManagerTasks: SecretManagerTasksApi = {
  async access(
    name: string,
    options: SecretManagerAccessOptions = {},
  ): Promise<string> {
    const project = resolveProject(options);
    const token = await resolveAccessToken(options);
    const version = options.version ?? "latest";
    const url = `${SECRET_MANAGER_BASE}/projects/${
      encodeURIComponent(project)
    }/secrets/${encodeURIComponent(name)}/versions/${
      encodeURIComponent(version)
    }:access`;
    const body = await gcpJson(url, { method: "GET" }, {
      token,
      fetch: options.fetch,
    });
    const payload = isRecord(body) && isRecord(body.payload)
      ? readString(body.payload, "data")
      : undefined;
    if (payload === undefined) {
      throw new Error(`secret manager: ${url} returned no payload data`);
    }
    try {
      return base64Decode(payload);
    } catch {
      throw new Error(
        `secret manager: secret "${name}" version "${version}" is not valid ` +
          `UTF-8 text — access() returns strings, not binary secrets.`,
      );
    }
  },

  async addVersion(
    name: string,
    value: string,
    options: SecretManagerOptions = {},
  ): Promise<string> {
    const project = resolveProject(options);
    const token = await resolveAccessToken(options);
    const rest = { token, fetch: options.fetch };
    const projectPath = `${SECRET_MANAGER_BASE}/projects/${
      encodeURIComponent(project)
    }`;

    // Create the secret (the container) first; an already-existing one is fine.
    await gcpJson(
      `${projectPath}/secrets?secretId=${encodeURIComponent(name)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ replication: { automatic: {} } }),
      },
      rest,
      [ALREADY_EXISTS],
    );

    // Then add the version holding the value.
    const added = await gcpJson(
      `${projectPath}/secrets/${encodeURIComponent(name)}:addVersion`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload: { data: base64Encode(value) } }),
      },
      rest,
    );
    return (isRecord(added) ? readString(added, "name") : undefined) ?? "";
  },
};

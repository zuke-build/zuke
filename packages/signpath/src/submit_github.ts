// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Submitting with GitHub origin verification, through SignPath's GitHub
 * connector — see {@link "./github_origin.ts"} for what the connector checks
 * and the request shape, which mirrors SignPath's own action.
 *
 * The connector answers JSON: `{ signingRequestId, signingRequestUrl,
 * validationResult: { errors: [{ error, howToFix }] }, error, logs }`. Origin
 * validation errors become a {@link SignPathValidationError} listing them;
 * a refusal with an `error` text becomes a {@link SignPathApiError}; an answer
 * with neither errors nor an id is reported as not having come from the
 * connector at all. The connector's `logs` are not printed: they are
 * server-written text with nothing the errors above do not already carry.
 *
 * Internal: not re-exported from `mod.ts`.
 *
 * @module
 */

import { assertSecureBackendUrl } from "@zuke/core";
import {
  type Connection,
  isGuid,
  orEnv,
  parseHttpUrl,
  requireToken,
} from "./connect.ts";
import {
  SignPathRequestError,
  SignPathValidationError,
  type SignPathValidationIssue,
} from "./errors.ts";
import type { SignPathGitHubOriginSettings } from "./github_origin.ts";
import { scrub } from "./scrub.ts";
import { isRecord, optionalString, own, parseJson } from "./shape.ts";
import type { SubmitRequest } from "./submit_request.ts";
import { call, type Outgoing, refusal } from "./transport.ts";

/** The connector API version SignPath's action pins. */
const API_VERSION = "1.0";

/** The most validation errors one message lists; a hostile answer cannot flood the log. */
const MAX_ISSUES = 20;

/** A GitHub numeric id: an artifact's or a workflow run's. */
const NUMERIC_ID = /^[0-9]+$/;

/** A GitHub repository, `owner/name`. */
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** The GitHub-side facts the connector needs, resolved and validated. */
interface GitHubRun {
  /** The workflow artifact's id. */
  readonly artifactId: string;
  /** The workflow run's id. */
  readonly runId: string;
  /** The repository, `owner/name`. */
  readonly repository: string;
  /** The GitHub token. */
  readonly token: string;
}

/** A numeric id, from the setting or the environment, or an error naming both. */
function numericId(
  value: string | undefined,
  what: string,
  setter: string,
): string {
  if (value === undefined || !NUMERIC_ID.test(value)) {
    throw new Error(
      `the GitHub ${what} for SignPath is ${
        value === undefined ? "missing" : "not a number"
      } — call ${setter}.`,
    );
  }
  return value;
}

/** Resolve the origin settings against the workflow's environment. */
function gitHubRunOf(
  connection: Connection,
  origin: SignPathGitHubOriginSettings,
): GitHubRun {
  const { settings } = connection;
  const token = orEnv(origin.token_, settings, "GITHUB_TOKEN");
  requireToken(token, "GitHub token", "g.token(...)", "GITHUB_TOKEN");
  connection.redactor.add(token);
  const repository = orEnv(origin.repository_, settings, "GITHUB_REPOSITORY");
  if (repository === undefined || !REPOSITORY.test(repository)) {
    throw new Error(
      `the GitHub repository for SignPath is ${
        repository === undefined ? "missing" : `not "owner/name"`
      } — call g.repository(...) or set GITHUB_REPOSITORY.`,
    );
  }
  return {
    artifactId: numericId(
      origin.artifactId_,
      "artifact id",
      "g.artifactId(...) with the upload-artifact step's artifact-id output",
    ),
    runId: numericId(
      orEnv(origin.runId_, settings, "GITHUB_RUN_ID"),
      "workflow run id",
      "g.runId(...) or set GITHUB_RUN_ID",
    ),
    repository,
    token,
  };
}

/** The connector's validation errors, scrubbed; empty when there are none. */
function issuesOf(
  connection: Connection,
  json: unknown,
): SignPathValidationIssue[] {
  if (!isRecord(json)) return [];
  const result = own(json, "validationResult");
  const errors = isRecord(result) ? own(result, "errors") : undefined;
  if (!Array.isArray(errors)) return [];
  return errors.filter(isRecord).slice(0, MAX_ISSUES).map((entry) => {
    const howToFix = optionalString(entry, "howToFix");
    return {
      error: scrub(
        connection.redactor,
        optionalString(entry, "error") ?? "(no description)",
      ),
      howToFix: howToFix === undefined
        ? undefined
        : scrub(connection.redactor, howToFix),
    };
  });
}

/**
 * Submit `request`, whose artifact SignPath fetches from the GitHub workflow
 * run `origin` names, and return the new request's id.
 */
export async function submitWithGitHubOrigin(
  connection: Connection,
  request: SubmitRequest,
  origin: SignPathGitHubOriginSettings,
): Promise<string> {
  const run = gitHubRunOf(connection, origin);
  const connector = parseHttpUrl(origin.connectorUrl_, "GitHub connector URL");
  assertSecureBackendUrl(
    origin.connectorUrl_,
    "the SignPath GitHub connector URL",
    connection.settings.readEnv_,
  );
  connector.search = "";
  connector.hash = "";
  const path = `/${encodeURIComponent(connection.organizationId)}` +
    "/SigningRequests";
  const url = new URL(`${connector.href.replace(/\/+$/, "")}${path}`);
  url.searchParams.set("api-version", API_VERSION);
  const outgoing: Outgoing = {
    method: "POST",
    url,
    path,
    body: JSON.stringify({
      artifactId: run.artifactId,
      gitHubWorkflowRunId: run.runId,
      gitHubRepository: run.repository,
      gitHubToken: run.token,
      signPathProjectSlug: request.projectSlug,
      signPathSigningPolicySlug: request.signingPolicySlug,
      signPathArtifactConfigurationSlug: request.artifactConfigurationSlug,
      parameters: request.parameters.map(([name, value]) => ({ name, value })),
    }),
    authorize: true,
    timeoutMs: connection.settings.requestTimeout_,
  };
  const answer = await call(connection, outgoing);
  const json = parseJson(answer.text);
  const issues = issuesOf(connection, json);
  if (issues.length > 0) throw new SignPathValidationError(issues);
  if (!answer.ok) throw refusal(connection, outgoing, answer);
  const id = isRecord(json) ? own(json, "signingRequestId") : undefined;
  if (typeof id !== "string" || !isGuid(id)) {
    throw new SignPathRequestError(
      "POST",
      path,
      "the answer has no signing request id — is the connector URL " +
        "SignPath's GitHub Actions connector?",
    );
  }
  return id;
}

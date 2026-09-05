// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Authentication for the MCP server: who is calling, and what to answer when
 * the question has no good answer.
 *
 * One authenticator runs per request, before any dispatch, on both transports.
 * The older {@link McpIdentityHook} is adapted onto the same interface by
 * {@link authenticatorFromHook}, so there is exactly one authentication path
 * rather than two that can drift apart.
 *
 * Everything here is fail-closed: {@link authenticateRequest} turns a throw, a
 * non-object, an empty actor, or a malformed rejection into a refusal, so an
 * authenticator cannot accidentally authorize a request by misbehaving.
 *
 * @module
 */

import type { McpRequestContext } from "./jsonrpc.ts";

/**
 * A trusted caller identity, resolved per request by an
 * {@link McpAuthenticator}. Its {@link McpIdentity.actor} is the
 * highest-precedence attribution — it overrides `--actor`, the environment, and
 * the client's self-reported label for the call.
 */
export interface McpIdentity {
  /** The authenticated actor — an OAuth subject, a GitHub login, a service name. */
  actor: string;
  /**
   * Whether a person or a machine is calling. Absent is read as `"human"`, the
   * conservative default: a policy that treats service callers differently must
   * see the claim stated rather than inferred.
   */
  kind?: "human" | "service";
  /**
   * The roles this caller holds. Absent is read as none, so an authenticator
   * that says nothing about roles grants nothing.
   */
  roles?: readonly string[];
  /** How the identity was established (e.g. `"oauth-proxy"`); informational. */
  via?: string;
}

/**
 * An {@link McpIdentity} after {@link normalizeIdentity}: `kind` and `roles` are
 * settled, so nothing downstream re-applies the defaults (and no two callers can
 * disagree about what they are).
 */
export interface ResolvedIdentity {
  /** The authenticated actor. Never empty. */
  readonly actor: string;
  /** The caller's kind, defaulted to `"human"` when the authenticator omitted it. */
  readonly kind: "human" | "service";
  /** The caller's roles, defaulted to empty. Each entry is a non-empty string. */
  readonly roles: readonly string[];
  /**
   * How the identity was established, when the authenticator said. Carried
   * through to whatever inspects the caller; not written to the audit trail,
   * which records the actor.
   */
  readonly via?: string;
}

/**
 * Why a request was refused, and how the transport should say so.
 *
 * The status and challenge are what make OAuth discovery work: an MCP client
 * learns where to authenticate from a `401` carrying `WWW-Authenticate`, which a
 * JSON-RPC error inside a `200` can never tell it.
 */
export interface McpAuthReject {
  /** The HTTP status to answer with — a client error, `401` or `403` in practice. */
  status: number;
  /**
   * A short reason, machine-readable where there is a standard code for it (an
   * OAuth authenticator's `"invalid_token"`, say). It becomes the JSON-RPC
   * error message on the refusal, so it is read by people too.
   */
  error: string;
  /** A short human-readable detail. Never a secret: it is returned to the caller. */
  detail?: string;
  /** The `WWW-Authenticate` header value to challenge with, when one applies. */
  challenge?: string;
}

/**
 * Authenticates one request for the MCP server.
 *
 * Invoked once per message, before any dispatch: a rejection stops the request
 * outright, so nothing executes and nothing is written to state. Returning an
 * {@link McpIdentity} accepts the caller; returning an {@link McpAuthReject}
 * refuses it. Throwing also refuses it — the seam is fail-closed, so a bug in an
 * authenticator denies rather than admits.
 *
 * Configure one with `override mcpAuth()` on the build.
 */
export interface McpAuthenticator {
  /** Resolve the caller's identity from the request, or refuse the request. */
  authenticate(
    ctx: McpRequestContext,
  ): Promise<McpIdentity | McpAuthReject> | McpIdentity | McpAuthReject;
}

/**
 * Resolve a trusted {@link McpIdentity} from a request's context. The original,
 * synchronous identity seam, kept as sugar for the common case of trusting a
 * header an authenticating reverse proxy injected: **throwing rejects the whole
 * request**. {@link authenticatorFromHook} adapts one onto
 * {@link McpAuthenticator}, which is what the server actually runs.
 */
export type McpIdentityHook = (ctx: McpRequestContext) => McpIdentity;

/**
 * The bare `401` challenge: the refusal an authenticator's own failure produces
 * (so a throw leaks nothing about why it threw), and the one the transport
 * answers a bad or absent static bearer token with — one shape for "you are not
 * authenticated", rather than a second spelling per call site.
 */
export const UNAUTHORIZED: McpAuthReject = Object.freeze({
  status: 401,
  error: "Unauthorized",
  challenge: "Bearer",
});

/** Whether `value` is a plain object (a string-keyed record). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `value` when it is a non-empty string, else `undefined`. */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The non-empty strings in `value`, or an empty list when it is not an array. */
function rolesOf(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((role): role is string =>
    typeof role === "string" && role !== ""
  );
}

/**
 * Settle an authenticator's result into a {@link ResolvedIdentity}, or `null`
 * when it is not a usable identity (not an object, or no non-empty `actor`).
 *
 * Deliberately tolerant about the rest: an unknown `kind` reads as `"human"` and
 * malformed roles drop out, because a value that is *nearly* an identity must
 * never become a *more privileged* one than the authenticator meant.
 */
export function normalizeIdentity(value: unknown): ResolvedIdentity | null {
  if (!isRecord(value)) return null;
  const actor = value.actor;
  if (typeof actor !== "string" || actor === "") return null;
  const kind = value.kind === "service" ? "service" : "human";
  const roles = rolesOf(value.roles);
  const via = nonEmptyString(value.via);
  return via === undefined
    ? { actor, kind, roles }
    : { actor, kind, roles, via };
}

/**
 * Settle an authenticator's result into an {@link McpAuthReject}, falling back
 * to a bare `401` for anything malformed.
 *
 * The status is validated to a client-error code: an authenticator that returns
 * `status: 200` (or a string, or nothing) must not turn its own refusal into a
 * success at the transport.
 */
function normalizeReject(value: unknown): McpAuthReject {
  if (!isRecord(value)) return UNAUTHORIZED;
  const status = value.status;
  if (typeof status !== "number" || !Number.isInteger(status)) {
    return UNAUTHORIZED;
  }
  if (status < 400 || status > 499) return UNAUTHORIZED;
  const reject: McpAuthReject = {
    status,
    error: nonEmptyString(value.error) ?? UNAUTHORIZED.error,
  };
  const detail = nonEmptyString(value.detail);
  if (detail !== undefined) reject.detail = detail;
  const challenge = nonEmptyString(value.challenge);
  if (challenge !== undefined) reject.challenge = challenge;
  return reject;
}

/**
 * Run `authenticator` against `ctx`, fail-closed: the result is either a settled
 * {@link ResolvedIdentity} or an {@link McpAuthReject}, whatever the
 * authenticator did. A throw, a `null`, an empty actor and a malformed rejection
 * all become a refusal.
 *
 * The single place an authenticator is invoked, so both transports enforce it
 * identically.
 */
export async function authenticateRequest(
  authenticator: McpAuthenticator,
  ctx: McpRequestContext,
): Promise<ResolvedIdentity | McpAuthReject> {
  let result: unknown;
  try {
    result = await authenticator.authenticate(ctx);
  } catch {
    return UNAUTHORIZED;
  }
  // A `status` is what a refusal carries and an identity does not, so a value
  // bearing one is read as a refusal even if it also names an actor. The typed
  // union cannot produce that, but an authenticator built in plain JS can — and
  // between "deny" and "admit" for a value that says both, fail-closed means
  // deny.
  if (isRecord(result) && "status" in result) return normalizeReject(result);
  return normalizeIdentity(result) ?? normalizeReject(result);
}

/**
 * The reason a refusal reports: its code, and its detail when it has one.
 *
 * Shared by both transports so a caller reads the same sentence over HTTP (in
 * the JSON-RPC error beside the status) and over stdio (where there is no status
 * to read it from).
 */
export function refusalReason(reject: McpAuthReject): string {
  return reject.detail === undefined
    ? reject.error
    : `${reject.error}: ${reject.detail}`;
}

/**
 * Whether {@link authenticateRequest}'s result is an identity rather than a
 * refusal. The two are told apart by `actor`, which a refusal never carries.
 */
export function isResolvedIdentity(
  result: ResolvedIdentity | McpAuthReject,
): result is ResolvedIdentity {
  return "actor" in result;
}

/**
 * Adapt a synchronous {@link McpIdentityHook} onto {@link McpAuthenticator}.
 *
 * The hook's throw-to-reject convention is preserved by
 * {@link authenticateRequest}, which turns any throw into a refusal — so the
 * adapter itself needs no error handling, and the older seam runs through
 * exactly the same code path as a modern authenticator.
 */
export function authenticatorFromHook(
  hook: McpIdentityHook,
): McpAuthenticator {
  return { authenticate: (ctx) => hook(ctx) };
}

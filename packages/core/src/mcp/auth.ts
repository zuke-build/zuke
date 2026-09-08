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
   * The roles this caller holds.
   *
   * Omitting it means this authenticator does not speak roles: the
   * [role policy](../../docs/mcp.md#authorization) then does not constrain the
   * caller, and the server's allow-list, `--protect` globs and operator token
   * remain the only gates — what a server did before roles existed. An **empty
   * list** is the opposite claim: the question was considered and nothing was
   * granted, so the policy denies.
   *
   * Role names are passed through as given; the comma-separated environment
   * variable a registry-spawned child reads escapes them rather than this
   * dropping them, so sanitisation cannot turn a granted set into an empty one.
   */
  roles?: readonly string[];
  /** How the identity was established (e.g. `"oauth-proxy"`); informational. */
  via?: string;
}

/**
 * An {@link McpIdentity} after {@link normalizeIdentity}: `kind` is settled, so
 * nothing downstream re-applies that default, while `roles` is preserved
 * exactly as claimed — absent when the authenticator never mentioned it, which
 * is a different claim from granting none.
 */
export interface ResolvedIdentity {
  /** The authenticated actor. Never empty. */
  readonly actor: string;
  /** The caller's kind, defaulted to `"human"` when the authenticator omitted it. */
  readonly kind: "human" | "service";
  /**
   * The roles the authenticator claimed, or `undefined` when it claimed none at
   * all.
   *
   * The distinction is load-bearing, and it is not the same as an empty list.
   * `undefined` means this authenticator does not speak roles — a
   * proxy-header `mcpIdentity()` hook, say — so the role policy does not
   * constrain it and the server's own gates remain the only ones, exactly as
   * before roles existed. `[]` means the authenticator considered the question
   * and granted nothing, which denies. Collapsing the two would silently lock
   * out every server whose authenticator predates the policy.
   */
  readonly roles?: readonly string[];
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
  /**
   * The `WWW-Authenticate` header value to challenge with, when one applies. A
   * value a header cannot carry (a newline, a NUL, a character outside Latin-1)
   * is dropped rather than sent, so it cannot turn the refusal into a fault.
   */
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
 * answers an **absent** static bearer token with. A token that was presented
 * and rejected gets {@link INVALID_TOKEN} instead: the two are different facts
 * about the caller, and only the second one is about a credential.
 */
export const UNAUTHORIZED: McpAuthReject = Object.freeze({
  status: 401,
  error: "Unauthorized",
  challenge: "Bearer",
});

/**
 * The refusal for a request that **presented** a token which did not hold up —
 * expired, wrong signature, wrong audience.
 *
 * Distinct from {@link UNAUTHORIZED} on purpose: OAuth 2.1 §5.3.1 says a
 * challenge SHOULD NOT carry error information when the request had no
 * credentials at all, because there is nothing yet to have been wrong. Sending
 * `invalid_token` to a client that simply has not logged in tells it its stored
 * token was rejected, which is a different and misleading thing.
 */
export const INVALID_TOKEN: McpAuthReject = Object.freeze({
  status: 401,
  error: "invalid_token",
  challenge: `Bearer error="invalid_token"`,
});

/** How a bearer challenge names the failure, when there is one to name. */
export type ChallengeError = "invalid_token" | "insufficient_scope";

/** The parts of a `WWW-Authenticate: Bearer` challenge Zuke emits. */
export interface BearerChallenge {
  /** Absolute URL of the protected resource metadata document (RFC 9728). */
  metadataUrl?: string;
  /** Scopes required for the attempted operation — all of them, in one go. */
  scopes?: readonly string[];
  /** The failure, omitted for a request that presented no credentials. */
  error?: ChallengeError;
  /** Developer-facing explanation; never shown to an end user. */
  description?: string;
}

/**
 * Characters an `auth-param` value may carry, per OAuth 2.1 §5.3.1: the set
 * excludes `"` and `\`, so anything interpolated into a challenge has to be
 * filtered or it is a header-injection bug. Dropping the offending characters
 * beats escaping them, because nothing downstream needs the original back.
 */
function paramValue(value: string): string {
  return value.replace(/[^\x20-\x21\x23-\x5B\x5D-\x7E]/g, "");
}

/**
 * A `WWW-Authenticate: Bearer` challenge built from `parts`.
 *
 * Returns a bare `Bearer` when nothing usable is supplied, and drops any single
 * part that survives filtering as empty, so a caller cannot produce a malformed
 * header by passing an odd string.
 */
export function bearerChallenge(parts: BearerChallenge = {}): string {
  const params: string[] = [];
  const add = (name: string, raw: string | undefined) => {
    const value = raw === undefined ? "" : paramValue(raw);
    if (value !== "") params.push(`${name}="${value}"`);
  };
  add("error", parts.error);
  add("error_description", parts.description);
  // Space-delimited, and each value filtered the same way; an empty result is
  // dropped by `add` rather than emitted as `scope=""`.
  add("scope", parts.scopes?.join(" "));
  add("resource_metadata", parts.metadataUrl);
  const challenge = params.length === 0
    ? "Bearer"
    : `Bearer ${params.join(", ")}`;
  return headerValue(challenge) ?? "Bearer";
}

/**
 * `challenge` with a `resource_metadata` parameter naming `metadataUrl`, unless
 * it already carries one.
 *
 * The refusal constants and an authenticator's own challenge are both written
 * without knowing the server's public URL, which is configuration the transport
 * holds — so the parameter is added here, at the point the response is built,
 * rather than threaded through every place a refusal is constructed. An
 * authenticator that set its own is left alone.
 */
export function withResourceMetadata(
  challenge: string,
  metadataUrl: string,
): string {
  // Matched as a parameter, not as a substring, and only outside quoted
  // values — a plain `includes` was wrong in both directions. An
  // `error_description` merely mentioning the word suppressed a real URL,
  // silently killing discovery; and a challenge spelling the parameter
  // `Resource_Metadata =` (auth-param names are case-insensitive, and RFC 7235
  // permits space around the `=`) got a second copy, which RFC 7235 §2.1
  // forbids and leaves clients to resolve however they like. Blanking the
  // quoted strings first is what separates the two cases: a value can contain
  // anything, a parameter name cannot.
  const outsideValues = challenge.replace(/"(?:[^"\\]|\\.)*"/g, `""`);
  if (/(^|[\s,])resource_metadata\s*=/i.test(outsideValues)) return challenge;
  const url = paramValue(metadataUrl);
  const separator = challenge.trim() === "Bearer" ? " " : ", ";
  const merged = `${challenge}${separator}resource_metadata="${url}"`;
  return headerValue(merged) ?? challenge;
}

/** Whether `value` is a plain object (a string-keyed record). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `value` when it is a non-empty string, else `undefined`. */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * `value` when it is a non-empty string a `Headers` can actually carry, else
 * `undefined`.
 *
 * The challenge is the one field of a refusal that becomes an HTTP header, and
 * `Headers.set` throws on a CR/LF, a NUL, or any character outside Latin-1. A
 * throw there would turn a refusal the authenticator wrote into a transport
 * fault carrying no challenge at all — so a challenge a header cannot carry is dropped
 * here, exactly like an absent one, and the refusal still goes out with its own
 * status. `Headers` itself is the oracle: a hand-written character test would
 * have to track the same rules and would drift.
 */
function headerValue(value: unknown): string | undefined {
  const candidate = nonEmptyString(value);
  if (candidate === undefined) return undefined;
  try {
    new Headers({ "www-authenticate": candidate });
    return candidate;
  } catch {
    return undefined;
  }
}

/**
 * The usable role names in `value`, or an empty list when it is not an array.
 *
 * Only empty and non-string entries are dropped. A name containing a comma is
 * **kept**: the comma matters only to the environment variable a
 * registry-spawned child reads, which escapes it there, and dropping the role
 * here would let sanitisation manufacture an empty list — which the role policy
 * reads as "granted nothing" and denies. A guard that turns a granted role set
 * into a deny-all is a worse answer than the encoding problem it avoids.
 */
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
  // Preserved rather than defaulted: see `ResolvedIdentity.roles` — an
  // authenticator that never mentions roles is not the same as one that grants
  // none, and treating it as the latter would deny every caller of a server
  // whose authenticator predates the policy.
  const roles = value.roles === undefined ? undefined : rolesOf(value.roles);
  const via = nonEmptyString(value.via);
  return {
    actor,
    kind,
    ...(roles === undefined ? {} : { roles }),
    ...(via === undefined ? {} : { via }),
  };
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
  const challenge = headerValue(value.challenge);
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
  try {
    const result = await authenticator.authenticate(ctx);
    // Every read of the untrusted result stays inside this `try`, not just the
    // call that produced it: an authenticator may return a lazy object — claims
    // wrapped in getters is the natural shape — and a getter that throws must
    // refuse the request like any other failure, rather than escaping as a
    // transport-level fault with no challenge on it.
    //
    // A `status` is what a refusal carries and an identity does not, so a value
    // bearing one is read as a refusal even if it also names an actor. The typed
    // union cannot produce that, but an authenticator built in plain JS can —
    // and between "deny" and "admit" for a value that says both, fail-closed
    // means deny.
    if (isRecord(result) && "status" in result) return normalizeReject(result);
    return normalizeIdentity(result) ?? normalizeReject(result);
  } catch {
    return UNAUTHORIZED;
  }
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

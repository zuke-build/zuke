// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Authorization helpers for the MCP server: a glob-based target allow-list
 * matcher and a constant-time token comparison. Shared by the HTTP transport
 * (bearer token) and the server (operator token), so both token checks use one
 * primitive.
 *
 * @module
 */

import { globToRegExp } from "../glob.ts";

/**
 * Constant-time string comparison, so token validation does not leak the token
 * through response timing. The length is compared first (a length difference is
 * not itself sensitive), then every character regardless of early mismatches.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Validate a protected target's operator token, returning a denial reason (for
 * the structured error and the audit trail) or `null` when the token is valid.
 *
 * Fail-closed: a server with no token configured denies every protected target
 * rather than exposing one, and the comparison is constant-time so a wrong token
 * leaks nothing through response timing. The single home of this policy, so both
 * server flavours enforce the token identically.
 */
export function operatorTokenDenial(
  args: Record<string, unknown>,
  token: string | undefined,
): string | null {
  if (token === undefined || token === "") return "operator_token_unconfigured";
  const provided = args.operatorToken;
  if (typeof provided !== "string") return "missing_operator_token";
  return timingSafeEqual(provided, token) ? null : "invalid_operator_token";
}

/**
 * Build a predicate matching a target name against `patterns`, each a glob
 * (`deploy`, `checks*`; `*` matches any run of non-`/` characters, so it spans
 * the dots in a dotted target name). `undefined` matches **everything** — the
 * historical "all targets" behaviour of a bare `--allow-run`; an empty list
 * matches nothing.
 */
export function targetMatcher(
  patterns: readonly string[] | undefined,
): (name: string) => boolean {
  if (patterns === undefined) return () => true;
  const regexps = patterns.map((pattern) => globToRegExp(pattern));
  return (name) => regexps.some((regexp) => regexp.test(name));
}

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The one URL redactor every package shares: {@link redactUrl} for a single
 * URL, {@link redactUrls} for the URLs inside a message. Both strip userinfo
 * and mask credential-bearing parameters, in the query and in the fragment,
 * and both fail **closed**: what the URL parser rejects is still scrubbed by
 * the same rules, textually.
 *
 * Non-goals: a secret embedded in the URL *path* (a webhook's path token, say)
 * is not recognised — nothing about a path segment says it is a credential —
 * and nor is a credential in a scheme with no authority (`mailto:`, `data:`).
 * Declare such a value as a secret parameter, so the build's own redactor masks
 * it.
 *
 * @module
 */

/**
 * Substrings that mark a parameter name as credential-bearing. Matched as
 * substrings (not exact names) so variants — `client_secret`, `refresh_token`,
 * `x-api-key`, `passwd`, `client_assertion` — are covered without an exhaustive
 * list. Over-masking an innocent parameter (e.g. `monkey`, `compass`) is
 * harmless; under-masking a secret is not.
 */
const CREDENTIAL_MARKERS = [
  "secret",
  "token",
  "key",
  "pass",
  "pwd",
  "auth",
  "sig",
  "cred",
  "session",
  "jwt",
  "bearer",
  "otp",
  "assertion",
  "saml",
];

/**
 * Credential-bearing names too short to match as substrings without masking
 * half the alphabet (`code` is in `encode`), so matched whole.
 */
const CREDENTIAL_NAMES = new Set(["code", "sid", "ticket", "pw"]);

/** The mask that replaces a credential's value. */
const MASK = "REDACTED";

/** How many layers of percent-encoding a parameter value is decoded through. */
const MAX_DECODES = 3;

/** Characters a URL scheme is made of (RFC 3986), after its first letter. */
const SCHEME_CHAR = /[a-z0-9+.-]/i;

/** A scheme at the very start of a token (anchored: one attempt, linear). */
const LEADING_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * A web scheme written without both its slashes (`https:u:p@host`,
 * `https:/u:p@host`), which the URL parser still reads as an authority — at a
 * scheme boundary, not inside a word.
 */
const BARE_WEB_SCHEME = /(?<![a-z])(?:https?|wss?|ftp):(?![\/\\]{2})/gi;

/** Punctuation that ends a sentence around a URL rather than belonging to it. */
const CLOSING = ")].,;:!?'\">";

/**
 * Whether a parameter `name` carries a credential. An empty name does: nothing
 * says it does not, and a value with no name is how some APIs pass a token.
 */
function isCredentialParam(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "" || CREDENTIAL_NAMES.has(lower) ||
    lower.endsWith("_code") || lower.endsWith("-code") ||
    CREDENTIAL_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * Strip userinfo (`user:pass@`) and mask every credential-bearing parameter so
 * a URL is safe to put in an error message or a log:
 *
 * ```ts
 * redactUrl("https://ci:hunter2@host.example/x?token=abc&page=2");
 * // "https://host.example/x?token=REDACTED&page=2"
 * ```
 *
 * Parameters are masked in the query and in the fragment, including
 * `;`-separated ones. A parameter whose value carries a credential of its own —
 * a `redirect_uri` with userinfo or a token, encoded up to three times, or any
 * value with an `@` in it — is masked **whole**, since only its whole value is
 * certain to hide it. Input the URL parser rejects is scrubbed by the same rules
 * textually rather than returned as it came: the function fails closed, never
 * throws, and costs time linear in its input.
 *
 * A parsed URL is re-serialised, which can change its spelling (a lowercased
 * host, a percent-encoded path). Run a build's secret redactor over text
 * **before** this, while a declared secret still reads as written. See the
 * module documentation for what it does not recognise.
 */
export function redactUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return scrubText(raw);
  }
  url.username = "";
  url.password = "";
  url.search = maskParams(url.search.slice(1), "?");
  url.hash = maskParams(url.hash.slice(1), "#");
  return url.href;
}

/**
 * `text` with every URL in it passed through {@link redactUrl} — for a message
 * that quotes a URL, such as a failed request's error. A URL starts at its
 * scheme — `https://`, `postgres://`, `https:\\`, or a web scheme the URL
 * parser also reads without slashes (`https:host`) — and runs to the next URL
 * or whitespace, less any closing punctuation (`).,"`) the sentence put after
 * it. Everything outside a URL is left as written.
 */
export function redactUrls(text: string): string {
  return text.split(/(\s+)/).map(redactToken).join("");
}

/** One whitespace-free token of a message, with every URL in it redacted. */
function redactToken(token: string): string {
  const starts = urlStarts(token);
  if (starts.length === 0) return token;
  let out = token.slice(0, starts[0]);
  for (let i = 0; i < starts.length; i++) {
    const segment = token.slice(starts[i], starts[i + 1] ?? token.length);
    let end = segment.length;
    while (end > 0 && CLOSING.includes(segment[end - 1])) end--;
    out += redactUrl(segment.slice(0, end)) + segment.slice(end);
  }
  return out;
}

/**
 * Where each URL in `token` starts, in order: the scheme in front of every
 * `://` or `:\\`, walked back to its first letter (so `--https://` and
 * `1https://` still find `https`), and every web scheme the parser reads
 * without slashes. A separator with no scheme in front is skipped, not the end
 * of the search.
 */
function urlStarts(token: string): number[] {
  const starts = new Set<number>();
  for (const found of token.matchAll(/:(?:\/\/|\\\\)/g)) {
    const separator = found.index;
    let start = separator;
    while (start > 0 && SCHEME_CHAR.test(token[start - 1])) start--;
    while (start < separator && !/[a-z]/i.test(token[start])) start++;
    if (start < separator) starts.add(start);
  }
  for (const found of token.matchAll(BARE_WEB_SCHEME)) starts.add(found.index);
  return [...starts].sort((a, b) => a - b);
}

/**
 * A query or fragment string (without its `?` or `#`) with every credential
 * parameter masked; `prefix` is put back in front unless nothing is left.
 */
function maskParams(params: string, prefix: string): string {
  if (params === "") return "";
  const masked = params.split("&").map((pair) =>
    pair.split(";").map(maskPair).join(";")
  );
  return `${prefix}${masked.join("&")}`;
}

/**
 * One `name=value` pair: masked when its name is a credential, or when its
 * value hides one. A part with no `=` — a bare `?https://u:p@h/` — is judged
 * as a value.
 */
function maskPair(pair: string): string {
  const eq = pair.indexOf("=");
  const name = eq < 0 ? undefined : pair.slice(0, eq);
  const value = eq < 0 ? pair : pair.slice(eq + 1);
  const masked = name === undefined ? MASK : `${name}=${MASK}`;
  if (name !== undefined && isCredentialParam(decodeOnce(name))) return masked;
  return hidesCredential(value) ? masked : pair;
}

/**
 * Whether a parameter value hides a credential at any layer of its encoding: a
 * nested URL's userinfo or credential parameter, or any `@`. A value still
 * encoded past {@link MAX_DECODES} layers counts too — failing closed.
 */
function hidesCredential(value: string): boolean {
  let layer = value;
  for (let depth = 0; depth <= MAX_DECODES; depth++) {
    // Checked as a query of its own, so a value that decodes to
    // `token=…` is judged by that name too.
    const query = `?${layer}`;
    if (scrubShallow(query) !== query) return true;
    const next = decodeOnce(layer);
    if (next === layer) return false;
    layer = next;
  }
  return true;
}

/**
 * `text` with one layer of percent-encoding undone. Each run of escapes is
 * decoded on its own, so one malformed escape cannot hide the rest.
 */
function decodeOnce(text: string): string {
  return text.replaceAll("+", " ").replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

/**
 * The textual scrub, for what the URL parser rejects: in each whitespace-free
 * token, drop everything from the authority's start up to the token's last
 * `@`, and mask every parameter whose name is a credential or whose value hides
 * one — the rules a parsed URL gets. A plain scan over split strings, so linear
 * in its input whatever its shape: no pattern to give up past a length.
 */
function scrubText(text: string): string {
  return scrubTokens(text, true);
}

/**
 * {@link scrubText} judging parameters by name only — what a value is checked
 * with, so checking a value never recurses into checking values again.
 */
function scrubShallow(text: string): string {
  return scrubTokens(text, false);
}

/** Scrub each whitespace-free token of `text`; see {@link scrubText}. */
function scrubTokens(text: string, checkValues: boolean): string {
  return text.split(/(\s+)/).map((token) =>
    maskTextParams(stripUserinfo(token), checkValues)
  ).join("");
}

/** `token` without the userinfo before its last `@`. */
function stripUserinfo(token: string): string {
  const at = token.lastIndexOf("@");
  if (at < 0) return token;
  let start = LEADING_SCHEME.exec(token)?.[0].length ?? 0;
  while (start < at && (token[start] === "/" || token[start] === "\\")) {
    start++;
  }
  return token.slice(0, start) + token.slice(at + 1);
}

/**
 * `token` with the value of every credential parameter in it masked — and,
 * when `checkValues`, of every parameter whose value hides a credential.
 */
function maskTextParams(token: string, checkValues: boolean): string {
  const parts = token.split(/([?&;#])/);
  for (let i = 2; i < parts.length; i += 2) {
    const eq = parts[i].indexOf("=");
    if (eq < 0) {
      // A part with no `=` of its own can still decode to one.
      if (checkValues && hidesCredential(parts[i])) parts[i] = MASK;
      continue;
    }
    const name = parts[i].slice(0, eq);
    if (
      isCredentialParam(decodeOnce(name)) ||
      (checkValues && hidesCredential(parts[i].slice(eq + 1)))
    ) {
      parts[i] = `${name}=${MASK}`;
    }
  }
  return parts.join("");
}

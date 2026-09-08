// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) for the MCP HTTP server.
 *
 * A client that has never authenticated has no token, and no way to guess where
 * to get one. RFC 9728 is how it asks: the server answers `401` with a
 * `WWW-Authenticate` challenge naming a metadata URL, and that document names
 * the authorization servers that issue tokens for this resource. Zuke is only
 * ever the **resource** — it issues nothing, and hosts no `/authorize`,
 * `/token` or `/register` endpoint. Those belong to whatever identity provider
 * an operator already runs, and {@link "./auth.ts".McpAuthenticator} is where
 * the tokens it mints are verified.
 *
 * Two details in here are easy to get wrong and silent when wrong, so both are
 * handled by {@link metadataPaths} rather than left to a caller:
 *
 * - The well-known segment is inserted **between the host and the path**, so a
 *   resource at `/mcp` publishes at `/.well-known/oauth-protected-resource/mcp`.
 *   Appending it to the path instead is the common bug, and a client that finds
 *   nothing there simply never authenticates.
 * - RFC 9728 §3.3 pulls two ways for a resource whose identifier has a path. A
 *   client that probed the root expects `resource` to be the bare origin; one
 *   that followed the challenge expects it to equal the URL it called. Each is
 *   told it MUST discard the document on a mismatch, so the same document is
 *   published at both locations — §3 permits exactly that ("The same protected
 *   resource MAY choose to publish its metadata at multiple well-known
 *   locations") — while the challenge always names the path-inserted one.
 *
 * @module
 */

/** The well-known URI suffix RFC 9728 reserves for this document. */
const WELL_KNOWN = "/.well-known/oauth-protected-resource";

/** Raised when a protected-resource declaration cannot produce a valid document. */
export class ProtectedResourceError extends Error {
  /** The error name. */
  override name = "ProtectedResourceError";

  /** Construct the error with `message`. */
  constructor(message: string) {
    super(message);
  }
}

/**
 * A build's protected-resource declaration, configured fluently.
 *
 * The resource identifier is the single value everything else has to agree
 * with, so it is a direct argument to {@link protectedResource}; the rest are
 * setters. It must be the **canonical URI of this MCP endpoint** — the same
 * string the client sends as its RFC 8707 `resource` parameter, and the same
 * string the identity provider mints into the token's `aud`. Those three
 * agreeing byte for byte is the whole contract; when they disagree every token
 * fails validation, and the error says nothing about why.
 */
export class ProtectedResourceSettings {
  /** The canonical resource identifier of this MCP endpoint. */
  resource_: string;
  /** Issuer identifiers of the authorization servers that issue for it. */
  authorizationServers_: string[] = [];
  /** Scope values a caller may request for this resource. */
  scopes_: string[] = [];
  /** Human-readable name of the resource, for a consent screen. */
  resourceName_?: string;
  /** URL of human-readable documentation for the resource. */
  documentation_?: string;

  /** Construct the settings for `resource`, the canonical endpoint URI. */
  constructor(resource: string) {
    this.resource_ = resource;
  }

  /**
   * Add an authorization server by its **issuer identifier** — `https://acme.eu.auth0.com`,
   * not its metadata URL. It must string-match the `issuer` in that server's own
   * metadata document, or a client is required to reject it. At least one is
   * required: RFC 9728 marks the field optional, but MCP raises it to required.
   */
  authorizationServer(issuer: string): this {
    this.authorizationServers_.push(issuer);
    return this;
  }

  /**
   * Declare the scope values a caller may request. These are advertised to
   * clients, which request them wholesale when a challenge names none, so keep
   * the list to what this server actually distinguishes rather than the whole
   * catalogue of a shared identity provider.
   */
  scopes(...values: string[]): this {
    this.scopes_.push(...values);
    return this;
  }

  /** Set the human-readable resource name shown on a consent screen. */
  name(value: string): this {
    this.resourceName_ = value;
    return this;
  }

  /** Set the URL of human-readable documentation for this resource. */
  documentation(url: string): this {
    this.documentation_ = url;
    return this;
  }
}

/**
 * Begin a protected-resource declaration for `resource`, the canonical URI of
 * this MCP endpoint (`https://build.example.com/mcp`).
 *
 * ```ts
 * import { Build, protectedResource } from "jsr:@zuke/core";
 *
 * class CI extends Build {
 *   override mcpProtectedResource() {
 *     return protectedResource("https://build.example.com/mcp")
 *       .authorizationServer("https://acme.eu.auth0.com")
 *       .scopes("zuke:run")
 *       .name("Acme build server");
 *   }
 * }
 * ```
 */
export function protectedResource(resource: string): ProtectedResourceSettings {
  return new ProtectedResourceSettings(resource);
}

/**
 * The resource identifier parsed, with the checks RFC 9728 §1.2 requires of it:
 * an absolute URL carrying no fragment. Throws {@link ProtectedResourceError}
 * naming the offending value, since this is a build-authoring mistake.
 */
function resourceUrl(resource: string): URL {
  let url: URL;
  try {
    url = new URL(resource);
  } catch {
    throw new ProtectedResourceError(
      `The protected resource identifier "${resource}" is not an absolute ` +
        `URL. Use the full URI of the MCP endpoint, e.g. ` +
        `"https://build.example.com/mcp".`,
    );
  }
  if (url.hash !== "") {
    throw new ProtectedResourceError(
      `The protected resource identifier "${resource}" has a fragment, which ` +
        `RFC 9728 forbids. Drop everything from the "#".`,
    );
  }
  return url;
}

/**
 * Every path the metadata document is published at, most specific first.
 *
 * For a resource with a path this is the path-inserted location followed by the
 * root one; for a resource that is a bare origin the two coincide and only one
 * is returned. A trailing slash on the resource is dropped before insertion, as
 * RFC 9728 §3.1 requires.
 */
export function metadataPaths(resource: string): string[] {
  const path = resourceUrl(resource).pathname.replace(/\/+$/, "");
  return path === "" ? [WELL_KNOWN] : [`${WELL_KNOWN}${path}`, WELL_KNOWN];
}

/**
 * The absolute URL a `WWW-Authenticate` challenge points at: always the
 * path-inserted location, which is the one a client can validate under both
 * halves of RFC 9728 §3.3.
 */
export function metadataUrl(resource: string): string {
  const url = resourceUrl(resource);
  return new URL(metadataPaths(resource)[0], url.origin).toString();
}

/**
 * The metadata document itself, as the JSON object RFC 9728 §2 defines.
 *
 * Fields with no values are omitted rather than serialised empty — §3.2 makes
 * that a MUST, and an empty `scopes_supported` would in any case advertise
 * "this resource accepts no scopes".
 */
export function metadataDocument(
  settings: ProtectedResourceSettings,
): Record<string, unknown> {
  const resource = resourceUrl(settings.resource_).toString().replace(
    /\/$/,
    "",
  );
  if (settings.authorizationServers_.length === 0) {
    throw new ProtectedResourceError(
      `The protected resource "${settings.resource_}" declares no ` +
        `authorization server. MCP requires at least one — call ` +
        `.authorizationServer(issuer) with your identity provider's issuer URL.`,
    );
  }
  const document: Record<string, unknown> = {
    resource,
    authorization_servers: [...settings.authorizationServers_],
    // Zuke reads the token from the header only; RFC 6750's query form is
    // forbidden by MCP outright, and the body form is meaningless for JSON-RPC.
    bearer_methods_supported: ["header"],
  };
  if (settings.scopes_.length > 0) {
    document.scopes_supported = [...settings.scopes_];
  }
  if (settings.resourceName_ !== undefined) {
    document.resource_name = settings.resourceName_;
  }
  if (settings.documentation_ !== undefined) {
    document.resource_documentation = settings.documentation_;
  }
  return document;
}

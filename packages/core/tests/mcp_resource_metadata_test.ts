// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertStringIncludes, assertThrows } from "./_assert.ts";
import {
  metadataDocument,
  metadataPaths,
  metadataUrl,
  protectedResource,
  ProtectedResourceError,
} from "../src/mcp/resource_metadata.ts";
import {
  bearerChallenge,
  INVALID_TOKEN,
  UNAUTHORIZED,
  withResourceMetadata,
} from "../src/mcp/auth.ts";

Deno.test("the well-known segment is inserted between host and path", () => {
  // The bug this pins: appending the well-known suffix to the path instead of
  // inserting it. A client fetches only the inserted form, so the appended one
  // is a 404 and discovery silently never happens.
  assertEquals(metadataPaths("https://build.example.com/mcp"), [
    "/.well-known/oauth-protected-resource/mcp",
    "/.well-known/oauth-protected-resource",
  ]);
  assertEquals(
    metadataUrl("https://build.example.com/mcp"),
    "https://build.example.com/.well-known/oauth-protected-resource/mcp",
  );
});

Deno.test("a resource with no path publishes at one location only", () => {
  // The two locations coincide, and RFC 9728 has no notion of publishing the
  // same document twice at the same URL.
  assertEquals(metadataPaths("https://build.example.com"), [
    "/.well-known/oauth-protected-resource",
  ]);
  assertEquals(metadataPaths("https://build.example.com/"), [
    "/.well-known/oauth-protected-resource",
  ]);
});

Deno.test("a deeper path and a trailing slash both insert correctly", () => {
  assertEquals(
    metadataPaths("https://build.example.com/team/mcp/")[0],
    [
      "/.well-known/oauth-protected-resource/team/mcp",
    ][0],
  );
});

Deno.test("the document carries what RFC 9728 and MCP require", () => {
  const document = metadataDocument(
    protectedResource("https://build.example.com/mcp")
      .authorizationServer("https://acme.eu.auth0.com")
      .scopes("zuke:run", "zuke:read")
      .name("Acme build server")
      .documentation("https://build.example.com/docs"),
  );
  assertEquals(document, {
    resource: "https://build.example.com/mcp",
    authorization_servers: ["https://acme.eu.auth0.com"],
    bearer_methods_supported: ["header"],
    scopes_supported: ["zuke:run", "zuke:read"],
    resource_name: "Acme build server",
    resource_documentation: "https://build.example.com/docs",
  });
});

Deno.test("a field with no values is omitted, not serialised empty", () => {
  // RFC 9728 3.2 makes this a MUST, and an empty `scopes_supported` would in
  // any case advertise "this resource accepts no scopes".
  const document = metadataDocument(
    protectedResource("https://build.example.com/mcp")
      .authorizationServer("https://acme.eu.auth0.com"),
  );
  assertEquals(Object.keys(document).includes("scopes_supported"), false);
  assertEquals(Object.keys(document).includes("resource_name"), false);
  assertEquals(Object.keys(document).includes("resource_documentation"), false);
});

Deno.test("a declaration with no authorization server is refused", () => {
  // Optional in RFC 9728, required by MCP — and a document without one tells a
  // client nothing it can act on.
  const error = assertThrows(
    () => metadataDocument(protectedResource("https://build.example.com/mcp")),
    ProtectedResourceError,
  );
  assertStringIncludes(error.message, "authorization server");
});

Deno.test("a resource identifier that is not a usable URL is refused", () => {
  assertThrows(
    () => metadataPaths("build.example.com/mcp"),
    ProtectedResourceError,
    "absolute URL",
  );
  assertThrows(
    () => metadataPaths("https://build.example.com/mcp#frag"),
    ProtectedResourceError,
    "fragment",
  );
});

Deno.test("a bare challenge carries no error, an invalid token does", () => {
  // OAuth 2.1 5.3.2: a request that presented no credentials gets no error
  // information, because nothing of the client's has been rejected yet.
  assertEquals(UNAUTHORIZED.challenge, "Bearer");
  assertEquals(bearerChallenge(), "Bearer");
  assertStringIncludes(INVALID_TOKEN.challenge ?? "", `error="invalid_token"`);
});

Deno.test("a challenge names the failure, the scopes and the metadata URL", () => {
  assertEquals(
    bearerChallenge({
      error: "insufficient_scope",
      scopes: ["zuke:run", "zuke:operate"],
      metadataUrl: "https://build.example.com/.well-known/x",
      description: "operator role required",
    }),
    `Bearer error="insufficient_scope", error_description="operator role ` +
      `required", scope="zuke:run zuke:operate", ` +
      `resource_metadata="https://build.example.com/.well-known/x"`,
  );
});

Deno.test("a value that would break out of the header is filtered", () => {
  // The allowed auth-param set excludes `"` and `\`, so interpolating an
  // unfiltered string is header injection — an exception message reaching
  // `description` is the realistic way that happens.
  const challenge = bearerChallenge({
    error: "invalid_token",
    description: `bad "quoted" \\ value`,
  });
  assertEquals(challenge.includes(`\\`), false);
  assertEquals(
    challenge,
    `Bearer error="invalid_token", error_description="bad quoted  value"`,
  );
  // Filtering to nothing drops the parameter rather than emitting an empty one.
  assertEquals(bearerChallenge({ description: `"""` }), "Bearer");
});

Deno.test("the metadata URL is added to a challenge, once", () => {
  assertEquals(
    withResourceMetadata("Bearer", "https://x.example.com/.well-known/y"),
    `Bearer resource_metadata="https://x.example.com/.well-known/y"`,
  );
  assertEquals(
    withResourceMetadata(
      `Bearer error="invalid_token"`,
      "https://x.example.com/.well-known/y",
    ),
    `Bearer error="invalid_token", ` +
      `resource_metadata="https://x.example.com/.well-known/y"`,
  );
  // An authenticator that set its own is left alone rather than given a second.
  const own = `Bearer resource_metadata="https://other.example.com/doc"`;
  assertEquals(withResourceMetadata(own, "https://x.example.com/y"), own);
});

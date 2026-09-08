// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertStringIncludes, assertThrows } from "./_assert.ts";
import {
  metadataDocument,
  metadataPath,
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
  assertEquals(
    metadataPath("https://build.example.com/mcp"),
    "/.well-known/oauth-protected-resource/mcp",
  );
  assertEquals(
    metadataUrl("https://build.example.com/mcp"),
    "https://build.example.com/.well-known/oauth-protected-resource/mcp",
  );
});

Deno.test("a resource that is a bare origin publishes at the root", () => {
  // Which is the conformant location *for that identifier* — not a second copy.
  // A path-bearing resource publishes only at its inserted path: a client that
  // probed the root would derive the bare origin as the expected `resource`
  // and, per RFC 9728 3.3, discard a document naming a path. Such a copy has no
  // correct consumer, so there is not one.
  assertEquals(
    metadataPath("https://build.example.com"),
    "/.well-known/oauth-protected-resource",
  );
  assertEquals(
    metadataPath("https://build.example.com/"),
    "/.well-known/oauth-protected-resource",
  );
});

Deno.test("a deeper path and a trailing slash both insert correctly", () => {
  assertEquals(
    metadataPath("https://build.example.com/team/mcp/"),
    "/.well-known/oauth-protected-resource/team/mcp",
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
    () => metadataPath("build.example.com/mcp"),
    ProtectedResourceError,
    "absolute URL",
  );
  assertThrows(
    () => metadataPath("https://build.example.com/mcp#frag"),
    ProtectedResourceError,
    "fragment",
  );
});

Deno.test("a bare challenge carries no error, an invalid token does", () => {
  // OAuth 2.1 5.3.1: a request that presented no credentials gets no error
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

Deno.test("the resource is emitted exactly as declared, not re-serialised", () => {
  // RFC 9728 3.3 has a client discard the document unless `resource` is
  // byte-identical to the URL it called. `new URL(x).toString()` is not
  // byte-preserving — it appends a slash to a bare origin — so normalising here
  // would break the very agreement the field exists to state.
  for (
    const declared of [
      "https://build.example.com/mcp",
      "https://build.example.com/mcp/",
      "https://build.example.com",
      "https://build.example.com/",
      "https://build.example.com:8443/mcp",
    ]
  ) {
    const document = metadataDocument(
      protectedResource(declared).authorizationServer(
        "https://idp.example.com",
      ),
    );
    assertEquals(document.resource, declared);
  }
});

Deno.test("an identifier that cannot make a well-known URL is refused at declaration", () => {
  // Each of these parses as a URL and would otherwise pass the startup check,
  // then fail when the transport derived a path or an absolute URL from it —
  // a throw on a public, unauthenticated route rather than a startup error.
  for (
    const [resource, expected] of [
      ["urn:example:zuke", "http(s)"],
      ["file:///srv/mcp", "http(s)"],
      ["https://build.example.com/mcp?tenant=a", "query string"],
      ["https://svc:hunter2@build.example.com/mcp", "userinfo"],
    ] as const
  ) {
    const error = assertThrows(
      () => metadataPath(resource),
      ProtectedResourceError,
    );
    assertStringIncludes(error.message, expected);
  }
});

Deno.test("the metadata parameter is matched as a parameter, not a substring", () => {
  // Both directions were wrong with a plain `includes`. A description merely
  // mentioning the word suppressed a real URL, silently killing discovery...
  const mentions = `Bearer error_description="see resource_metadata= docs"`;
  assertStringIncludes(
    withResourceMetadata(mentions, "https://x.example.com/doc"),
    `resource_metadata="https://x.example.com/doc"`,
  );
  // ...and a challenge that spelled the parameter differently got a second
  // copy, which RFC 7235 forbids and leaves clients to resolve as they like.
  // Auth-param names are case-insensitive and space around `=` is legal.
  for (
    const existing of [
      `Bearer resource_metadata = "https://attacker.example.com/as"`,
      `Bearer Resource_Metadata="https://attacker.example.com/as"`,
    ]
  ) {
    assertEquals(
      withResourceMetadata(existing, "https://x.example.com/y"),
      existing,
    );
  }
});

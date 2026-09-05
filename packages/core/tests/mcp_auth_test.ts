// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "./_assert.ts";
import {
  authenticateRequest,
  authenticatorFromHook,
  isResolvedIdentity,
  type McpAuthenticator,
  type McpAuthReject,
  normalizeIdentity,
  type ResolvedIdentity,
  UNAUTHORIZED,
} from "../src/mcp/auth.ts";
import { EMPTY_CONTEXT, type McpRequestContext } from "../src/mcp/jsonrpc.ts";

/** Wrap an `authenticate` implementation as an {@link McpAuthenticator}. */
function authenticator(
  authenticate: McpAuthenticator["authenticate"],
): McpAuthenticator {
  return { authenticate };
}

/** Run `authenticate` against the empty (stdio-shaped) context. */
function run(
  authenticate: McpAuthenticator["authenticate"],
): Promise<ResolvedIdentity | McpAuthReject> {
  return authenticateRequest(authenticator(authenticate), EMPTY_CONTEXT);
}

// ---- normalizeIdentity: what is, and is not, an identity -------------------

Deno.test("normalizeIdentity refuses anything that is not an identity object", () => {
  assertEquals(normalizeIdentity(null), null);
  assertEquals(normalizeIdentity(undefined), null);
  assertEquals(normalizeIdentity("ada"), null);
  assertEquals(normalizeIdentity(42), null);
  assertEquals(normalizeIdentity([]), null); // an array is not a record
  assertEquals(normalizeIdentity([{ actor: "ada" }]), null);
  assertEquals(normalizeIdentity({}), null); // no actor at all
  assertEquals(normalizeIdentity({ actor: 42 }), null); // non-string actor
  assertEquals(normalizeIdentity({ actor: null }), null);
  assertEquals(normalizeIdentity({ actor: "" }), null); // empty actor
});

Deno.test("normalizeIdentity settles kind and roles on a minimal identity", () => {
  // The key count is compared too, so this also pins that no `via` key is
  // invented for an identity that carried none.
  assertEquals(normalizeIdentity({ actor: "ada" }), {
    actor: "ada",
    kind: "human",
    roles: [],
  });
});

Deno.test("normalizeIdentity honours an explicit service kind", () => {
  assertEquals(normalizeIdentity({ actor: "deploy-bot", kind: "service" }), {
    actor: "deploy-bot",
    kind: "service",
    roles: [],
  });
});

Deno.test("normalizeIdentity reads an unknown kind as human, never service", () => {
  // The conservative default: only the exact literal `"service"` grants the
  // service kind, so a garbage value can never buy the more-privileged claim.
  for (
    const kind of ["admin", "Service", "SERVICE", " service", 1, null, {}, []]
  ) {
    const identity = normalizeIdentity({ actor: "ada", kind });
    assertEquals(identity?.kind, "human", `kind ${JSON.stringify(kind)}`);
  }
});

Deno.test("normalizeIdentity keeps only the non-empty string roles", () => {
  assertEquals(
    normalizeIdentity({ actor: "ada", roles: ["ops", "", 7, null, "deploy"] }),
    { actor: "ada", kind: "human", roles: ["ops", "deploy"] },
  );
});

Deno.test("normalizeIdentity yields no roles for a non-array roles", () => {
  for (const roles of ["ops", 7, null, undefined, { ops: true }]) {
    const identity = normalizeIdentity({ actor: "ada", roles });
    assertEquals(identity?.roles, [], `roles ${JSON.stringify(roles)}`);
  }
});

Deno.test("normalizeIdentity keeps a non-empty via and omits any other", () => {
  assertEquals(normalizeIdentity({ actor: "ada", via: "oauth-proxy" }), {
    actor: "ada",
    kind: "human",
    roles: [],
    via: "oauth-proxy",
  });
  for (const via of ["", 7, null, {}]) {
    const identity = normalizeIdentity({ actor: "ada", via });
    assertEquals(
      identity !== null && Object.hasOwn(identity, "via"),
      false,
      `via ${JSON.stringify(via)}`,
    );
  }
});

// ---- authenticateRequest: accepting a caller -------------------------------

Deno.test("authenticateRequest settles a synchronous identity", async () => {
  const result = await run(() => ({ actor: "ada", kind: "service" }));
  assertEquals(result, { actor: "ada", kind: "service", roles: [] });
});

Deno.test("authenticateRequest awaits an asynchronous identity", async () => {
  const result = await run(() =>
    Promise.resolve({ actor: "ada", roles: ["ops"], via: "oauth-proxy" })
  );
  assertEquals(result, {
    actor: "ada",
    kind: "human",
    roles: ["ops"],
    via: "oauth-proxy",
  });
});

Deno.test("authenticateRequest passes the request context through", async () => {
  const ctx: McpRequestContext = {
    headers: new Headers({ "x-forwarded-user": "ada" }),
  };
  const seen: McpRequestContext[] = [];
  const result = await authenticateRequest(
    authenticator((received) => {
      seen.push(received);
      return { actor: received.headers.get("x-forwarded-user") ?? "" };
    }),
    ctx,
  );
  assertEquals(seen.length, 1);
  assertEquals(seen[0], ctx);
  assertEquals(result, { actor: "ada", kind: "human", roles: [] });
});

// ---- authenticateRequest: fail-closed on a misbehaving authenticator -------

Deno.test("authenticateRequest turns a throw into the bare 401", async () => {
  const result = await run(() => {
    throw new Error("upstream token endpoint is down");
  });
  assertEquals(result, UNAUTHORIZED);
});

Deno.test("authenticateRequest turns a rejected promise into the bare 401", async () => {
  const result = await run(() => Promise.reject(new Error("timeout")));
  assertEquals(result, UNAUTHORIZED);
});

Deno.test("authenticateRequest refuses a result that is neither identity nor reject", async () => {
  // @ts-expect-error - a misbehaving authenticator returning `null`; the runtime guard must refuse it.
  assertEquals(await run(() => null), UNAUTHORIZED);
  // @ts-expect-error - likewise `undefined`, the value a forgotten `return` produces.
  assertEquals(await run(() => undefined), UNAUTHORIZED);
  // @ts-expect-error - likewise a bare string, e.g. an actor name returned unwrapped.
  assertEquals(await run(() => "ada"), UNAUTHORIZED);
  // @ts-expect-error - likewise an array, which is an object but not a record.
  assertEquals(await run(() => ["ada"]), UNAUTHORIZED);
  // @ts-expect-error - likewise a number.
  assertEquals(await run(() => 401), UNAUTHORIZED);
  assertEquals(await run(() => ({ actor: "" })), UNAUTHORIZED);
});

// ---- authenticateRequest: rejections cannot be laundered into successes ----

Deno.test("authenticateRequest keeps a well-formed rejection intact", async () => {
  const result = await run(() => ({
    status: 403,
    error: "insufficient_scope",
    detail: "needs the deploy role",
    challenge: `Bearer error="insufficient_scope"`,
  }));
  assertEquals(result, {
    status: 403,
    error: "insufficient_scope",
    detail: "needs the deploy role",
    challenge: `Bearer error="insufficient_scope"`,
  });
});

Deno.test("authenticateRequest accepts the client-error status range's ends", async () => {
  assertEquals(await run(() => ({ status: 400, error: "bad_request" })), {
    status: 400,
    error: "bad_request",
  });
  assertEquals(await run(() => ({ status: 499, error: "closed" })), {
    status: 499,
    error: "closed",
  });
});

Deno.test("authenticateRequest collapses a non-client-error status to the bare 401", async () => {
  // The security-critical arm: a refusal must never become a success (200), a
  // redirect (302), or a server error (500) at the transport, whatever the
  // authenticator put in `status`.
  assertEquals(await run(() => ({ status: 200, error: "ok" })), UNAUTHORIZED);
  assertEquals(await run(() => ({ status: 302, error: "go" })), UNAUTHORIZED);
  assertEquals(await run(() => ({ status: 399, error: "no" })), UNAUTHORIZED);
  assertEquals(await run(() => ({ status: 500, error: "boom" })), UNAUTHORIZED);
  assertEquals(await run(() => ({ status: 0, error: "none" })), UNAUTHORIZED);
  assertEquals(await run(() => ({ status: -401, error: "neg" })), UNAUTHORIZED);
  assertEquals(await run(() => ({ status: 401.5, error: "x" })), UNAUTHORIZED);
  assertEquals(await run(() => ({ status: NaN, error: "x" })), UNAUTHORIZED);
  // @ts-expect-error - a status given as a string must not sneak past the check.
  assertEquals(await run(() => ({ status: "401", error: "x" })), UNAUTHORIZED);
  // @ts-expect-error - nor a rejection that forgot its status entirely.
  assertEquals(await run(() => ({ error: "nope" })), UNAUTHORIZED);
});

Deno.test("authenticateRequest drops empty rejection strings", async () => {
  const result = await run(() => ({
    status: 403,
    error: "",
    detail: "",
    challenge: "",
  }));
  // The empty `error` falls back to the shared message; empty `detail` and
  // `challenge` are omitted rather than emitted as blanks on the wire.
  assertEquals(result, { status: 403, error: "Unauthorized" });
});

// ---- isResolvedIdentity ----------------------------------------------------

Deno.test("a result that is both an identity and a refusal is refused", async () => {
  // The typed union cannot produce this; an authenticator written in plain JS
  // can. A value carrying a `status` is a refusal even though it also names an
  // actor — between "deny" and "admit" for a value that says both, fail-closed
  // means deny.
  const confused = await run(() => ({
    actor: "ada",
    status: 403,
    error: "forbidden",
  }));
  assertEquals(confused, { status: 403, error: "forbidden" });

  // A malformed status on such a value still collapses to the bare challenge —
  // it never falls back through to the identity arm and becomes an admission.
  assertEquals(await run(() => ({ actor: "ada", status: 200 })), UNAUTHORIZED);
});

Deno.test("isResolvedIdentity tells an identity from a refusal", () => {
  assertEquals(
    isResolvedIdentity({ actor: "ada", kind: "human", roles: [] }),
    true,
  );
  assertEquals(isResolvedIdentity(UNAUTHORIZED), false);
  assertEquals(
    isResolvedIdentity({ status: 403, error: "insufficient_scope" }),
    false,
  );
});

// ---- authenticatorFromHook: the older synchronous seam ---------------------

Deno.test("authenticatorFromHook passes a hook's identity through", async () => {
  const auth = authenticatorFromHook((ctx) => ({
    actor: ctx.headers.get("x-forwarded-user") ?? "",
    kind: "service",
    roles: ["ops"],
  }));
  const result = await authenticateRequest(auth, {
    headers: new Headers({ "x-forwarded-user": "deploy-bot" }),
  });
  assertEquals(result, {
    actor: "deploy-bot",
    kind: "service",
    roles: ["ops"],
  });
});

Deno.test("authenticatorFromHook turns a throwing hook into the bare 401", async () => {
  const auth = authenticatorFromHook(() => {
    throw new Error("no trusted header");
  });
  assertEquals(await authenticateRequest(auth, EMPTY_CONTEXT), UNAUTHORIZED);
});

Deno.test("authenticatorFromHook refuses a hook that yields an empty actor", async () => {
  // The `headers.get(x) ?? ""` idiom: a hook that reads a header the proxy did
  // not set must refuse the request, not admit an anonymous caller under "".
  const auth = authenticatorFromHook((ctx) => ({
    actor: ctx.headers.get("x-forwarded-user") ?? "",
  }));
  assertEquals(await authenticateRequest(auth, EMPTY_CONTEXT), UNAUTHORIZED);
});

// ---- the shared refusal ----------------------------------------------------

Deno.test("UNAUTHORIZED is the bare 401 Bearer challenge", () => {
  // Pinned because the static-bearer path and the authenticator path share it:
  // a wrong token and a failed authenticator answer identically, so neither
  // tells a prober which of the two it got past.
  assertEquals(UNAUTHORIZED.status, 401);
  assertEquals(UNAUTHORIZED.error, "Unauthorized");
  assertEquals(UNAUTHORIZED.challenge, "Bearer");
  // No detail, so the reason the HTTP transport writes into the JSON-RPC error
  // body is exactly `error` — "Unauthorized", with nothing about why.
  assertEquals(UNAUTHORIZED.detail, undefined);
});

// ---- Regressions: an authenticator's own failure is still a refusal ---------

Deno.test("a throwing property getter on the result is a refusal, not a fault", async () => {
  // Wrapping verified claims in getters is the natural shape for an OAuth
  // authenticator, and a getter can throw — a missing `scope` claim, say. Every
  // read of the result must therefore be guarded, not just the call that
  // produced it, or the throw escapes as a transport fault carrying no
  // challenge instead of the refusal this seam promises.
  const throwing = (field: string): McpAuthenticator["authenticate"] => () => ({
    actor: "ada",
    get [field](): never {
      throw new Error(`no ${field} claim`);
    },
  });
  for (const field of ["actor", "kind", "roles", "via", "status"]) {
    assertEquals(await run(throwing(field)), UNAUTHORIZED, field);
  }

  // Including the reject arm: a refusal whose own fields throw still refuses.
  assertEquals(
    await run(() => ({
      status: 403,
      get error(): never {
        throw new Error("boom");
      },
    })),
    UNAUTHORIZED,
  );
});

Deno.test("a challenge a header cannot carry is dropped, not sent", async () => {
  // `Headers.set` throws on CR/LF, NUL and anything outside Latin-1. The
  // challenge is the one field of a refusal that becomes a header, so an
  // one that cannot be sent is dropped exactly like an absent one — the refusal still
  // goes out with its own status, rather than becoming a fault with no
  // challenge at all. (A CR/LF value would otherwise be a header-injection
  // attempt; `Headers` rejects it and so do we.)
  for (
    const challenge of [
      'Bearer realm="x"\r\nX-Injected: 1',
      "Bearer\nSet-Cookie: a=b",
      "Bearer\u0000",
      "Bearer \u{1f510}", // outside Latin-1
    ]
  ) {
    assertEquals(
      await run(() => ({ status: 401, error: "invalid_token", challenge })),
      { status: 401, error: "invalid_token" },
      JSON.stringify(challenge),
    );
  }

  // A challenge that *is* sendable survives untouched — including a Latin-1
  // character, which a header can carry, so the guard must not over-reject.
  for (
    const challenge of [
      'Bearer realm="zuke", error="invalid_token"',
      "Bearer é",
    ]
  ) {
    assertEquals(
      await run(() => ({ status: 401, error: "invalid_token", challenge })),
      { status: 401, error: "invalid_token", challenge },
      challenge,
    );
  }
});

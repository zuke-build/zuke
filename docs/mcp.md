# MCP server

`./zuke mcp` — a command on **your build's own CLI**, not the globally installed
`jsr:@zuke/cli` (see the [CLI reference](./cli.md) for the difference) — runs a
[Model Context Protocol](https://modelcontextprotocol.io) server over your
build. MCP is the open standard that lets an AI client — Claude Desktop, Claude
Code, an IDE, any agent — discover a server's **tools** (typed, schema-described
functions) and call them. Pointing a client at `./zuke mcp` lets an agent
**operate the pipeline through typed calls** — list the targets, inspect the
graph, run one with the right parameters — instead of guessing shell
invocations.

It's a natural extension of what Zuke already does: it publishes `llms.txt`, a
`--list --json` self-description, and shell completions from a single registry.
MCP is the _live_ counterpart — the same build surface, callable.

The server is **dependency-free** (Zuke ships no MCP SDK): it speaks
newline-delimited JSON-RPC 2.0 on stdio, the standard MCP local transport.

## Running it

```sh
./zuke mcp              # read-only: inspect the build, never execute
./zuke mcp --allow-run  # also expose run:<target> tools that execute targets
```

The process reads JSON-RPC from stdin and writes responses to stdout; its one
startup line goes to stderr so it never corrupts the protocol stream. It runs
until stdin closes.

### Registering with a client

Most clients take a command to launch the server. For example, with Claude Code:

```sh
claude mcp add zuke -- deno run -A zuke.ts mcp
```

Any client that speaks stdio MCP works the same way — give it the command
`deno run -A zuke.ts mcp` (add `--allow-run` when you want the agent to execute
targets).

## HTTP transport

For a client that connects over the network rather than launching the process,
`--http` serves MCP's **streamable-HTTP** transport instead of stdio:

```sh
./zuke mcp --http 7777                 # bind 127.0.0.1:7777 (local only)
./zuke mcp --http 0.0.0.0:7777         # all interfaces — token or mcpAuth()
```

Each request is a `POST` whose body is one JSON-RPC message; the response is
that message's JSON-RPC reply. A notification (no `id`) is answered
`202 Accepted` with no body. Zuke never initiates server→client messages, so the
optional server-sent-events stream is not implemented — a `GET` is answered
`405`, and clients fall back to POST-only (which is spec-compliant). For the
single-build server, messages are processed **one at a time**, mirroring stdio,
so two concurrent runs of the one build can't race. The
[registry server](#registry-mode-dynamic-discovery) — which has no shared
in-process run state — instead handles requests **concurrently** (see its cap
below), so one long `run:` never head-of-line-blocks another client's read.

**Security defaults — a bridge, not an internet gateway:**

- `--http <port>` binds **loopback** (`127.0.0.1`), reachable only from the same
  host.
- Binding a **non-loopback** address requires authentication — **either** a
  bearer token (set `ZUKE_MCP_TOKEN`, and every request must send
  `Authorization: Bearer <token>`; a missing or wrong token gets `401`) **or**
  an [`mcpAuth()`](#mcpauth--the-general-seam) authenticator on the build. With
  neither, Zuke **refuses to bind** a non-loopback address rather than exposing
  an unauthenticated endpoint.
- [`mcpIdentity()`](#mcpidentity--sugar-for-a-proxy-header) does **not** satisfy
  that requirement, though it still runs on every request. It trusts a header,
  which is only an identity when something in front strips the client's copy and
  injects its own — on a directly reachable endpoint any caller sets that header
  itself. Such a build needs the bearer token to bind off loopback, or a proxy
  in front of a loopback bind.
- A token is also enforced on a loopback bind when `ZUKE_MCP_TOKEN` is set, and
  an authenticator runs on every bind, loopback included. The two compose: the
  token is a shared secret that gates the endpoint, the authenticator says _who_
  is calling.
- **The order a request passes:** the
  [metadata document](#telling-a-client-where-to-authenticate) when one is
  declared and the path matches (a public `GET`) → HTTP method (a non-`POST`
  gets `405`) → `Origin` (`403`) → the static bearer token (`401`) → the
  [authenticator](#authentication) (the refusal's own status) →
  `MCP-Protocol-Version` (`400`) → the body (capped at 1 MiB; over it, `413`).
  Authentication runs **before** the body is read, so an unauthenticated caller
  never makes the server buffer its payload.
- **Origin validation** guards against a browser drive-by / DNS-rebinding page:
  on a loopback bind, a request that carries an `Origin` header is accepted only
  when it is a loopback origin, and rejected `403` otherwise. A client that
  sends no `Origin` (a CLI/MCP client — not a browser) is always allowed, so
  this is invisible to normal use. Permit a specific extra origin with
  `--allowed-origin <origin>` (repeatable); when set, a present `Origin` must
  match one exactly. A non-loopback bind runs no default Origin check — front it
  with your own policy.
- This is a bridge for a trusted network segment: **put real TLS and
  authentication in front of it** (a reverse proxy, a service mesh) for anything
  production-facing. Zuke provides the transport, not an internet gateway.

`--allow-run` and the [safety](#safety) model below apply identically over HTTP.

## Tools

Read tools are always available:

| Tool             | Returns                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `list_targets`   | Every target with its description and dependencies.                                          |
| `describe_build` | The full build surface — commands, flags, targets, parameters (the `--list --json` payload). |
| `graph`          | Each target and the targets it depends on.                                                   |

When a [state store](./state.md) resolves, two more read tools appear, so an
agent can query runs it did not start:

| Tool        | Returns                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------ |
| `list_runs` | Persisted run summaries (optional `status`/`target`/`since` filters), newest first.        |
| `show_run`  | One run's full record — status, per-target progress, and signals. Refuses the audit trail. |

With `--allow-run`, the server also exposes one **`run:<target>`** tool per
target (subject to the [allow-list](#authorization)). Its input schema is built
from the build's declared parameters — a `required` parameter is required,
`.options(...)` becomes an `enum`, a `.number()` is typed as a number — plus a
`dryRun` flag that plans without executing. A run tool carries MCP's
`destructiveHint` by default, or `readOnlyHint` when the target declares
[`.readOnly()`](./authoring.md); a client can prompt accordingly. A run resolves
parameters exactly like the CLI (MCP argument → the environment → the declared
default) and returns the target's captured output with a pass/fail marker.

With `--allow-run` a store also exposes four **mutating** run-state tools:
`signal_run` (deliver an external signal and resume a suspended run,
exactly-once), `resume_check` (re-check suspended runs — predicate waits and
timeouts), `cancel_run` (cancel a run and run its
[compensations](./orchestration.md#cancellation--compensation--oncancel)), and
`force_target` (settle one target without running it — see
[forcing a target](./state.md#forcing-a-target--overrides)). They are the MCP
counterparts of `./zuke resume`, `./zuke cancel` and `./zuke force`. Each runs
the target's code (a resume continues it; a cancel runs its compensations), so
it is gated by the same [allow-list and operator-token](#authorization) policy
as a `run:` tool and appended to the [audit log](#audit-log).

```jsonc
// tools/call
{ "name": "run:test", "arguments": { "environment": "dev", "coverage": true } }
```

## Authorization

`--allow-run` on its own exposes every target. Three flags tier access from
there — a spectrum from "inspect only" to "run this, but only with an operator
token".

- **Allow-list — `--allow-run=<globs>`.** Only targets matching the comma-glob
  list (`deploy,checks*`) are exposed as run tools; every other target is
  **invisible**, and a call to one is answered exactly like a call to a
  nonexistent tool (`Unknown tool: run:<name>`) — so a denial never reveals
  which protected targets exist. The allow-list gates **invocation**: invoking a
  target runs its dependencies, which is what depending on a target means, so
  allow-listing `release` allows everything `release` does. Scope it to the
  entry points you want an agent to have, not to individual steps. The read
  tools narrow to match — with an allow-list they describe the allow-listed
  targets and their dependency closure, and nothing else, so a target outside it
  is genuinely unreachable rather than merely undisplayed.
- **Operator token — `--protect <globs>` + `ZUKE_OPERATOR_TOKEN`.** A run that
  would execute a matching target gains a required `operatorToken` argument,
  checked (in constant time) against `ZUKE_OPERATOR_TOKEN`. Protection is a
  property of the **operation**, so it is enforced across the whole plan: a
  protected `deploy` reached as a dependency of an unprotected `release` still
  demands the token, and `run:release` advertises the requirement in its schema.
  This is **fail-closed**: if no token is configured, every protected target is
  denied; and a call whose plan cannot be resolved (a run record whose root
  target no longer exists) is denied rather than assumed harmless — so a
  misconfigured server can never silently expose one. A denial is a structured
  `{"error": "unauthorized", …}` result, and the token is never written to the
  audit log or any output.
- **Confirmation — `--confirm-destructive`.** A destructive run tool (any target
  that is not `.readOnly()`) called without `confirm: true` returns its resolved
  **plan** instead of executing, prompting the caller to re-send with
  `confirm: true`. One round-trip, no server-side state; a `dryRun` skips the
  gate, and read-only targets are exempt.

```sh
# Expose everything to run, but gate promoteToProd behind an operator token
# and make every destructive run confirm first:
ZUKE_OPERATOR_TOKEN=… ./zuke mcp --http 7777 \
  --allow-run --protect promoteToProd --confirm-destructive
```

### Roles

The three flags above are **process-wide**: they say what _anyone_ reaching this
server may do. Once the server [authenticates](#authentication) its callers it
can say what _this_ caller may do, which is what roles are for.

Three built-in roles are ordered — `read` < `run` < `operator` — so an operator
satisfies a requirement for `run` without being granted it separately. Any other
name is matched **exactly**: an identity provider's own group (`sre`,
`release-manager`) works with `requiresRole` without being ranked into a
hierarchy it never agreed to. Map your groups onto the three tiers for the
general permission and use your own names for the specific one.

The shipped default policy:

| Call                                                                        | Needs                                                                                                                                        |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_*` / `show_*` / `describe_*` / `graph`                                | `read`                                                                                                                                       |
| `run:<target>`                                                              | `run`, **and** every `requiresRole` declared anywhere in the plan it would run                                                               |
| `cancel_run` / `signal_run` / `force_target`, and `resume_check` on one run | the run's [initiator](./state.md#actor-and-initiator--two-different-questions) or `operator`, **and** every `requiresRole` in the run's plan |
| `resume_check` sweeping every run                                           | `operator`                                                                                                                                   |

`requiresRole` can only **raise** the bar — `run` is the floor for executing
anything, so declaring `requiresRole("read")` does not let a read-only caller
run a target. It is enforced **across the whole plan**, like `--protect` and for
the same reason: invoking a target runs its dependencies, so a requirement that
guarded only the entry point would be bypassed by invoking anything that depends
on it. A run-scoped mutation executes the run's plan too, so the same
requirements apply to resuming, signalling, cancelling or forcing it.

A run whose initiator is a **service** may be steered by any caller holding
`run`: a scheduler's run has no person to ask, and treating the scheduler as its
owner would mean nobody could intervene.

Presenting a valid `ZUKE_OPERATOR_TOKEN` **grants the `operator` role** for that
call, so the shared secret and the role model are one policy rather than two
that can disagree — and a deployment can move to roles a piece at a time.

Override the whole decision with `mcpAuthorize` when the rule is something the
engine cannot know — a change window, team ownership, a freeze:

```ts
class ControlPlane extends Build {
  override mcpAuthorize(identity: McpIdentity, call: McpCall) {
    if (call.tool === "run:promote" && !inChangeWindow()) {
      return { allow: false, reason: "outside the change window" };
    }
    return defaultMcpAuthorize(identity, call);
  }
}
```

It runs **after** the allow-list and operator-token checks, so it can narrow
what those permit and never widen it.

**Two servers are deliberately unaffected.** One with no authenticator at all
treats every caller as holding every role, so `--allow-run`, `--protect` and the
operator token remain exactly the gates they were. And a build using the legacy
`mcpIdentity()` hook — the header-trusting seam, which never had roles to give —
is not constrained by the policy either. Those two are what keep a local stdio
server, and every deployment that predates roles, working unchanged.

Whether roles are enforced is a property of the **seam**, not of one identity:
declaring `mcpAuth()` opts in, and an identity it returns without a `roles` list
settles to none and is denied. Inferring it per identity would mean a token
carrying _less_ information bought _more_ privilege. An override of
`mcpAuthorize` still runs in every case, including the legacy seam, since a
change window or a freeze applies whether or not roles are in play.

`requiresRole` is the exception to "the legacy seam is left alone": a target
that declares one is **refused** for a caller whose authenticator cannot express
roles, naming the seam. Silently ignoring the declaration would tell you a
target is gated when nothing is checking. A server that declares no roles —
every server that predates this — is unaffected, since the refusal can only fire
on a declaration someone has just added.

In **registry mode** the policy decides on the tiers alone — `read` to list or
describe a registered build, `run` to spawn one — because a registry descriptor
carries no per-target `requiresRole`.

## Audit log

With a store configured, **every mutating or denied tool call** (`run:<target>`,
`signal_run`, `resume_check`, `cancel_run`, `force_target`) is appended to an
audit trail: the time, the tool, the resolved **actor**, the outcome (`ok` /
`denied` / `error`), and the call's arguments — plus, when the server
authenticated the caller, the **roles** they held, which is what makes a denial
answerable afterwards: who was refused, by which rule, and what they were
carrying at the time. Arguments are **redacted** — the operator token is dropped
and every `.secret()` parameter's value is masked — before anything is
persisted.

The trail lives in a store-level record; read it with
`./zuke runs show mcp-audit` **on the host**. It is deliberately not readable
over MCP — `show_run` refuses it and `list_runs` omits it — because the clients
it audits must not be able to read who called what, or to confirm which of their
calls were denied. The actor resolves by precedence: the **authenticated
identity** ([below](#authentication)) → `--actor` → `ZUKE_ACTOR` → the CI actor
→ the connecting client's `initialize` name → `"anonymous"`. The client name is
an **untrusted label** for the trail only — it never influences authorization.
On a shared HTTP endpoint it reflects the most recent client to connect, so
declare an authenticator (or set `--actor`) for authoritative attribution there.

## Authentication

By default the server does not identify its callers: on stdio it inherits the
trust of the shell that launched it, and over HTTP `ZUKE_MCP_TOKEN` is a shared
secret, not an identity. On a shared, multi-user endpoint "who did this" must
not be self-reported, so a build can declare an **authenticator** that runs once
per request, **before any dispatch**, on both transports.

### `mcpAuth()` — the general seam

`override mcpAuth()` returns an object with an `authenticate(ctx)` method. It
may be asynchronous (verifying a token signature is), and it either returns an
**identity** — `{ actor, kind?, roles?, via? }` — or refuses with an
**`McpAuthReject`**:

```ts
class ControlPlane extends Build {
  override mcpAuth(): McpAuthenticator {
    return {
      authenticate: async (ctx: McpRequestContext) => {
        const claims = await verifyBearer(ctx.headers.get("authorization"));
        if (claims === null) {
          return {
            status: 401,
            error: "invalid_token",
            detail: "expired or unknown bearer token",
            challenge: 'Bearer realm="zuke", error="invalid_token"',
          };
        }
        return { actor: claims.sub, kind: "service", roles: claims.roles };
      },
    };
  }
}
```

`ctx` is the request context: its `headers`, plus the underlying `request` (so
an authenticator can read the method and URL) when the caller arrived over HTTP.
On **stdio** both are empty — an authenticator that insists on a header refuses
every stdio call, which is the point: declare one for the endpoint you actually
expose.

The identity's fields:

| Field   | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actor` | The authenticated caller. Required and non-empty — anything else refuses the request.                                                                                                                                                                                                                                                                                                                                                                          |
| `kind`  | `"human"` or `"service"`. Omitted reads as `"human"`, so a service claim must be stated.                                                                                                                                                                                                                                                                                                                                                                       |
| `roles` | The caller's roles, in three states. **Omitted** means this authenticator does not speak roles — only meaningful for the legacy `mcpIdentity()` seam, whose callers the [policy](#roles) leaves alone. An **empty list** means the question was considered and nothing granted, which denies. A **non-empty list** is evaluated. An `mcpAuth()` identity that omits the list settles to empty, so a token carrying less information never buys more privilege. |
| `via`   | How the identity was established (`"oauth-proxy"`). Informational only.                                                                                                                                                                                                                                                                                                                                                                                        |

The resolved `actor` overrides `--actor`, the environment, and the client label
for that call, and flows to the [audit trail](#audit-log), run records,
lock-holder identity, and a registry-spawned child's `ZUKE_ACTOR`. `kind` and
`roles` reach a [registry](#registry-mode-dynamic-discovery)-spawned child as
`ZUKE_ACTOR_KIND` and `ZUKE_ACTOR_ROLES` (each role percent-encoded, so a name
containing the separator survives). `roles` **is** an authorization input — see
[Roles](#roles) — alongside the
[allow-list, `--protect` and the operator token](#authorization), which still
gate a call first.

### `mcpIdentity()` — sugar for a proxy header

`override mcpIdentity()` is the older, synchronous seam, unchanged for authors:
front the server with an authenticating reverse proxy (e.g. OAuth 2.1) that
injects the real caller in a header it strips from client input, and return that
caller. **Any throw rejects the request.**

```ts
class ControlPlane extends Build {
  override mcpIdentity() {
    return (ctx: McpRequestContext) => {
      const sub = ctx.headers.get("x-forwarded-user"); // proxy-injected
      if (!sub) throw new Error("no identity from proxy"); // any throw rejects
      return { actor: sub, via: "oauth-proxy" };
    };
  }
}
```

Internally it is adapted onto an `McpAuthenticator` and runs on exactly the same
path, so there is one authentication code path rather than two that can drift.
It is the right seam when a proxy has already done the authenticating; reach for
`mcpAuth()` when callers reach the server directly, when the check is async, or
when you want to answer with a status and a challenge of your own.

Because it authenticates nothing on its own, it does not unlock a
[non-loopback bind](#http-transport): that still needs `ZUKE_MCP_TOKEN` or an
`mcpAuth()` authenticator. Bind loopback and let the proxy reach it, or set the
token as well.

Declare **one or the other**. A build that declares both makes `./zuke mcp`
print a message to stderr and **exit 1** rather than letting one silently win.

### Refusing: the `McpAuthReject` contract

| Field       | Meaning                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| `status`    | The HTTP status to answer with. Must be an integer **client error** (`400`–`499`) — `401` or `403` in practice.           |
| `error`     | A short reason, machine-readable where a standard code exists (`"invalid_token"`). It becomes the JSON-RPC error message. |
| `detail`    | Optional human-readable detail, appended as `error: detail`. Returned to the caller — never put a secret in it.           |
| `challenge` | Optional `WWW-Authenticate` header value.                                                                                 |

A `status` outside `400`–`499` — or a non-integer, or none at all — **collapses
to a bare `401`**
(`{ status: 401, error: "Unauthorized", challenge: "Bearer" }`). The rule exists
so an authenticator cannot turn its own refusal into a success at the transport:
a returned `status: 200` would otherwise answer `200` to a request the build
meant to deny.

### The refusal a client sees (behaviour change)

A refused HTTP request now answers **`401`** — or the reject's own status —
carrying its `WWW-Authenticate` challenge when it has one. It previously
answered `200` with a JSON-RPC error. **The JSON-RPC error is still in the
body** (`-32600`, message `error` or `error: detail`, with a `null` id since the
body was never read), so a client that only reads JSON-RPC still sees a reason.

This is the point of the change: an MCP client discovers _where_ to authenticate
from the `401` and its challenge, which a JSON-RPC error inside a `200` can
never tell it. A client that treats every `200` as "connected" will now see the
refusal it should have seen all along.

Over **stdio** there is no status to answer with, so a refusal is a JSON-RPC
`-32600` error carrying the same reason the HTTP body does: the reject's
`error`, and its `detail` after a colon when it has one. Only the status and the
challenge have nowhere to go there.

### Fail-closed

The seam denies rather than admits, whatever the authenticator does. All of
these refuse the request — nothing executes, nothing is written to state, and
none of them falls back to the static actor, so the identity's precedence stays
absolute:

- the authenticator **throws** (the refusal is a bare `401`, so a throw leaks
  nothing about why it threw);
- it returns something that is **not an object** (`null`, a string, an array);
- its `actor` is **empty or not a string** — e.g. `headers.get(…) ?? ""` when
  the header is missing;
- its rejection is **malformed** (see the status rule above).

An unknown `kind` reads as `"human"` and malformed `roles` entries drop out,
rather than refusing: a value that is _nearly_ an identity must never become a
_more privileged_ one than the authenticator meant.

Without either override, stdio/local behaviour is unchanged.

### In a registry-spawned child

A [registry](#registry-mode-dynamic-discovery) run spawns the registered build,
and the resolved caller travels with it as three environment variables:
`ZUKE_ACTOR`, `ZUKE_ACTOR_KIND` (`"human"` when the authenticator omitted it)
and `ZUKE_ACTOR_ROLES` (comma-joined, empty when there are none — a role name
containing a comma is dropped when the identity is resolved, so splitting on the
separator is safe). They are written **together**, and only when the resolved
actor is non-empty, so an inherited kind or role set can never survive beside a
fresh actor — the child would otherwise read one caller's actor with another's
entitlements. They override anything inherited; the spawned build reads them
itself (`ZUKE_ACTOR` is the usual actor source, and the other two are there for
a build that wants to branch on who launched it).

### Telling a client where to authenticate

Verifying a token only helps a client that already has one. A fresh
`claude mcp add --transport http <url>` has nothing, and no way to guess where
to get one — so it asks, the way OAuth 2.0 defines: it reads the
`WWW-Authenticate` challenge on the `401`, fetches the metadata document that
challenge names, and finds the authorization server there.

`mcpProtectedResource()` publishes that document. Zuke is only ever the
**resource**: it issues no tokens and hosts no `/authorize`, `/token` or
`/register` endpoint. Those belong to whatever identity provider you already run
— Auth0, Okta, Entra, Keycloak, Dex — and `mcpAuth()` above is where the tokens
it mints are verified.

<!-- check -->

```ts
import { Build, protectedResource, run, target } from "jsr:@zuke/core";

class ControlPlane extends Build {
  deploy = target().executes(() => {});

  override mcpProtectedResource() {
    return protectedResource("https://build.example.com/mcp")
      .authorizationServer("https://acme.eu.auth0.com")
      .scopes("zuke:run")
      .name("Acme build server");
  }
}

await run(ControlPlane);
```

That is the whole configuration. The server then answers an unauthenticated call
with

```http
401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://build.example.com/.well-known/oauth-protected-resource/mcp"
```

and serves the document that URL names.

**Three strings must agree, byte for byte.** This is the one thing that goes
wrong, and when it does, every token fails validation and nothing in the error
says why:

1. the `resource` in the document — what you pass to `protectedResource(...)`;
2. the `resource` parameter the client sends on both the authorization and the
   token request, which is this same string echoed back;
3. the **audience** your identity provider puts in the token — Auth0's API
   Identifier, Okta's audience, Entra's `api://{app-id-uri}`.

Set all three to the canonical URI of the MCP endpoint, with no trailing slash
and no fragment. Your `mcpAuth()` verifier must then check that `aud` really is
this server: a resource server that skips the audience check accepts tokens
minted for some other service, which is the confused-deputy hole the MCP
specification prohibits outright.

The `authorizationServer(...)` value is the provider's **issuer identifier**
(`https://acme.eu.auth0.com`), not its metadata URL. It has to string-match the
`issuer` in that provider's own metadata document, or a client is required to
reject it.

**Everything in this document is public.** It has to be: a caller asking where
to authenticate has nothing to authenticate with, so the route is served before
the bearer token and the authenticator, and it is readable cross-origin because
browser-based clients fetch it that way. Treat the four fields you supply as
published — the resource URI, the issuer, the scope names, and the resource name
and documentation URL. On a machine where the server binds loopback, that also
means a web page the developer happens to visit can read them; an internal
hostname in the resource URI is the realistic thing to think twice about. A
credential in the identifier is refused outright rather than left to judgement,
since a `https://user:pass@host/mcp` would otherwise be published verbatim in a
cacheable document.

The path is derived for you, because getting it wrong is silent. The well-known
segment is inserted **between the host and the path**, so an endpoint at `/mcp`
publishes at `/.well-known/oauth-protected-resource/mcp` rather than the
appended form — a client fetches only the inserted one.

It is published at exactly that one location. Serving a second copy at the root
looks like cheap insurance and is not: RFC 9728 has a client derive the
`resource` it expects from the URL it fetched, so a client that probed the root
expects the bare origin and must discard a document naming a path. That copy
would have no correct consumer — a conformant client tries the path-inserted URL
first and never asks for the root, and one that only asks for the root would
throw away what it found. A resource declared as a bare origin publishes at the
root, because for that identifier the root *is* the derived location.

Dynamic client registration is **not** required. The MCP specification asked for
it in revision `2025-06-18`, demoted it to optional in `2025-11-25`, and marks
it deprecated in the current `2026-07-28` — client id metadata documents and
pre-registration are the sanctioned routes now. Verified against a real client:
given a pre-registered client id it goes straight from discovery to
`/authorize` and never touches a registration endpoint. So a provider that
offers no registration — a GitHub OAuth App, for one — is usable: register the
client once, out of band.

Verifying tokens is still not Zuke's job. Do not hand-roll it — import a
maintained JOSE library in your build file (the build is ordinary code and may
depend on whatever you like, unlike the published packages) and let it do the
signature, the claims and the key rotation. The fragment below shows the shape,
not a complete file — `UNAUTHORIZED`, `INVALID_TOKEN` and `McpAuthenticator`
come from `jsr:@zuke/core`, and `rolesOf` is yours to write:

```ts
import { createRemoteJWKSet, jwtVerify } from "npm:jose";

const jwks = createRemoteJWKSet(
  new URL("https://acme.eu.auth0.com/.well-known/jwks.json"),
);

override mcpAuth(): McpAuthenticator {
  return {
    authenticate: async (ctx) => {
      const token = (ctx.headers.get("authorization") ?? "").replace(/^Bearer /i, "");
      if (token === "") return UNAUTHORIZED;
      try {
        const { payload } = await jwtVerify(token, jwks, {
          issuer: "https://acme.eu.auth0.com",
          audience: "https://build.example.com/mcp", // the same third string
        });
        return { actor: String(payload.sub), kind: "human", roles: rolesOf(payload) };
      } catch {
        return INVALID_TOKEN;
      }
    },
  };
}
```

`UNAUTHORIZED` and `INVALID_TOKEN` are two refusals on purpose. A caller that
presented nothing is told only that it must authenticate; one whose token was
rejected is told that much. Sending `invalid_token` to a client that has simply
never logged in tells it its stored credential was refused, which is both untrue
and the wrong thing to act on.

TLS and header stripping remain the proxy's job, and the OAuth flow itself
remains the identity provider's. Zuke authenticates, authorizes and says where
to go — deliberately nothing more.

## Registry mode (dynamic discovery)

By default `./zuke mcp` serves the single build its process was launched with.
With `--registry` it instead serves the [build registry](./registry.md) — the
catalog `./zuke register` writes to — and **re-reads it on every `tools/list`
and `tools/call`**. So a pipeline registered by another process appears as a
tool in an already-running server with **no restart**:

```sh
# Serve every registered pipeline, execution enabled:
./zuke mcp --registry --allow-run
```

- **Discovery.** `list_builds` returns the catalog; `describe_build` (with a
  `build` id) returns one build's surface. Each registered target is exposed as
  a `run:<buildId>:<target>` tool, re-read live.
- **Execution is a spawn.** A registered build has no live instance in the
  server, so a run tool **spawns the build's registered launch location** (the
  `deno run <module> <target>` `./zuke register` recorded, or an explicit
  command) and returns its captured output. This is code execution, so it is off
  unless `--allow-run`, and it honours the same [authorization](#authorization)
  tiers — the allow-list and `--protect` globs match the **qualified**
  `<buildId>:<target>` name (e.g. `--allow-run=Api:*`, `--protect=Api:deploy`).
  Every mutating or denied call is [audited](#audit-log).
- **Where it spawns from is checked too.** The registry names the launch
  location, so a registry a second party can write to would otherwise be enough
  to run attacker-chosen code. A **remote** entry module (anything that is not a
  local path or `file:` URL — `https:`, `jsr:`, `npm:`, `data:`) is refused
  unless its origin appears in `ZUKE_REGISTRY_LAUNCH_HOSTS` (comma- or
  space-separated; `*` allows any; the token is the hostname, or the scheme when
  the specifier carries none, like `jsr:`). An allow-listed `http:` origin
  additionally needs `ZUKE_ALLOW_INSECURE_URL=1`; loopback does not. The check
  runs **before** the `--confirm-destructive` prompt, so a refused location
  fails fast: the call returns a structured `launch_origin_not_allowed` (or
  `insecure_launch_url`) error and is audited as `denied`, with nothing spawned.
  Locations `./zuke
  register` writes are local, so this is invisible to the
  ordinary setup.
- **Parameters.** A run tool exposes the registered build's declared parameters
  as its input schema — keyed by the parameter's property name (e.g. `skipE2e`),
  with the kind, description, enum, and default from the descriptor. Supplied
  values are validated against their kinds **before** the build spawns (a type
  mismatch — a bare string where an array is required, a non-numeric number, an
  out-of-set enum, or an unknown parameter — is a clean tool error, not a failed
  subprocess), then forwarded to the child as `--flag=value` arguments alongside
  the target. A value still set in the server's environment applies when the
  call omits it. Because a descriptor does not record whether a target is
  read-only, every registry run tool is treated as destructive.
- **Secrets never cross the boundary.** `.secret()` parameters are omitted from
  the descriptor entirely (`./zuke register` writes the secret-free surface), so
  a secret can neither be requested nor forwarded — it is rejected as an unknown
  parameter if a client tries. The spawned build resolves a secret from its own
  environment / `.from()` source instead. In the [audit log](#audit-log) only a
  recognised parameter's value is recorded; any unknown argument keeps its name
  but its value is elided, so a value mistakenly supplied under a secret's name
  is never written to the durable trail.
- **Environment.** A spawned build inherits the server's environment (that is
  how it resolves its secrets and any un-supplied parameters), minus the MCP
  server's own authorization secrets — `ZUKE_OPERATOR_TOKEN` and
  `ZUKE_MCP_TOKEN` are stripped so a registered build can never read them. It
  does still see the rest of the server's environment, so run a registry-backed
  server with **only the environment the registered pipelines should have** —
  treat it like any host that runs those builds.
- **Concurrency.** Unlike the single-build server, the registry server handles
  requests **concurrently** — a read tool (`list_builds`, `describe_build`) is
  never blocked behind a running `run:` call, and independent runs proceed in
  parallel. Concurrent run-tool **spawns** are capped (default 4,
  `--max-concurrent-runs <n>`); a call past the cap gets an immediate structured
  `at_capacity` busy error (`{ running, cap, hint }`) rather than an unbounded
  queue. Read tools are never counted against the cap. Cross-process state
  safety rides the store's CAS, so no new coordination is introduced.

The registry resolves like the run store: `ZUKE_REGISTRY_URL`/`_TOKEN` or
`ZUKE_REGISTRY_DIR`, a build's `registry()` override, else `.zuke/builds`. As
with the run store, `ZUKE_REGISTRY_URL` must be `https:`.

## Safety

**Trust model.** On the default stdio transport the server has no network
endpoint: it speaks only over the stdin/stdout of a process the client launches,
so its trust boundary is the local machine — anyone who can start `./zuke mcp`
already has a shell there and could run `deno run -A zuke.ts <target>` directly.
The [HTTP transport](#http-transport) adds a network endpoint, so it moves that
boundary: it binds loopback by default, requires a bearer token or an
[authenticator](#authentication) off loopback, and is meant to sit behind real
TLS/authentication. Either way, treat the server like any other local developer
tool and don't wire an untrusted client to it.

Running a target executes real build code, so execution is **off by default**: a
freshly-connected agent can only _inspect_ the build. Add `--allow-run`
deliberately, and tier it with the [authorization](#authorization) flags — an
allow-list, an operator token, and confirmation — for anything beyond a trusted
local session. Without `--allow-run`, the `run:` tools are not advertised at
all, and a direct `run:` call is refused with a message pointing at the flag.

Secret values stay protected: a run's output is captured through the same
reporter pipeline as the console, so `parameter().secret()` values are
[redacted](./secrets.md) from what the agent sees — and a secret passed as a
tool argument is masked in the [audit log](#audit-log) too.

## Protocol notes

- **Transport:** newline-delimited JSON-RPC 2.0 on stdio, or one JSON-RPC
  message per `POST` over the [HTTP transport](#http-transport) (`--http`).
- **Lifecycle:** the server answers `initialize` (echoing the client's requested
  `protocolVersion`), `notifications/initialized` (no reply), `ping`,
  `tools/list`, and `tools/call`. Unknown requests get a JSON-RPC
  `-32601 Method not found`; notifications never get a reply.
- **Protocol revisions:** `2025-11-25` (the newest offered), `2025-06-18`,
  `2025-03-26` and `2024-11-05`. A client's requested version is echoed when
  this server implements it, and otherwise answered with the newest — the
  client then proceeds or disconnects. Over HTTP, a `MCP-Protocol-Version`
  header naming a revision this server does not implement is refused `400` —
  after authentication, so the list of supported revisions is not something an
  unauthenticated caller can enumerate. An absent header is fine: the
  specification says to assume `2025-03-26` then, and since nothing here
  behaves differently across these revisions that assumption changes nothing.
  A repeated header (a proxy re-adding one the client already sent) is accepted
  when every value it carries is supported.
- **Why not `2026-07-28`:** it is not a newer version of this protocol so much
  as a different one. It removes `initialize` and `ping` entirely, requires a
  new `server/discover` RPC, carries the protocol version and client
  capabilities in per-request `_meta` instead of a handshake, and makes
  `resultType` on every result and `ttlMs`/`cacheScope` on `tools/list`
  mandatory. Those are base-protocol requirements rather than capability-gated
  features, so a server cannot decline them and still claim the revision — the
  specification's own compatibility matrix calls a server like this one
  "legacy" and says a modern client talking to it simply fails. Supporting it
  means a second request path serving both eras, which is a project rather than
  a version-string edit. Until then, advertising it would be a claim this
  server cannot honour.

  There is a side benefit to refusing the header rather than ignoring it. A
  client that speaks both eras probes with a modern request and falls back to
  `initialize` when it gets a `4xx` it does not recognise, so the `400` is
  what makes that fallback work. Without it, a modern request would have been
  answered under the older semantics — which is the specific confusion the
  specification warns about.
- **Errors:** a bad _tool_ call (unknown tool, unknown target, a failed run) is
  reported through the tool result (`isError: true`) so the model sees it,
  rather than as a transport-level error — matching the MCP convention. Typed
  failures — an authorization denial, a lock conflict, a lost resume race
  (`AlreadyResumedError`) — come back as **structured JSON** in the result
  (`{"error": "…", …}`), so an agent can relay actionable next steps.
- **Concurrency:** messages are processed one at a time (see the
  [HTTP transport](#http-transport)), so a shared server never runs two calls at
  once.

# Serving a Zuke build over MCP

`zuke mcp`, its authorization tiers, authentication, and the build registry.

> Every command and flag below is in `zuke --help` and `zuke <command> --help`;
> they are the source of truth for the version the project runs.

## In brief

- **Operate the build from an agent:** `zuke mcp` serves the build over MCP so
  an AI client can list, inspect, and (with `--allow-run`) run targets — on
  stdio, or over HTTP with `--http <host:port>` (loopback by default; a
  non-loopback bind needs a `ZUKE_MCP_TOKEN` bearer token **or** an
  `mcpAuth()`/`mcpIdentity()` authenticator, else the server exits 1). With a
  state store it also exposes `list_runs`/`show_run` (+ `signal_run`,
  `resume_check` and `cancel_run`). Tier access with `--allow-run=<globs>` (an
  allow-list over **invocation** — invoking a target runs its dependencies, and
  the read tools narrow to the allow-listed targets' closure), `--protect
  <globs>` + `ZUKE_OPERATOR_TOKEN` (enforced over a run's **whole plan**, so a
  protected target reached as a dependency still needs the token), and
  `--confirm-destructive`; mark inspect-only targets `.readOnly()`.
  Mutating/denied calls are audited — read the trail on the host with `zuke runs
  show mcp-audit`; it is deliberately not readable over MCP. A
  **registry-backed** server (`zuke register` then `zuke mcp --registry`)
  instead serves every registered pipeline live, each as a
  `run:<buildId>:<target>` tool that takes the build's declared parameters
  (secrets excluded, validated, forwarded to the spawn) — detail below. Because
  the registry names _where_ a build launches from, a descriptor with a
  **remote** entry module is refused unless its origin is in
  `ZUKE_REGISTRY_LAUNCH_HOSTS`, and a `command` location is refused unless its
  program is in `ZUKE_REGISTRY_LAUNCH_COMMANDS` (the registry writer picks the
  program and its arguments). A UNC path or `file://host/` module counts as
  remote. A **local** module, and the launch cwd of either kind (module or
  command), must also lie inside `ZUKE_REGISTRY_LAUNCH_DIRS` (default: the
  server's own project root; `*` disables), so a server launching builds
  registered from other checkouts must list their roots. For a shared,
  multi-user endpoint, `override mcpAuth()` authenticates a **trusted** caller
  per request — an async `authenticate(ctx)` returning `{ actor, kind?, roles?,
  via? }` or an `McpAuthReject` (`{ status, error, detail?, challenge? }`), so a
  refused HTTP request answers that status with `WWW-Authenticate` instead of a
  `200`. `override mcpIdentity()` is the sugar for the proxy-header case (a sync
  hook reading a header; any throw rejects), adapted onto the same path —
  declare one or the other, never both, or the server exits 1. Either overrides
  the client-reported actor and flows to the audit trail, run records, lock
  holders, and a registry-spawned child's `ZUKE_ACTOR`/`ZUKE_ACTOR_KIND`/
  `ZUKE_ACTOR_ROLES`. Both are fail-closed: a throw, a non-object, or an empty
  actor refuses the request, and nothing runs. `override mcpProtectedResource()`
  publishes the RFC 9728 metadata document and names it in every challenge, so a
  client that has no token can discover the identity provider — Zuke is the
  resource only, and hosts no OAuth endpoints of its own. Detail below.
- **Authorization by role:** `.requiresRole("operator")` gates running a target
  over MCP, enforced across the whole plan it would execute; `override
  mcpAuthorize(identity, call)` decides the rest. Detail below.

## Detail

**MCP authorization**
([`docs/mcp.md`](https://github.com/zuke-build/zuke/blob/master/docs/mcp.md)):
the two gates have deliberately different reach. `--allow-run=<globs>` is an
**entry-point** control — it decides which targets a client may invoke, and
invoking one runs its dependencies, so allow-listing `release` allows everything
`release` does; scope it to entry points, not steps. The read tools narrow to
match (the allow-listed targets plus their closure), so a target outside it is
unreachable rather than merely undisplayed. `--protect <globs>` +
`ZUKE_OPERATOR_TOKEN` is an **operation** control, enforced across a run's whole
plan: a protected target reached as a dependency of an unprotected one still
requires the token, and that run tool advertises `operatorToken` as required in
its schema. Both fail closed — no configured token denies every protected
target, and a plan that cannot be resolved (a run record whose root target was
deleted) is denied rather than assumed harmless. The audit trail is
operator-only: `show_run` refuses it and `list_runs` omits it, so the clients it
audits cannot read who called what. `--confirm-destructive` adds a third tier:
any target not marked `.readOnly()` returns its resolved plan until the call
repeats with `confirm: true` (a `dryRun` is exempt) — so mark inspect-only
targets `.readOnly()`, which also advertises MCP's `readOnlyHint` instead of
`destructiveHint`.

**Build registry**
([`docs/registry.md`](https://github.com/zuke-build/zuke/blob/master/docs/registry.md)):
`zuke register` writes a secret-free descriptor of this build — its
`describeCli()` surface (targets, params) plus a launch location — into a
pluggable `BuildRegistry`. Resolved like the state store:
`ZUKE_REGISTRY_URL`/`_TOKEN` (HTTP) or `ZUKE_REGISTRY_DIR` (files), a
`registry()` build override, else `.zuke/builds`. Separate from the run store;
an HTTP backend shares the `/builds` REST contract beside `/runs`. **`zuke mcp
--registry`** then serves the whole catalog — re-read live, so a build
registered by another process appears as a `run:<buildId>:<target>` tool with no
restart and runs by spawning its launch location (behind `--allow-run` + the
same authz). The run tool exposes the registered build's declared **parameters**
as its input schema and forwards supplied values to the spawned build as
`--flag=value` arguments — validated against their kinds first (a type mismatch
is a clean tool error, never a failed subprocess). `.secret()` parameters are
omitted from the descriptor entirely, so a secret can neither be requested nor
forwarded; the child resolves it from its own environment / `.from()` source.
Because the registry names **where** a build is launched from, a descriptor
whose entry module is **remote** (not a local path or `file:` URL — `https:`,
`jsr:`, `npm:`, `data:`) is refused unless its origin is listed in
`ZUKE_REGISTRY_LAUNCH_HOSTS` (`*` allows any); the call is denied and audited
`launch_origin_not_allowed`, before the confirmation prompt, with nothing
spawned. A `command` location is gated the same way against
`ZUKE_REGISTRY_LAUNCH_COMMANDS` (comma-separated; matched against `command[0]`
exactly, never by basename, since the descriptor picks the program string; `*`
allows any), because the registry writer chooses the program _and its arguments_
— audited `launch_command_not_allowed`. Listing a program does not license it to
fetch: a remote argument still has to pass `ZUKE_REGISTRY_LAUNCH_HOSTS`. Prefer
absolute paths: a relative program resolves against the descriptor's own cwd. A
UNC path (`//host/…`, `\\host\…`) or a `file:` URL with a host other than
`localhost` counts as remote, origin = that host. A local module, and the launch
cwd of a module or a command location, must also lie inside
`ZUKE_REGISTRY_LAUNCH_DIRS` (absolute dirs, comma/newline-separated; default the
server's own project root; `*` disables), compared after resolving symlinks —
audited `launch_dir_not_allowed`. A server launching builds registered from
other checkouts must list their roots.

**Authorization by role**
([`docs/mcp.md`](https://github.com/zuke-build/zuke/blob/master/docs/mcp.md)):
once the server authenticates its callers, `target().requiresRole("operator")`
raises the bar for one target and `override mcpAuthorize(identity, call)`
decides the rest, defaulting to `defaultMcpAuthorize`. Built-ins are ordered
`read` < `run` < `operator`; any other name matches exactly, so an identity
provider's group works with `requiresRole`. `run` is the floor for executing
anything, so `requiresRole` can only raise. A run-scoped mutation needs the
run's initiator or `operator`; a sweep over every run needs `operator`; a valid
`ZUKE_OPERATOR_TOKEN` grants `operator` for that call. A server with **no**
authenticator, or one whose authenticator never mentions `roles`, is not
constrained by the policy at all — `--allow-run`/`--protect` remain its only
gates.

**Authentication**
([`docs/mcp.md`](https://github.com/zuke-build/zuke/blob/master/docs/mcp.md)):
on a shared, multi-user endpoint, `override mcpAuth()` returns an
`McpAuthenticator` — `{ authenticate: async (ctx) => … }` — that either resolves
the caller (`{ actor, kind?, roles?, via? }`; `kind` defaults `"human"`, `roles`
defaults none) or refuses with an `McpAuthReject` (`{ status, error, detail?,
challenge? }`). `ctx` carries the request `headers` and, over HTTP, the
`request` itself. `override mcpIdentity()` is the sugar for the proxy-header
case — a sync hook `(ctx) => ({ actor, via? })` reading a header an
authenticating reverse proxy injects (`ctx.headers.get("x-forwarded-user")`),
where **any throw rejects the request** — adapted onto the same authenticator
internally. Declare **one or the other**: a build declaring both makes `zuke
mcp` exit 1.

Either runs once per request before any dispatch; the resolved actor overrides
`--actor`/env/the client label and flows to the audit trail, run records, lock
holders, and a registry-spawned child's `ZUKE_ACTOR` (with `ZUKE_ACTOR_KIND` and
comma-joined `ZUKE_ACTOR_ROLES` written beside it, so an inherited claim never
outlives a fresh actor). `roles` are **not** an authorization input — the
allow-list/`--protect`/operator token still gate a call. Fail-closed: a throw, a
non-object, an empty actor, or a rejection whose `status` is outside `400`–`499`
all refuse, each collapsing to a bare `401` (`{ status: 401, error:
"Unauthorized", challenge: "Bearer" }`), so an authenticator can never turn its
own refusal into a success. Over HTTP a refusal answers that **status** with its
`WWW-Authenticate` challenge (the JSON-RPC error is still in the body) —
previously a `200` — which is how an MCP client discovers where to authenticate;
either override also satisfies the authentication a non-loopback bind requires,
in place of `ZUKE_MCP_TOKEN`. The minimal seam — TLS/OAuth/header-stripping is
the proxy's job.

**Telling a client where to authenticate**
([`docs/mcp.md`](https://github.com/zuke-build/zuke/blob/master/docs/mcp.md)):
verifying a token only helps a caller that already has one. `override
mcpProtectedResource()` returns
`protectedResource(canonicalUri).authorizationServer(issuer)` (plus optional
`.scopes(...)`, `.name(...)`, `.documentation(...)`), which makes `zuke mcp
--http` an OAuth 2.0 **protected resource**: it publishes the RFC 9728 metadata
document and names it in every `WWW-Authenticate` challenge, so `claude mcp add
--transport http <url>` can discover the identity provider and authenticate in a
browser. Zuke issues no tokens and hosts no `/authorize`, `/token` or
`/register` — those belong to the provider named here, and `mcpAuth()` verifies
what it mints. Dynamic client registration is **not** required (deprecated in
the MCP spec; a pre-registered client id works).

Three strings must agree byte for byte or every token fails validation: the
`resource` you declare, the `resource` parameter the client sends, and the
**audience** the provider puts in the token. Your `mcpAuth()` verifier must
check `aud` — a resource server that skips it accepts tokens minted for other
services. Do not hand-roll JWT verification: a build file may depend on a
maintained JOSE library even though the published packages may not.

`authorizationServer(...)` takes the provider's **issuer identifier**, not its
metadata URL. The well-known path insertion (`/mcp` publishes at
`/.well-known/oauth-protected-resource/mcp`) is handled for you, and only that
one location is served — a root copy would name a path the root route does not
expect, so a conformant client must discard it. `UNAUTHORIZED` and
`INVALID_TOKEN` are separate refusals on purpose: a caller that presented
nothing gets no `error` parameter, one whose token was rejected gets
`error="invalid_token"`.

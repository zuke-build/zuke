# MCP server

`zuke mcp` runs a [Model Context Protocol](https://modelcontextprotocol.io)
server over your build. MCP is the open standard that lets an AI client — Claude
Desktop, Claude Code, an IDE, any agent — discover a server's **tools** (typed,
schema-described functions) and call them. Pointing a client at `zuke mcp` lets
an agent **operate the pipeline through typed calls** — list the targets,
inspect the graph, run one with the right parameters — instead of guessing shell
invocations.

It's a natural extension of what Zuke already does: it publishes `llms.txt`, a
`--list --json` self-description, and shell completions from a single registry.
MCP is the _live_ counterpart — the same build surface, callable.

The server is **dependency-free** (Zuke ships no MCP SDK): it speaks
newline-delimited JSON-RPC 2.0 on stdio, the standard MCP local transport.

## Running it

```sh
zuke mcp              # read-only: inspect the build, never execute
zuke mcp --allow-run  # also expose run:<target> tools that execute targets
```

The process reads JSON-RPC from stdin and writes responses to stdout; its one
startup line goes to stderr so it never corrupts the protocol stream. It runs
until stdin closes. (Read `zuke` as `deno run -A zuke.ts` until the launcher
binary ships.)

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
zuke mcp --http 7777                 # bind 127.0.0.1:7777 (local only)
zuke mcp --http 0.0.0.0:7777         # bind all interfaces — needs a token
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
- Binding a **non-loopback** address requires a bearer token: set
  `ZUKE_MCP_TOKEN`, and every request must send `Authorization: Bearer <token>`
  (a missing or wrong token gets `401`). Without a token, Zuke **refuses to
  bind** a non-loopback address rather than exposing an unauthenticated
  endpoint.
- A token is also enforced on a loopback bind when `ZUKE_MCP_TOKEN` is set.
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

| Tool        | Returns                                                                             |
| ----------- | ----------------------------------------------------------------------------------- |
| `list_runs` | Persisted run summaries (optional `status`/`target`/`since` filters), newest first. |
| `show_run`  | One run's full record — status, per-target progress, signals, and the audit trail.  |

With `--allow-run`, the server also exposes one **`run:<target>`** tool per
target (subject to the [allow-list](#authorization)). Its input schema is built
from the build's declared parameters — a `required` parameter is required,
`.options(...)` becomes an `enum`, a `.number()` is typed as a number — plus a
`dryRun` flag that plans without executing. A run tool carries MCP's
`destructiveHint` by default, or `readOnlyHint` when the target declares
[`.readOnly()`](./authoring.md); a client can prompt accordingly. A run resolves
parameters exactly like the CLI (MCP argument → the environment → the declared
default) and returns the target's captured output with a pass/fail marker.

With `--allow-run` a store also exposes three **mutating** run-state tools:
`signal_run` (deliver an external signal and resume a suspended run,
exactly-once), `resume_check` (re-check suspended runs — predicate waits and
timeouts), and `cancel_run` (cancel a run and run its
[compensations](./orchestration.md#cancellation--compensation-oncancel)). They
are the MCP counterparts of `zuke resume` and `zuke cancel`. Each runs the
target's code (a resume continues it; a cancel runs its compensations), so it is
gated by the same [allow-list and operator-token](#authorization) policy as a
`run:` tool and appended to the [audit log](#audit-log).

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
  which protected targets exist.
- **Operator token — `--protect <globs>` + `ZUKE_OPERATOR_TOKEN`.** A matching
  target's run tool gains a required `operatorToken` argument, checked (in
  constant time) against `ZUKE_OPERATOR_TOKEN`. This is **fail-closed**: if no
  token is configured, every protected target is denied, so a misconfigured
  server can never silently expose one. A denial is a structured
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
ZUKE_OPERATOR_TOKEN=… zuke mcp --http 7777 \
  --allow-run --protect promoteToProd --confirm-destructive
```

## Audit log

With a store configured, **every mutating or denied tool call** (`run:<target>`,
`signal_run`, `resume_check`, `cancel_run`) is appended to an audit trail: the
time, the tool, the resolved **actor**, the outcome (`ok` / `denied` / `error`),
and the call's arguments. Arguments are **redacted** — the operator token is
dropped and every `.secret()` parameter's value is masked — before anything is
persisted.

The trail lives in a store-level record; read it with `zuke runs show mcp-audit`
(or the `show_run` tool). The actor resolves by precedence: the **identity
hook** (below) → `--actor` → `ZUKE_ACTOR` → the CI actor → the connecting
client's `initialize` name → `"anonymous"`. The client name is an **untrusted
label** for the trail only — it never influences authorization. On a shared HTTP
endpoint it reflects the most recent client to connect, so use the identity hook
(or `--actor`) for authoritative attribution there.

### Trusted per-call identity

On a shared, multi-user endpoint "who did this" must not be self-reported. Front
the server with an authenticating reverse proxy (e.g. OAuth 2.1) that injects
the real caller in a header it strips from client input, and resolve it with a
per-request **identity hook** — `override mcpIdentity()` on the build:

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

The hook runs **once per request, before any dispatch**. Its `actor` overrides
`--actor`, the environment, and the client label for that call, and flows to the
audit trail, run records, lock-holder identity, and — for a registry-spawned
build — the child's `ZUKE_ACTOR`. It is **fail-closed**: a hook that throws _or_
yields no usable actor (an empty string, e.g. from `headers.get(…) ?? ""` when
the header is missing) **rejects the request** with an auth error — nothing
executes, nothing is written, and it never falls back to the static actor, so
the hook's precedence stays absolute. Without a hook, stdio/local behavior is
unchanged. This is deliberately the _minimal_ seam — TLS, the OAuth flow, and
header stripping are the proxy's job, not Zuke's.

## Registry mode (dynamic discovery)

By default `zuke mcp` serves the single build its process was launched with.
With `--registry` it instead serves the [build registry](./registry.md) — the
catalog `zuke register` writes to — and **re-reads it on every `tools/list` and
`tools/call`**. So a pipeline registered by another process appears as a tool in
an already-running server with **no restart**:

```sh
# Serve every registered pipeline, execution enabled:
zuke mcp --registry --allow-run
```

- **Discovery.** `list_builds` returns the catalog; `describe_build` (with a
  `build` id) returns one build's surface. Each registered target is exposed as
  a `run:<buildId>:<target>` tool, re-read live.
- **Execution is a spawn.** A registered build has no live instance in the
  server, so a run tool **spawns the build's registered launch location** (the
  `deno run <module> <target>` `zuke register` recorded, or an explicit command)
  and returns its captured output. This is code execution, so it is off unless
  `--allow-run`, and it honours the same [authorization](#authorization) tiers —
  the allow-list and `--protect` globs match the **qualified**
  `<buildId>:<target>` name (e.g. `--allow-run=Api:*`, `--protect=Api:deploy`).
  Every mutating or denied call is [audited](#audit-log).
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
  the descriptor entirely (`zuke register` writes the secret-free surface), so a
  secret can neither be requested nor forwarded — it is rejected as an unknown
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
`ZUKE_REGISTRY_DIR`, a build's `registry()` override, else `.zuke/builds`.

## Safety

**Trust model.** On the default stdio transport the server has no network
endpoint: it speaks only over the stdin/stdout of a process the client launches,
so its trust boundary is the local machine — anyone who can start `zuke mcp`
already has a shell there and could run `deno run -A zuke.ts <target>` directly.
The [HTTP transport](#http-transport) adds a network endpoint, so it moves that
boundary: it binds loopback by default, requires a bearer token off loopback,
and is meant to sit behind real TLS/authentication. Either way, treat the server
like any other local developer tool and don't wire an untrusted client to it.

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
- **Errors:** a bad _tool_ call (unknown tool, unknown target, a failed run) is
  reported through the tool result (`isError: true`) so the model sees it,
  rather than as a transport-level error — matching the MCP convention. Typed
  failures — an authorization denial, a lock conflict, a lost resume race
  (`AlreadyResumedError`) — come back as **structured JSON** in the result
  (`{"error": "…", …}`), so an agent can relay actionable next steps.
- **Concurrency:** messages are processed one at a time (see the
  [HTTP transport](#http-transport)), so a shared server never runs two calls at
  once.

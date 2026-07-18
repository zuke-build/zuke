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
`405`, and clients fall back to POST-only (which is spec-compliant). Messages
are processed **one at a time**, mirroring stdio, so two concurrent runs of the
one build can't race.

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

With `--allow-run` a store also exposes two **mutating** run-state tools:
`signal_run` (deliver an external signal and resume a suspended run,
exactly-once) and `resume_check` (re-check suspended runs — predicate waits and
timeouts). They are the MCP counterparts of `zuke resume`.

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
`signal_run`, `resume_check`) is appended to an audit trail: the time, the tool,
the resolved **actor**, the outcome (`ok` / `denied` / `error`), and the call's
arguments. Arguments are **redacted** — the operator token is dropped and every
`.secret()` parameter's value is masked — before anything is persisted.

The trail lives in a store-level record; read it with `zuke runs show mcp-audit`
(or the `show_run` tool). The actor resolves by precedence: `--actor` →
`ZUKE_ACTOR` → the CI actor → the connecting client's `initialize` name →
`"anonymous"`. The client name is an **untrusted label** for the trail only — it
never influences authorization. On a shared HTTP endpoint it reflects the most
recent client to connect, so set `--actor` for authoritative attribution there.

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

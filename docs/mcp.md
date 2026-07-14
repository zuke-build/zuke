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
MCP is the *live* counterpart — the same build surface, callable.

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

## Tools

Read tools are always available:

| Tool | Returns |
| --- | --- |
| `list_targets` | Every target with its description and dependencies. |
| `describe_build` | The full build surface — commands, flags, targets, parameters (the `--list --json` payload). |
| `graph` | Each target and the targets it depends on. |

With `--allow-run`, the server also exposes one **`run:<target>`** tool per
target. Its input schema is built from the build's declared parameters — a
`required` parameter is required, `.options(...)` becomes an `enum`, a `.number()`
is typed as a number — plus a `dryRun` flag that plans without executing. These
tools carry MCP's `destructiveHint` annotation so a client can prompt before
running. A run resolves parameters exactly like the CLI (MCP argument → the
environment → the declared default) and returns the target's captured output
with a pass/fail marker.

```jsonc
// tools/call
{ "name": "run:test", "arguments": { "environment": "dev", "coverage": true } }
```

## Safety

Running a target executes real build code, so execution is **off by default**: a
freshly-connected agent can only *inspect* the build. Add `--allow-run`
deliberately — for an environment where you want the agent to drive the
pipeline. Without it, the `run:` tools are not advertised at all, and a direct
`run:` call is refused with a message pointing at the flag.

Secret values stay protected: a run's output is captured through the same
reporter pipeline as the console, so `parameter().secret()` values are
[redacted](./secrets.md) from what the agent sees.

## Protocol notes

- **Transport:** newline-delimited JSON-RPC 2.0 on stdio.
- **Lifecycle:** the server answers `initialize` (echoing the client's requested
  `protocolVersion`), `notifications/initialized` (no reply), `ping`,
  `tools/list`, and `tools/call`. Unknown requests get a JSON-RPC
  `-32601 Method not found`; notifications never get a reply.
- **Errors:** a bad *tool* call (unknown tool, unknown target, a failed run) is
  reported through the tool result (`isError: true`) so the model sees it, rather
  than as a transport-level error — matching the MCP convention.

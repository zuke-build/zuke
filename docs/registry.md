# The build registry

The **build registry** is a catalog of the pipelines (builds) that exist and
where they live. Where [durable run state](./state.md) records *runs*, the
registry records *builds*: each build registers a small **descriptor** — its id,
its CLI surface (targets, parameters, commands), and how to launch it — into a
pluggable store.

Its purpose is agentic discovery driven by the store: an MCP server pointed at
the registry can expose newly-registered pipelines as tools **without a redeploy
or new instructions**. A build that registers itself for the first time becomes
discoverable through an already-running server. (That dynamic `zuke mcp`
integration is the next milestone; this page covers the registry and
`zuke register` that back it.)

The registry is a **separate concern** from the run [`StateStore`](./state.md) —
a run history and a build catalog are different things — but it is configured the
same way and, over HTTP, rides the same [REST contract](./state-api.md#build-catalog-builds)
with a `/builds` collection beside `/runs`, so one service can host both.

## Quick start

```sh
# Record this build in the registry (writes .zuke/builds/<id>.json by default).
deno run -A zuke.ts register

# Print the descriptor that was written.
deno run -A zuke.ts register --json
```

Registration is **idempotent**: re-running `register` refreshes the descriptor
(and its `updatedAt`) while preserving the original `createdAt`. Concurrent
registrations converge on one record via compare-and-swap.

## The build descriptor

A descriptor is a versioned JSON snapshot of one build. It carries only static,
structural metadata — never parameter *values* — so, like a run record, it
excludes secrets by construction.

| Field       | What it is                                                        |
| ----------- | ---------------------------------------------------------------- |
| `id`        | Stable build id (the build class name, unless overridden).       |
| `name`      | Human-facing build name (the class name).                        |
| `location`  | How to launch the build (see below).                             |
| `surface`   | The CLI surface — the exact output of `describeCli(build)`: commands, flags, targets (with deps), and parameters (flags only, no values). |
| `actor`     | Who registered it (resolved from `--actor` / `ZUKE_ACTOR` / CI). |
| `createdAt` | ISO-8601 first-registration time (preserved across updates).     |
| `updatedAt` | ISO-8601 time of the latest registration.                        |

The **location** is one of two forms:

- `{ kind: "module", module, cwd, repo? }` — the entry module `deno run`
  executes (a `file:`/`https:` URL or path), the working directory, and — in CI
  — the `owner/name` repo slug. This is what `zuke register` writes, derived from
  the running module, `Deno.cwd()`, and `GITHUB_REPOSITORY`.
- `{ kind: "command", command, cwd, repo? }` — an explicit tokenised launch argv
  (for a build fronted by a wrapper script). Hand-authored or produced by a
  custom registry; the runner honours it in the same way.

## Backends

Two dependency-free backends ship, mirroring the state layer.

### `FileSystemBuildRegistry` — dev default

Writes one `<id>.json` file per build under a directory (default
`<repo root>/.zuke/builds`, a sibling of `.zuke/runs` — never colliding).
Compare-and-swap uses an `O_EXCL` lock marker plus an atomic temp-file rename, so
two processes registering at once cannot tear a write. Single-host by design.

### `HttpBuildRegistry` — hosted service

Talks to a hosted service over the [`/builds` REST contract](./state-api.md#build-catalog-builds):
`GET/PUT/DELETE /builds/:id` and `GET /builds`, with `ETag`/`If-Match`
compare-and-swap and bearer auth. Its options mirror the state client —
`{ url, token?, fetch? }` — and it is the production path. Point it only at a
service you control.

## Configuration

The registry is resolved by the same precedence as the run store:

1. an explicit registry passed in code (or `false` to disable);
2. a build's `registry()` override;
3. the environment — `ZUKE_REGISTRY_URL` (with an optional
   `ZUKE_REGISTRY_TOKEN`) selects the HTTP backend, else `ZUKE_REGISTRY_DIR`
   selects the filesystem backend;
4. for `zuke register`, a filesystem registry under `.zuke/builds` as the
   default, so the command works out of the box.

```ts
class CD extends Build {
  registryUrl = parameter("registry URL").required();
  registryToken = parameter("registry token").secret();
  override registry() {
    return new HttpBuildRegistry({
      url: this.registryUrl.value,
      token: this.registryToken.value,
    });
  }
}
```

## Secrets

A descriptor is secret-free by construction: it is built from
`describeCli(build)`, which emits only parameter **flags** and their static
metadata (required, kind, …) — never resolved values — plus a launch location
and an actor name. `zuke register` resolves no parameter values at all. Two extra
guards keep declared-but-sensitive strings out: a **secret** parameter's declared
`.options(...)` values are omitted (they could be real keys), and credentials
embedded in a remote module URL (`https://user:token@host/build.ts`) are stripped
from the stored `location.module`. Treat the store as sensitive configuration
nonetheless (it names your pipelines and where they run), and front an HTTP
backend with TLS and authn as you would any internal API.

## Extensibility

The whole thing sits behind the `BuildRegistry` interface
(`getBuild` / `register` / `deregister` / `listBuilds`). A consumer can implement
it against their own catalog service or database and plug it in via
`Build.registry()` — the richer catalog stays a plugin, exactly as the pluggable
`StateStore` and `RemoteCacheStore` do. Core ships the interface, the two
reference backends, and (next) the `zuke mcp` integration point.

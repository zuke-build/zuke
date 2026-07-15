# Service targets

Some things a build depends on aren't a step that finishes — they're a process
that has to be **running while other targets execute**: a dev server for
end-to-end tests, a database container, a mock API. `service()` models exactly
that. It's declared and depended on like a [target](./authoring.md), but the
executor **starts** it, waits until it's **ready**, keeps it alive while its
dependents run, and **stops** it when the build finishes — in reverse order, in
a `finally`, so a failed test never leaks a process.

It replaces the fragile shell dance every team writes by hand: start the server
in the background, `sleep 5` and hope it's up, run the tests, and remember to
kill it (which never happens when the tests fail).

```ts
import { Build, run, service, target, tcpReachable } from "jsr:@zuke/core";
import { $ } from "jsr:@zuke/core/shell";
import { DenoTasks } from "jsr:@zuke/deno";

class E2E extends Build {
  api = service()
    .description("API under test")
    .start(() => $`deno run -A server.ts`.spawn()) // spawn; don't await
    .readyWhen(() => tcpReachable("localhost:8080")); // polled until ready

  test = target()
    .dependsOn(this.api) // api is started + ready before this runs
    .executes(() => DenoTasks.test((s) => s.allowAll()));
}

await run(E2E);
```

Running `zuke test` starts `api`, waits for port 8080 to accept connections,
runs the tests against it, then stops `api` — whether the tests pass or fail.

## Declaring a service

`service()` returns a `ServiceBuilder`. It shares the ordering methods with
`target()` (`dependsOn`, `before`, `after`, `description`) but, instead of
`.executes(...)`, it takes a lifecycle:

| Method | Purpose |
| --- | --- |
| `.start(() => handle)` | Start the process; return a handle to stop later. **Required.** |
| `.readyWhen(() => boolean)` | Readiness probe, polled until it returns `true`. Optional. |
| `.readyTimeout(ms)` | How long to wait for readiness before failing (default 30s). |
| `.stop((handle) => …)` | Custom teardown. Optional — see below. |

### Starting: `.start()` and `spawn()`

`.start()` returns a **handle** the executor stops on teardown. The shell's
`Command` gains a `.spawn()` for exactly this — it starts a process *without*
waiting for it to exit and returns a `SpawnedProcess`, whose `.stop()` sends
`SIGTERM` (then reaps it). A `SpawnedProcess` is a valid handle, so the common
case needs no explicit stop:

```ts
.start(() => $`docker compose up`.spawn())
```

A handle is anything with a `stop()` method, so you can start a service any way
you like — an in-process HTTP server, a library's `listen()` — and return
something that shuts it down:

```ts
.start(() => {
  const server = Deno.serve({ port: 8080 }, handler);
  return { stop: () => server.shutdown() };
})
```

When the thing you start isn't self-stopping, provide `.stop()` explicitly; it
receives whatever `.start()` returned:

```ts
.start(() => openPool())
.stop((pool) => pool.drain())
```

### Readiness: `.readyWhen()` and `tcpReachable`

A just-started process usually isn't ready to serve immediately. `.readyWhen()`
takes a predicate that the executor polls (every 200ms) until it returns `true`
or `.readyTimeout()` elapses — in which case the service (and the build) fails
with a clear error, and the just-started process is stopped so it isn't leaked.

`tcpReachable("host:port")` is the built-in for the most common check — "is the
port accepting connections yet?":

```ts
.readyWhen(() => tcpReachable("localhost:5432"))
```

Any predicate works — probe an HTTP health endpoint, look for a file, query a
readiness API:

```ts
.readyWhen(async () => {
  try {
    const res = await fetch("http://localhost:8080/health");
    return res.ok;
  } catch {
    return false; // not up yet
  }
})
```

Without a `.readyWhen()`, a service is considered ready the moment it starts.

## Lifecycle and teardown

- A service starts when the run reaches it — which, because the plan only
  includes reachable nodes, means **when a dependent needs it**. It then stays
  up for the rest of the build.
- Every started service is **stopped in reverse start order** when the build
  finishes, in a `finally`. A dependent that throws, a later service that fails
  to start, an aborted build — none of them leak a process.
- Stopping is best-effort: if one service's teardown throws, it's reported and
  the rest are still stopped.

## Notes and limits

- **Whole-build scope.** A service stays up until the build ends, not just until
  its last dependent finishes. That's the simple, predictable model; fine-grained
  (stop-when-no-longer-needed) teardown may come later.
- **Output.** `spawn()` inherits the process's stdout/stderr so you see the
  server's logs. Under [`zuke mcp`](./mcp.md), stdout is the protocol stream, so
  avoid running a service-starting target through the MCP server.
- **Running a service alone.** `zuke api` starts the service and — with nothing
  depending on it to keep the build going — immediately tears it back down.
  Services are meant to be depended on, not run on their own.

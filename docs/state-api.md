# State HTTP API

This is the contract a service must implement to back
[`HttpStateStore`](./state.md#httpstatestore--hosted-service-for-production) —
the production store for [durable run state](./state.md). Zuke ships the client;
you host the service (a thin layer over Postgres, a key-value store, a
k8s-annotation store, an object store, …). It is deliberately small: three
endpoints, bearer auth, and HTTP preconditions for compare-and-swap.

The client is dependency-free and talks plain HTTP, so any stack can serve it.

## Conventions

- **Base URL.** Configured on the client; every path below is relative to it.
- **Auth.** If a token is configured, every request carries
  `Authorization: Bearer <token>`. The service should reject unauthenticated
  requests with `401`.
- **Body.** A run record is JSON, exactly the shape in
  [Durable run state](./state.md#the-run-record). The service should store it
  verbatim and return it verbatim.
- **Version = `ETag`.** Every stored run has an opaque version. The service
  returns it as an `ETag` response header and honours it in `If-Match` /
  `If-None-Match` request headers. Any stable per-write token works (a row
  version, a content hash, a monotonic counter).

## Endpoints

### `GET /runs/:id`

Fetch one run.

| Response | Meaning                                                         |
| -------- | -------------------------------------------------------------- |
| `200`    | Body is the run record; **`ETag` header is required**.         |
| `404`    | No such run (the client treats this as "not found", not error). |
| other    | The client raises an error.                                    |

The client **requires** the `ETag` header on a `200`; omitting it is an error.

### `PUT /runs/:id`

Create or update a run, guarded by a precondition:

- **Create** — the client sends `If-None-Match: *`. The service must store the
  record only if no run with that id exists yet, else respond `412`.
- **Update** — the client sends `If-Match: <etag>`. The service must store the
  record only if the current version equals `<etag>`, else respond `412`.

| Response      | Meaning                                                       |
| ------------- | ------------------------------------------------------------- |
| `200`/`201`   | Stored; **`ETag` header (the new version) is required**.      |
| `412`         | Precondition failed → the client reports a compare-and-swap conflict and retries. |
| other         | The client raises an error.                                   |

The service is the authority for versioning, which side-steps client clock
skew. Records are small (kilobytes); whole-document CAS is the intended model.

### `GET /runs?status=&target=&since=`

List runs as an array of **summaries** (a subset of the record):

```jsonc
[
  {
    "id": "3f2a…",
    "build": "CD",
    "rootTarget": "deploy",
    "status": "succeeded",
    "actor": "alice",
    "createdAt": "2026-07-17T…Z",
    "updatedAt": "2026-07-17T…Z"
  }
]
```

Query parameters (all optional, combined with AND):

| Param    | Keeps runs where…                                        |
| -------- | -------------------------------------------------------- |
| `status` | the run status equals this value                         |
| `target` | the run's graph contains a target with this dotted name  |
| `since`  | `createdAt` is at or after this ISO-8601 timestamp       |

The client validates every summary it receives (an untrusted service is checked,
not trusted) and expects newest-first ordering is applied server-side where it
matters; it does not re-sort the list.

## Build catalog (`/builds`)

The [build registry](./registry.md) rides the **same** contract — same base URL,
same bearer auth, same `ETag`/`If-Match` compare-and-swap — with a `/builds`
collection beside `/runs`, so one service can host both (they stay separate
concerns in the client:
[`HttpBuildRegistry`](./registry.md#httpbuildregistry--hosted-service) is not the
run store). A build **descriptor** is JSON, exactly the shape in
[the registry docs](./registry.md#the-build-descriptor); the service stores and
returns it verbatim. Descriptors never contain secrets.

### `GET /builds/:id`

Fetch one registered build.

| Response | Meaning                                                          |
| -------- | --------------------------------------------------------------- |
| `200`    | Body is the descriptor; **`ETag` header is required**.          |
| `404`    | No such build (the client treats this as "not registered").     |
| other    | The client raises an error.                                     |

### `PUT /builds/:id`

Register (create or update) a build, guarded exactly like `PUT /runs/:id`:
`If-None-Match: *` to create, `If-Match: <etag>` to update, `412` on a version
mismatch (the client re-reads and retries, so concurrent registrations converge).
A `200`/`201` must return the new version as an `ETag`.

### `DELETE /builds/:id`

Deregister a build. `404` (already gone) is **not** an error; any other non-`2xx`
is. No body.

### `GET /builds?name=&since=`

List registered builds as an array of **summaries**
(`id`, `name`, `actor`, `createdAt`, `updatedAt`). Query parameters (optional,
AND-combined): `name` (exact match) and `since` (`createdAt` at or after an
ISO-8601 timestamp). The client validates every summary and does not re-sort.

## Notes for implementers

- **Never weaker than optimistic 409-retry.** The precondition model above is
  the minimum; a store that already does optimistic concurrency (e.g. a
  k8s-annotation store with resource versions) maps onto it directly.
- **Secrets.** Records never contain secret parameters (Zuke excludes them
  before sending), but treat the store as sensitive: it holds non-secret
  parameters, target metadata, and actor identity.
- **Transport security.** Terminate TLS and enforce authn/authz in front of the
  service as you would any internal API; the client provides the bridge, not a
  gateway.

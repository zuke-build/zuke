# Caching

Zuke has **two independent caches**, and they solve different problems. Reach
for whichever matches what you're trying to avoid re-doing:

| Cache                       | What it skips                                      | Where it lives                 | Opt in with                                    |
| --------------------------- | -------------------------------------------------- | ------------------------------ | ---------------------------------------------- |
| **Incremental build cache** | Re-running a target whose inputs are unchanged     | `<repo root>/.zuke/cache.json` | `.inputs()` (and/or `.cacheKey()`) on a target |
| **AI response cache**       | Re-paying a model for an identical review/fix call | `<repo root>/.zuke/ai-cache/`  | `.cache(aiCache(...))` on a reviewer or fixer  |

Both are file-backed, git-ignored, dependency-free, and **best-effort**: a
missing or corrupt store is treated as empty (everything just rebuilds), so a
broken cache never breaks a build.

The incremental build cache is per-machine, but it can be **shared across
machines** — a fresh CI checkout or a teammate's clone restores a target's
outputs instead of rebuilding them — by adding a remote store. See
[Remote build cache](#remote-build-cache) below.

## Incremental build cache

A target that declares **inputs** becomes _incremental_. Before running it, Zuke
fingerprints the declared inputs; if the fingerprint matches the last successful
run **and** every declared output still exists, the target is **skipped** and
reported `cached`. Otherwise it runs and its fingerprint is refreshed.

```ts
compile = target()
  .inputs("src", "deno.json") // re-run only when these change…
  .outputs("dist") // …or when dist is missing
  .executes(async () => {
    await DenoTasks.run((s) => s.script("build.ts"));
  });
```

### What "unchanged" means

The fingerprint is a **SHA-256** computed with the built-in Web Crypto API — no
dependency:

- A **file** hashes to the SHA-256 of its contents.
- A **directory** hashes to the SHA-256 of its sorted `name:hash` entries,
  **recursively** — so a change anywhere in the tree changes the result, but
  reordering the filesystem does not (entries are sorted first).
- A **missing** path hashes to a sentinel, so a file's **appearance or removal**
  invalidates the cache just as an edit does. Renaming, adding, or deleting an
  input file all force a rebuild.

Inputs are combined in **declaration order**, so the same files always produce
the same fingerprint (deterministic across machines and runs).

### Outputs guard the cache

`.outputs(...)` lists the files or directories the target produces. A cache hit
**also** requires every declared output to still exist — so deleting `dist/` (or
any declared output) forces a rebuild even when the inputs are untouched.
Outputs are optional; a target with inputs but no outputs is cached purely on
its input fingerprint.

### Non-file inputs — `.cacheKey()`

Not every input is a file. `.cacheKey(fn)` folds an extra value — a parameter, a
tool version, a git commit — into the fingerprint, so the target also rebuilds
when that value changes. The function may be async and is repeatable.

```ts
compile = target()
  .inputs("src")
  .cacheKey(() => this.configuration.value) // rebuild when the config flips
  .cacheKey(() => Deno.version.deno) // …or the toolchain moves
  .executes(/* … */);
```

A `.cacheKey()` **on its own makes a target cacheable** — you don't need
`.inputs()` for it to take effect. A target that declares neither inputs nor
cache keys is never cached and always runs.

### The store

Fingerprints persist in `<repo root>/.zuke/cache.json` (git-ignored). A few
details worth knowing:

- The file is created **only when the build has at least one cacheable target**.
  A build with no `.inputs()`/`.cacheKey()` anywhere never opens or writes it.
- A **corrupt or hand-edited** `cache.json` is tolerated: if it can't be parsed,
  Zuke treats it as empty and everything rebuilds — it never errors on a bad
  store.
- The store is only rewritten when a fingerprint actually changed, so an
  all-cached run touches no files.

### Interaction with the rest of the build

- A **cached (or condition-skipped) target counts as satisfied**, so its
  dependents still run. Caching a target doesn't strand what depends on it.
- The fingerprint is recorded **only after a successful run** — a failed target
  is never marked up-to-date.
- **`--no-cache`** (or `execute(..., { cache: false })`) ignores the cache
  entirely and re-runs every target.
- **`--dry-run`** never reads or writes the cache: it prints the plan without
  running any body, so it can't invalidate or refresh a fingerprint.

See the CLI's [Incremental builds](./cli.md#incremental-builds) section and the
[`.inputs()`/`.outputs()`](./authoring.md#incremental-caching-inputs--outputs)
authoring reference for the same feature from those angles.

## Remote build cache

The incremental cache above is **local** — one machine's `.zuke/cache.json`. A
**remote cache** lifts it across machines: a target's built **outputs** are
shared through a store, so a fresh CI checkout, a parallel CI job, or a
teammate's clone **restores** them instead of rebuilding. It's the same
fingerprint the local cache uses, extended with an artifact store — think of it
as the distributed layer of the incremental cache, not a separate cache.

It applies to targets that declare **both `.inputs()` and `.outputs()`** — the
inputs give the key, the outputs are what's stored. Each run resolves in one of
three ways:

- **Local hit** — inputs unchanged and outputs present → skipped as usual, with
  no remote call at all.
- **Local miss, remote hit** — the store has an archive for this fingerprint →
  Zuke downloads and extracts it, records the fingerprint locally, and reports
  the target `cached`. The body never runs.
- **Local miss, remote miss** — the target runs; on success its outputs are
  archived and **uploaded** for the next machine.

Like every Zuke cache it is **best-effort**: if the store can't be reached, Zuke
logs a warning and falls back to a normal local build — a cache outage never
fails a build.

### Backends

Two dependency-free stores ship, behind one `RemoteCacheStore` interface
(`get(key)` / `put(key, artifact)`):

| Store                  | Backed by                                         | Use case                                                                                  |
| ---------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `FileSystemCacheStore` | a directory (`<dir>/<key>.tar.gz`)                | a shared/mounted volume, an NFS path, a self-hosted runner cache                          |
| `HttpCacheStore`       | `GET`/`PUT <url>/<key>` (+ optional bearer token) | any object store or cache server behind a URL — an S3/GCS/R2 bucket, or your own endpoint |

An artifact is a **gzipped `tar`** of the target's outputs, built with Zuke's
dependency-free `tar`/`gzip` helpers. Entry names use the POSIX `ustar` format's
100-byte path limit, so an extremely deep output path is rejected with a clear
error rather than silently truncated. You can implement `RemoteCacheStore`
yourself for any other backend.

### Configuring it

Choose a store in one of three ways; they resolve by **precedence**, first match
wins:

1. an explicit `execute(build, target, { remoteCache: store })` option (or
   `false` to disable it for that run);
2. a typed **`remoteCache()` override** on the build;
3. the **`ZUKE_REMOTE_CACHE_*` environment variables**.

Declare it in code — the everything-typed path:

```ts
import { Build, HttpCacheStore, parameter, target } from "jsr:@zuke/core";

class CI extends Build {
  cacheToken = parameter("Cache token").secret().env("CACHE_TOKEN");

  override remoteCache() {
    return new HttpCacheStore({
      url: "https://cache.example.com",
      token: this.cacheToken.value,
    });
  }

  build = target().inputs("src").outputs("dist").executes(/* … */);
}
```

…or from the environment, with no build-file change — the CI-friendly path:

| Variable                                                       | Selects                  |
| -------------------------------------------------------------- | ------------------------ |
| `ZUKE_REMOTE_CACHE_URL` (+ optional `ZUKE_REMOTE_CACHE_TOKEN`) | an `HttpCacheStore`      |
| `ZUKE_REMOTE_CACHE_DIR`                                        | a `FileSystemCacheStore` |

```sh
ZUKE_REMOTE_CACHE_URL=https://cache.example.com ZUKE_REMOTE_CACHE_TOKEN=… ./zuke ci
ZUKE_REMOTE_CACHE_DIR=/mnt/zuke-cache ./zuke ci
```

A URL wins over a directory when both are set. **`--no-remote-cache`** uses the
local cache only for a run (it skips both restore and upload); **`--no-cache`**
still disables _both_ caches.

### How a key is derived

The store key is the target's **name plus its input fingerprint** — the very
fingerprint the [incremental cache](#what-unchanged-means) computes (inputs plus
any `.cacheKey()`), with the name sanitised so it is safe as a filename and a
URL path segment. So the same target on the same inputs always resolves to the
same artifact, and a changed input is a natural miss that rebuilds and
re-uploads.

### Security

The store `url` and `token` are **trusted configuration** — outputs are uploaded
to that host and archives are extracted from it — so treat them like a deploy
target:

- Point them only at a cache **you control**, and prefer a
  [secret parameter](./parameters.md) or an environment variable over a
  hard-coded value.
- On CI, **restrict egress** to the cache host, so a misconfigured or overridden
  URL can't exfiltrate build artifacts.
- **Restore is confined to the workspace.** Every archive entry is validated
  before anything is written — an **absolute path**, or one containing a
  **`..`** segment, is rejected outright — so a poisoned or malicious store
  can't plant files outside the current directory.

### Where it fits

The remote cache is the connective tissue of Zuke's CI story:

- With **[`--affected`](./cli.md#affected-targets)**, a change reruns only the
  targets it reaches; the remote cache restores everything else.
- With
  **[CI job fan-out](./authoring.md#fanned-out-jobs--one-ci-job-per-target)**,
  each target runs in its own job and shares outputs through the store —
  configure `ZUKE_REMOTE_CACHE_*` on the jobs so an upstream job's outputs are
  restored rather than rebuilt in every downstream job.

See the CLI's [Remote cache](./cli.md#remote-cache) section for the same feature
from the command angle.

## AI response cache

An [AI review](./ai-review.md) or [fix](./self-healing.md) call is expensive: it
spends tokens and round-trips to a provider. Yet the **same** call often runs
again and again — a flaky CI retry, a re-pushed branch, a local loop over an
unchanged diff. `aiCache(...)` persists each provider response so an
**identical** call reuses the stored answer instead of paying for the model
again.

```ts
import { aiCache, securityReviewer } from "jsr:@zuke/ai";

review = target()
  .validateBefore(
    securityReviewer((r) =>
      r.provider("openai").apiKey(this.key)
        .cache(aiCache((c) => c.dir(".zuke/ai-cache").ttl(86_400)))
    ),
  )
  .executes(/* … */);
```

The same cache attaches to a [fixer](./self-healing.md) with `.cache(...)`:

```ts
test = target()
  .executes(() => DenoTasks.test((s) => s.allowAll()))
  .recoverWith(
    aiFixer((f) =>
      f.provider("openai").apiKey(this.key)
        .cache(aiCache((c) => c.ttl(3_600)))
    ),
  );
```

### How a call is keyed

An entry is keyed by a **stable hash of the call's salient parts** — the
provider, the model, and the exact prompt (which, for a review, incorporates the
diff). Change any of them and it's a different key, so a new diff or a swapped
model is a natural miss. A cache **hit costs nothing** and does **not** draw
down a [budget](./ai-review.md#scoping-the-diff-and-cost).

### Configuring `aiCache`

`aiCache((c) => …)` builds the cache inline. Every knob is optional:

| Method           | Effect                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `.dir(path)`     | Directory for the default file store (default `.zuke/ai-cache`).                            |
| `.ttl(seconds)`  | Entries older than this are ignored. **Default `604800` (7 days)**; `0` means never expire. |
| `.disable()`     | Turn the cache off programmatically — every read misses, every write is a no-op.            |
| `.store(custom)` | Inject a custom [`CacheStore`](#custom-stores) instead of the file store.                   |

The cache is **opt-in per reviewer/fixer** — it does nothing until you attach it
with `.cache(...)`. It is deliberately **best-effort**: a missing file, a
corrupt or truncated entry, or a failed write is swallowed and treated as a
miss, so a broken cache never breaks the build it caches for.

### Custom stores

The default backing store writes one JSON file per key under `.dir()`. Any
object implementing `CacheStore` — `get(key)` / `set(key, entry)` — can replace
it via `.store(...)`, which is how tests inject an in-memory store for a single
run:

```ts
import { type CacheEntry, type CacheStore } from "jsr:@zuke/ai";

const memory = new Map<string, CacheEntry>();
const inMemory: CacheStore = {
  get: (k) => Promise.resolve(memory.get(k)),
  set: (k, e) => {
    memory.set(k, e);
    return Promise.resolve();
  },
};

securityReviewer((r) =>
  r.provider("openai").cache(aiCache((c) => c.store(inMemory)))
);
```

Caching pairs naturally with the other
[cost controls](./ai-review.md#scoping-the-diff-and-cost) (`budget`,
`maxDiffTokens`, a cheaper `model`) — see the AI review docs for the full
picture.

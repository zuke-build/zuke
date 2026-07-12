# Caching

Zuke has **two independent caches**, and they solve different problems. Reach for
whichever matches what you're trying to avoid re-doing:

| Cache | What it skips | Where it lives | Opt in with |
| --- | --- | --- | --- |
| **Incremental build cache** | Re-running a target whose inputs are unchanged | `<repo root>/.zuke/cache.json` | `.inputs()` (and/or `.cacheKey()`) on a target |
| **AI response cache** | Re-paying a model for an identical review/fix call | `<repo root>/.zuke/ai-cache/` | `.cache(aiCache(...))` on a reviewer or fixer |

Both are file-backed, git-ignored, dependency-free, and **best-effort**: a
missing or corrupt store is treated as empty (everything just rebuilds), so a
broken cache never breaks a build.

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
**also** requires every declared output to still exist — so deleting `dist/`
(or any declared output) forces a rebuild even when the inputs are untouched.
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

## AI response cache

An [AI review](./ai-review.md) or [fix](./self-healing.md) call is expensive: it
spends tokens and round-trips to a provider. Yet the **same** call often runs
again and again — a flaky CI retry, a re-pushed branch, a local loop over an
unchanged diff. `aiCache(...)` persists each provider response so an **identical**
call reuses the stored answer instead of paying for the model again.

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
model is a natural miss. A cache **hit costs nothing** and does **not** draw down
a [budget](./ai-review.md#scoping-the-diff-and-cost).

### Configuring `aiCache`

`aiCache((c) => …)` builds the cache inline. Every knob is optional:

| Method | Effect |
| --- | --- |
| `.dir(path)` | Directory for the default file store (default `.zuke/ai-cache`). |
| `.ttl(seconds)` | Entries older than this are ignored. **Default `604800` (7 days)**; `0` means never expire. |
| `.disable()` | Turn the cache off programmatically — every read misses, every write is a no-op. |
| `.store(custom)` | Inject a custom [`CacheStore`](#custom-stores) instead of the file store. |

The cache is **opt-in per reviewer/fixer** — it does nothing until you attach it
with `.cache(...)`. It is deliberately **best-effort**: a missing file, a corrupt
or truncated entry, or a failed write is swallowed and treated as a miss, so a
broken cache never breaks the build it caches for.

### Custom stores

The default backing store writes one JSON file per key under `.dir()`. Any object
implementing `CacheStore` — `get(key)` / `set(key, entry)` — can replace it via
`.store(...)`, which is how tests inject an in-memory store for a single run:

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

securityReviewer((r) => r.provider("openai").cache(aiCache((c) => c.store(inMemory))));
```

Caching pairs naturally with the other [cost controls](./ai-review.md#scoping-the-diff-and-cost)
(`budget`, `maxDiffTokens`, a cheaper `model`) — see the AI review docs for the
full picture.

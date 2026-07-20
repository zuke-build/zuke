/**
 * A filesystem-backed cache for AI provider responses.
 *
 * A review call is expensive — it spends tokens and round-trips to a provider
 * — yet the same failing build (an identical diff, an identical prompt) often
 * runs again and again: a flaky retry, a re-pushed branch, a local loop. An
 * {@link AiCache} keys each provider response by a {@link stableHash} of the
 * call's salient parts and persists it, so an identical call reuses the prior
 * {@link CacheEntry} instead of paying for the model again.
 *
 * The default backing store writes one JSON file per key under {@link AiCache.dir}
 * (`.zuke/ai-cache` by default), but any {@link CacheStore} can be injected with
 * {@link AiCache.store} — a test seam, or an in-memory store for a single run.
 * Entries carry the epoch-millisecond {@link CacheEntry.createdAt} they were
 * written at, so {@link AiCache.ttl} can expire stale responses. The cache is
 * deliberately best-effort: a missing file, a corrupt entry, or a store error
 * is swallowed and treated as a miss, so a broken cache never breaks a build.
 *
 * @module
 */

import { FileTasks } from "@zuke/core";
import type { Configure } from "@zuke/core/tooling";
import { stableHash } from "./hash.ts";
import type { Usage } from "./types.ts";

/** The default directory for the file-backed store. */
const DEFAULT_DIR = ".zuke/ai-cache";

/** The default time-to-live for an entry, in seconds (7 days). */
const DEFAULT_TTL_SECONDS = 604_800;

/** A cached provider response. */
export interface CacheEntry {
  /** The model's raw text response. */
  text: string;
  /** Token usage reported for the original call, if any. */
  usage?: Usage;
  /** Epoch milliseconds when the entry was written (for TTL). */
  createdAt: number;
}

/** A pluggable backing store for the cache (the default is file-backed). */
export interface CacheStore {
  /** Fetch the entry stored under `key`, or `undefined` when absent. */
  get(key: string): Promise<CacheEntry | undefined>;
  /** Store `entry` under `key`, replacing any prior value. */
  set(key: string, entry: CacheEntry): Promise<void>;
}

/**
 * Whether `value` is a well-formed {@link CacheEntry} — it must carry a string
 * `text` and a finite numeric `createdAt`. Parsed JSON is `unknown`, so this
 * guard narrows it without a cast; a malformed file (hand-edited, truncated, or
 * from an older format) is rejected as a miss rather than handed back as a bad
 * entry. `createdAt` is required because {@link AiCache.get_} computes the TTL
 * from it — a missing timestamp would make `now - createdAt` be `NaN`, whose
 * comparisons are always false, so a stale entry would never expire and be
 * served forever.
 */
function isCacheEntry(value: unknown): value is CacheEntry {
  return typeof value === "object" && value !== null &&
    "text" in value && typeof value.text === "string" &&
    "createdAt" in value && typeof value.createdAt === "number" &&
    Number.isFinite(value.createdAt);
}

/**
 * The default {@link CacheStore}: one JSON file per key under `dir`. Reads are
 * best-effort — a missing file or a JSON parse error resolves to `undefined`
 * rather than throwing — and a write ensures `dir` exists first.
 */
function fileStore(dir: string): CacheStore {
  const pathFor = (key: string) => `${dir}/${key}.json`;
  return {
    async get(key: string): Promise<CacheEntry | undefined> {
      try {
        const parsed: unknown = JSON.parse(
          await FileTasks.readText(pathFor(key)),
        );
        return isCacheEntry(parsed) ? parsed : undefined;
      } catch {
        return undefined; // missing file or malformed JSON — treat as a miss
      }
    },
    async set(key: string, entry: CacheEntry): Promise<void> {
      await FileTasks.createDirectory(dir, { recursive: true });
      await FileTasks.writeText(pathFor(key), JSON.stringify(entry));
    },
  };
}

/**
 * A best-effort cache of AI provider responses, keyed by a {@link stableHash} of
 * each call's salient parts and persisted through a {@link CacheStore} (the
 * default writes JSON files under {@link AiCache.dir}). Configure it inline with
 * {@link aiCache}: set the {@link AiCache.dir}, the {@link AiCache.ttl}, or
 * {@link AiCache.disable} it entirely, then read with {@link AiCache.get_} and
 * write with {@link AiCache.put_}.
 */
export class AiCache {
  /** The directory for the default file store. */
  private dir_ = DEFAULT_DIR;
  /** The time-to-live in seconds; `0` means entries never expire. */
  private ttl_ = DEFAULT_TTL_SECONDS;
  /** Whether the cache is active (cleared by {@link disable}). */
  private enabled__ = true;
  /** An injected store, or `undefined` to fall back to the file store. */
  private store_?: CacheStore;
  /** The clock used for `createdAt` and TTL checks. */
  private now_: () => number = () => Date.now();

  /** Directory for the default file store (default ".zuke/ai-cache"). */
  dir(path: string): this {
    this.dir_ = path;
    return this;
  }

  /** Entries older than this many seconds are ignored (default 604800 = 7 days; 0 = never expire). */
  ttl(seconds: number): this {
    this.ttl_ = seconds;
    return this;
  }

  /** Turn the cache off programmatically ({@link get_} misses, {@link put_} is a no-op). */
  disable(): this {
    this.enabled__ = false;
    return this;
  }

  /** Inject a custom backing store (test seam; overrides the file store). */
  store(custom: CacheStore): this {
    this.store_ = custom;
    return this;
  }

  /** Clock seam for `createdAt` and TTL checks (default `Date.now`). */
  now(clock: () => number): this {
    this.now_ = clock;
    return this;
  }

  /** The effective store — the injected one, or a fresh file store at {@link dir_}. */
  private backing_(): CacheStore {
    return this.store_ ?? fileStore(this.dir_);
  }

  /** INTERNAL: whether the cache is active. */
  enabled_(): boolean {
    return this.enabled__;
  }

  /** INTERNAL: derive a stable key from the given parts. */
  key_(parts: string[]): string {
    // A NUL separator so adjacent parts can't collide (e.g. ["ab", "c"] vs
    // ["a", "bc"]) — no real prompt or model id contains a NUL byte.
    return stableHash(parts.join("\0"));
  }

  /** INTERNAL: fetch a live (non-expired) entry, or `undefined`. */
  async get_(key: string): Promise<CacheEntry | undefined> {
    if (!this.enabled__) return undefined;
    let entry: CacheEntry | undefined;
    try {
      entry = await this.backing_().get(key);
    } catch {
      // Best-effort per the class contract: a throwing store is a miss, never a
      // build-breaking error. (The file store already swallows its own errors;
      // this guards an injected store that rejects.)
      return undefined;
    }
    if (entry === undefined) return undefined;
    if (this.ttl_ > 0 && this.now_() - entry.createdAt > this.ttl_ * 1_000) {
      return undefined; // expired — treat as a miss
    }
    return entry;
  }

  /** INTERNAL: store a response under `key`. */
  async put_(key: string, text: string, usage?: Usage): Promise<void> {
    if (!this.enabled__) return;
    const entry: CacheEntry = {
      text,
      ...(usage !== undefined ? { usage } : {}),
      createdAt: this.now_(),
    };
    try {
      await this.backing_().set(key, entry);
    } catch {
      // Best-effort: a failed write must never break the build it caches for.
    }
  }
}

/**
 * Construct an {@link AiCache}, applying an optional configure lambda so it can
 * be set up inline — e.g. `aiCache((c) => c.dir(".cache").ttl(3600))`.
 */
export function aiCache(configure?: Configure<AiCache>): AiCache {
  const cache = new AiCache();
  return configure ? configure(cache) : cache;
}

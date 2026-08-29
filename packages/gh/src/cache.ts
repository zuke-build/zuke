// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `gh cache` — reading and reclaiming a repository's Actions caches.
 *
 * ```ts
 * import { GhTasks } from "jsr:@zuke/gh";
 * const caches = await GhTasks.cacheListEntries((s) => s.key("deno-").sort("size_in_bytes"));
 * await GhTasks.cacheDelete((s) => s.all().succeedOnNoCaches());
 * ```
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { GhCommandSettings, GhReadSettings } from "./subcommand.ts";
import { numberField, parseJsonArray, stringField } from "./json_array.ts";

/** What `gh cache list --sort` orders the caches by. */
export type GhCacheSort = "created_at" | "last_accessed_at" | "size_in_bytes";

/** Settings for `gh cache list`. */
export class GhCacheListSettings extends GhReadSettings {
  #key?: string;
  #ref?: string;
  #sort?: GhCacheSort;
  #order?: string;
  #limit?: number;

  /** Only caches whose key starts with this (`--key`). */
  key(prefix: string): this {
    this.#key = prefix;
    return this;
  }

  /** Only caches for this ref (`--ref`), e.g. `refs/heads/master`. */
  ref(name: string): this {
    this.#ref = name;
    return this;
  }

  /** What to order by (`--sort`); gh's default is `last_accessed_at`. */
  sort(field: GhCacheSort): this {
    this.#sort = field;
    return this;
  }

  /** The direction (`--order`): `asc` or `desc`. */
  order(direction: "asc" | "desc"): this {
    this.#order = direction;
    return this;
  }

  /** Cap how many are fetched (`--limit`); gh's default is 30. */
  limit(count: number): this {
    this.#limit = count;
    return this;
  }

  /** The `gh cache list` command path. */
  protected override commandPath(): string[] {
    return ["cache", "list"];
  }

  /** Assemble the `gh cache list` flags. */
  protected override commandFlags(): string[] {
    const argv: string[] = [];
    if (this.#key !== undefined) argv.push("--key", this.#key);
    if (this.#ref !== undefined) argv.push("--ref", this.#ref);
    if (this.#sort !== undefined) argv.push("--sort", this.#sort);
    if (this.#order !== undefined) argv.push("--order", this.#order);
    if (this.#limit !== undefined) argv.push("--limit", String(this.#limit));
    argv.push(...this.readFlags());
    return argv;
  }
}

/** Settings for `gh cache delete`. */
export class GhCacheDeleteSettings extends GhCommandSettings {
  #selector?: string;
  #all = false;
  #ref?: string;
  #succeedOnNoCaches = false;

  /** The cache to delete, by its id or its key. */
  selector(idOrKey: string | number): this {
    this.#selector = String(idOrKey);
    return this;
  }

  /** Delete every cache (`--all`), narrowed by {@link ref} when one is set. */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Restrict the deletion to one ref (`--ref`). */
  ref(name: string): this {
    this.#ref = name;
    return this;
  }

  /** Exit zero when there was nothing to delete (`--succeed-on-no-caches`). */
  succeedOnNoCaches(): this {
    this.#succeedOnNoCaches = true;
    return this;
  }

  /** The `gh cache delete` command path. */
  protected override commandPath(): string[] {
    const argv = ["cache", "delete"];
    if (this.#selector !== undefined) argv.push(this.#selector);
    return argv;
  }

  /** Assemble the `gh cache delete` flags. */
  protected override commandFlags(): string[] {
    if (this.#selector === undefined && !this.#all) {
      throw new Error(
        "GhTasks.cacheDelete: name a cache with .selector(...) or ask for " +
          "every one with .all() — without either gh shows a picker, and a " +
          "build has no one to answer it.",
      );
    }
    if (this.#selector !== undefined && this.#all) {
      throw new Error(
        "GhTasks.cacheDelete: .selector(...) deletes one cache and .all() " +
          "deletes every one — pick one.",
      );
    }
    if (this.#succeedOnNoCaches && !this.#all) {
      throw new Error(
        "GhTasks.cacheDelete: gh accepts --succeed-on-no-caches only with " +
          ".all() — add it, or drop .succeedOnNoCaches().",
      );
    }
    const argv: string[] = [];
    if (this.#all) argv.push("--all");
    if (this.#ref !== undefined) argv.push("--ref", this.#ref);
    if (this.#succeedOnNoCaches) argv.push("--succeed-on-no-caches");
    return argv;
  }
}

/** One cache of {@link "./gh.ts".GhTasks.cacheListEntries}. */
export interface GhCacheEntry {
  /** The cache's numeric id — what {@link GhCacheDeleteSettings} takes. */
  id?: number;
  /** Its key, as the workflow that saved it chose. */
  key?: string;
  /** The ref it belongs to. */
  ref?: string;
  /** How much space it occupies, in bytes. */
  sizeInBytes?: number;
  /** When it was created, ISO 8601. */
  createdAt?: string;
  /** When it was last read, ISO 8601 — what eviction goes by. */
  lastAccessedAt?: string;
}

/**
 * The `--json` fields {@link readCaches} asks for; gh requires the list by
 * name, so the reader pins the set {@link GhCacheEntry} describes.
 */
export const CACHE_LIST_FIELDS: readonly string[] = [
  "id",
  "key",
  "ref",
  "sizeInBytes",
  "createdAt",
  "lastAccessedAt",
];

/**
 * Parse `gh cache list --json …` into entries.
 *
 * Not part of the package's public surface — exported for its unit test.
 */
export function parseCaches(stdout: string): GhCacheEntry[] {
  return parseJsonArray(stdout).map((record) => {
    const entry: GhCacheEntry = {};
    const id = numberField(record, "id");
    const key = stringField(record, "key");
    const ref = stringField(record, "ref");
    const sizeInBytes = numberField(record, "sizeInBytes");
    const createdAt = stringField(record, "createdAt");
    const lastAccessedAt = stringField(record, "lastAccessedAt");
    if (id !== undefined) entry.id = id;
    if (key !== undefined) entry.key = key;
    if (ref !== undefined) entry.ref = ref;
    if (sizeInBytes !== undefined) entry.sizeInBytes = sizeInBytes;
    if (createdAt !== undefined) entry.createdAt = createdAt;
    if (lastAccessedAt !== undefined) entry.lastAccessedAt = lastAccessedAt;
    return entry;
  });
}

/**
 * Run `gh cache list --json …` and parse it. Backs
 * {@link "./gh.ts".GhTasks.cacheListEntries}.
 */
export async function readCaches(
  configure?: Configure<GhCacheListSettings>,
): Promise<GhCacheEntry[]> {
  const settings = new GhCacheListSettings();
  const configured = configure ? configure(settings) : settings;
  const output = await configured.json(...CACHE_LIST_FIELDS).run();
  return parseCaches(output.stdout);
}

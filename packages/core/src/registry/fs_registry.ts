// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link FileSystemBuildRegistry} — a {@link BuildRegistry} backed by one JSON
 * file per build under a directory (default `<repo root>/.zuke/builds`).
 *
 * It is single-host by design (fine for dev, per the requirement); production
 * uses {@link "./http_registry.ts".HttpBuildRegistry}. Compare-and-swap is
 * enforced with the shared {@link "../state/mutex.ts".withFileMutex} marker plus
 * an atomic temp-file rename — the same primitive
 * {@link "../state/fs_store.ts".FileSystemStateStore} holds — so two
 * registrations racing at the same version cannot both win, and a marker left by
 * a killed writer expires instead of wedging the directory. The version is a
 * content hash, mirroring the ETag the HTTP backend uses.
 *
 * @module
 */

import { defaultStateHost, type StateHost } from "../state/store.ts";
import {
  type BuildDescriptor,
  type BuildQuery,
  type BuildSummary,
  parseBuildDescriptor,
  stringifyBuildDescriptor,
  toBuildSummary,
} from "./descriptor.ts";
import type { BuildRegistry, PutBuildResult } from "./registry.ts";
import { withFileMutex } from "../state/mutex.ts";
import {
  assertSafeId,
  casWriteJson,
  sortNewestFirst,
} from "../state/json_file_cas.ts";
import { sha256Hex } from "../internal.ts";

/**
 * A {@link BuildRegistry} that writes one `<id>.json` file per build under a
 * directory.
 *
 * **Security.** `dir` is *trusted configuration* — the location you choose to
 * store the build catalog (from `ZUKE_REGISTRY_DIR` or an explicit registry),
 * the same posture as {@link "../state/fs_store.ts".FileSystemStateStore}. The
 * only untrusted value that reaches a path is the build **id**, validated at
 * every point a path is built, so a traversal cannot be smuggled in via an id.
 */
export class FileSystemBuildRegistry implements BuildRegistry {
  readonly #dir: string;
  readonly #host: StateHost;
  #ensured = false;

  /**
   * Build the registry over `dir` (created on first write). Filesystem access
   * goes through `host`, which defaults to
   * {@link "../state/store.ts".defaultStateHost}.
   */
  constructor(dir: string, host: StateHost = defaultStateHost) {
    this.#dir = dir.replace(/\/+$/, "");
    this.#host = host;
  }

  // Both id-derived paths are built through these helpers, and both validate the
  // id — so a traversal can't slip in via a caller that forgets to check.
  #file(id: string): string {
    assertSafeId("registry", "build", id);
    return `${this.#dir}/${id}.json`;
  }

  #lock(id: string): string {
    assertSafeId("registry", "build", id);
    return `${this.#dir}/${id}.json.lock`;
  }

  async #ensureDir(): Promise<void> {
    if (this.#ensured) return;
    await this.#host.mkdirp(this.#dir);
    this.#ensured = true;
  }

  /** Fetch a build and the content-hash version of its stored file. */
  async getBuild(
    id: string,
  ): Promise<{ descriptor: BuildDescriptor; version: string } | null> {
    const text = await this.#host.readText(this.#file(id));
    if (text === null) return null;
    return {
      descriptor: parseBuildDescriptor(text),
      version: await sha256Hex(text),
    };
  }

  /** Publish `descriptor` under an exclusive lock, guarding the expected version. */
  async register(
    descriptor: BuildDescriptor,
    expectedVersion: string | null,
  ): Promise<PutBuildResult> {
    // #lock/#file validate descriptor.id before any path is used below.
    await this.#ensureDir();
    return await this.#withLock(descriptor.id, () =>
      casWriteJson(
        this.#host,
        this.#file(descriptor.id),
        stringifyBuildDescriptor(descriptor),
        expectedVersion,
      ));
  }

  /** Remove a registered build under an exclusive lock; a missing file is a no-op. */
  async deregister(id: string): Promise<void> {
    await this.#ensureDir();
    await this.#withLock(id, () => this.#host.remove(this.#file(id)));
  }

  /** List builds matching `query`, newest first. Unreadable files are skipped. */
  async listBuilds(query: BuildQuery): Promise<BuildSummary[]> {
    const names = await this.#host.listDir(this.#dir);
    const summaries: BuildSummary[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue; // skip .lock / .tmp-* markers
      const text = await this.#host.readText(`${this.#dir}/${name}`);
      if (text === null) continue;
      let descriptor: BuildDescriptor;
      try {
        descriptor = parseBuildDescriptor(text);
      } catch {
        continue; // a corrupt/partial file must not break listing the rest
      }
      if (matches(descriptor, query)) {
        summaries.push(toBuildSummary(descriptor));
      }
    }
    return sortNewestFirst(summaries);
  }

  /**
   * Take the build's lock (spinning briefly on contention), run `fn`, release —
   * through the same {@link withFileMutex} primitive the state store uses, so a
   * marker left behind by a killed `zuke register` is reclaimed once it expires
   * instead of wedging every later writer.
   */
  #withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    return withFileMutex(
      {
        host: this.#host,
        marker: this.#lock(id),
        scope: "registry",
        subject: `build "${id}"`,
      },
      fn,
    );
  }
}

/** Whether a descriptor passes a {@link BuildQuery}. */
function matches(descriptor: BuildDescriptor, query: BuildQuery): boolean {
  if (query.name !== undefined && descriptor.name !== query.name) return false;
  if (query.since !== undefined && descriptor.createdAt < query.since) {
    return false;
  }
  return true;
}

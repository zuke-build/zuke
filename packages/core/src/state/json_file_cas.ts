// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The three primitives the single-host, one-JSON-file-per-record backends share:
 * the id guard that keeps a path inside its directory
 * ({@link assertSafeId}), the content-hash compare-and-swap write
 * ({@link casWriteJson}), and the newest-first listing order
 * ({@link sortNewestFirst}). Held by {@link "./fs_store.ts".FileSystemStateStore}
 * for run records and {@link "../registry/fs_registry.ts".FileSystemBuildRegistry}
 * for build descriptors, so the two cannot drift apart — the same reason
 * {@link "./mutex.ts".withFileMutex} lives on its own.
 *
 * Plain functions, not an engine: {@link casWriteJson} runs *inside* each
 * backend's own mutex, so each keeps its own lock naming, error wording and
 * scope string.
 *
 * This module is **internal**: it is not re-exported from `mod.ts` (or any
 * entrypoint), so nothing here is public API.
 *
 * @module
 */

import type { PutResult, StateHost } from "./store.ts";
import { sha256Hex } from "../internal.ts";

/**
 * Reject an id that could escape its directory. Ids are UUIDs (runs) or build
 * class names (builds) in normal use; this guards the case where one arrives
 * from the CLI or a query. `scope` prefixes the message (`state` / `registry`)
 * and `noun` names what the id identifies (`run` / `build`).
 */
export function assertSafeId(scope: string, noun: string, id: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new Error(`${scope}: unsafe ${noun} id "${id}"`);
  }
}

/**
 * Publish `content` to `file` only if the stored content still hashes to
 * `expectedVersion` (`null` meaning "must not exist yet"), via an atomic
 * temp-file rename. Returns the new version, or a conflict when the stored
 * version has moved on.
 *
 * The compare and the swap are only atomic together because the caller holds the
 * file's mutex around this whole call — see
 * {@link "./mutex.ts".withFileMutex}.
 */
export async function casWriteJson(
  host: StateHost,
  file: string,
  content: string,
  expectedVersion: string | null,
): Promise<PutResult> {
  const current = await host.readText(file);
  const currentVersion = current === null ? null : await sha256Hex(current);
  if (currentVersion !== expectedVersion) {
    return { ok: false, conflict: true };
  }
  const tmp = `${file}.tmp-${crypto.randomUUID()}`;
  await host.writeText(tmp, content);
  await host.rename(tmp, file);
  return { ok: true, version: await sha256Hex(content) };
}

/** Sort by `createdAt` descending, then `id` descending, for stable output. */
export function sortNewestFirst<S extends { id: string; createdAt: string }>(
  items: S[],
): S[] {
  return items.sort((a, b) =>
    a.createdAt !== b.createdAt
      ? (a.createdAt < b.createdAt ? 1 : -1)
      : (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  );
}

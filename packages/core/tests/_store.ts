// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A throwaway, real {@link FileSystemStateStore} for the test suite. The
 * durable-state features — `waitsFor`, `lock`, cancel, resume, reap — are only
 * worth testing against the actual filesystem backend, and every one of those
 * tests wants the same thing: a store under a temp directory that disappears
 * afterwards.
 *
 * @module
 */

import { FileSystemStateStore } from "../src/state/fs_store.ts";
import { defaultStateHost } from "../src/state/store.ts";
import { withTemp } from "./_temp.ts";

/**
 * Run `fn` with a {@link FileSystemStateStore} rooted at `runs/` inside a fresh
 * temp directory, cleaned up afterwards. The directory itself is passed as the
 * second argument, for tests that also write files beside the store.
 */
export async function withTempStore(
  fn: (store: FileSystemStateStore, dir: string) => Promise<void>,
): Promise<void> {
  await withTemp(async (dir) => {
    await fn(new FileSystemStateStore(`${dir}/runs`, defaultStateHost), dir);
  });
}

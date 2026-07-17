/**
 * Selection of the {@link StateStore} for a run, by precedence — the state
 * analogue of {@link "../remote_cache.ts".resolveRemoteStore}.
 *
 * @module
 */

import type { StateHost, StateStore } from "./store.ts";
import { FileSystemStateStore } from "./fs_store.ts";
import { HttpStateStore } from "./http_store.ts";

/**
 * Resolve a {@link StateStore} from the environment, or `undefined` when none is
 * configured. `ZUKE_STATE_URL` (with an optional `ZUKE_STATE_TOKEN`) selects an
 * {@link HttpStateStore}; otherwise `ZUKE_STATE_DIR` selects a
 * {@link FileSystemStateStore}.
 */
export function envStateStore(
  readEnv: (name: string) => string | undefined,
  host: StateHost,
): StateStore | undefined {
  const url = readEnv("ZUKE_STATE_URL");
  if (url !== undefined && url !== "") {
    return new HttpStateStore({ url, token: readEnv("ZUKE_STATE_TOKEN") });
  }
  const dir = readEnv("ZUKE_STATE_DIR");
  if (dir !== undefined && dir !== "") {
    return new FileSystemStateStore(dir, host);
  }
  return undefined;
}

/** Inputs {@link resolveStateStore} needs to build the default filesystem store. */
export interface ResolveStateOptions {
  /** Reads an environment variable (injectable for tests). */
  readEnv: (name: string) => string | undefined;
  /** Filesystem effects for the default/env filesystem store. */
  host: StateHost;
  /** Directory the default filesystem store writes to (`<root>/.zuke/runs`). */
  defaultDir: string;
  /**
   * Fall back to the default filesystem store when nothing else is configured.
   * Set when the run opts into durable state (`--state`, or — from a later
   * milestone — a durable feature like a lock or a wait).
   */
  enableDefault: boolean;
}

/**
 * Pick the state store for a run by precedence: an explicit `option` wins
 * (`false` disables state entirely), then a `declared` store (a build's
 * `stateStore()` override), then the {@link envStateStore} environment
 * fallback, then — only when {@link ResolveStateOptions.enableDefault} — a
 * filesystem store under `<root>/.zuke/runs`. A plain build with no durable
 * feature and no configuration gets `undefined`, so it carries zero overhead.
 */
export function resolveStateStore(
  option: StateStore | false | undefined,
  declared: StateStore | undefined,
  options: ResolveStateOptions,
): StateStore | undefined {
  if (option === false) return undefined;
  if (option !== undefined) return option;
  if (declared !== undefined) return declared;
  const fromEnv = envStateStore(options.readEnv, options.host);
  if (fromEnv !== undefined) return fromEnv;
  if (options.enableDefault) {
    return new FileSystemStateStore(options.defaultDir, options.host);
  }
  return undefined;
}

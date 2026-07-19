/**
 * Selection of the {@link BuildRegistry} for a command, by precedence — the
 * registry analogue of {@link "../state/resolve.ts".resolveStateStore}. Kept a
 * separate concern from the run store, so it reads its own `ZUKE_REGISTRY_*`
 * environment variables and defaults to its own directory
 * (`<root>/.zuke/builds`), never colliding with `.zuke/runs`.
 *
 * @module
 */

import type { StateHost } from "../state/store.ts";
import { FileSystemBuildRegistry } from "./fs_registry.ts";
import { HttpBuildRegistry } from "./http_registry.ts";
import type { BuildRegistry } from "./registry.ts";

/**
 * Resolve a {@link BuildRegistry} from the environment, or `undefined` when none
 * is configured. `ZUKE_REGISTRY_URL` (with an optional `ZUKE_REGISTRY_TOKEN`)
 * selects an {@link HttpBuildRegistry}; otherwise `ZUKE_REGISTRY_DIR` selects a
 * {@link FileSystemBuildRegistry}.
 */
export function envBuildRegistry(
  readEnv: (name: string) => string | undefined,
  host: StateHost,
): BuildRegistry | undefined {
  const url = readEnv("ZUKE_REGISTRY_URL");
  if (url !== undefined && url !== "") {
    return new HttpBuildRegistry({
      url,
      token: readEnv("ZUKE_REGISTRY_TOKEN"),
    });
  }
  const dir = readEnv("ZUKE_REGISTRY_DIR");
  if (dir !== undefined && dir !== "") {
    return new FileSystemBuildRegistry(dir, host);
  }
  return undefined;
}

/** Inputs {@link resolveBuildRegistry} needs to build the default filesystem registry. */
export interface ResolveRegistryOptions {
  /** Reads an environment variable (injectable for tests). */
  readEnv: (name: string) => string | undefined;
  /** Filesystem effects for the default/env filesystem registry. */
  host: StateHost;
  /** Directory the default filesystem registry writes to (`<root>/.zuke/builds`). */
  defaultDir: string;
  /**
   * Fall back to the default filesystem registry when nothing else is
   * configured. `zuke register` sets this so the command works out of the box.
   */
  enableDefault: boolean;
}

/**
 * Pick the build registry by precedence: an explicit `option` wins (`false`
 * disables the registry entirely), then a `declared` registry (a build's
 * `registry()` override), then the {@link envBuildRegistry} environment
 * fallback, then — only when {@link ResolveRegistryOptions.enableDefault} — a
 * filesystem registry under `<root>/.zuke/builds`.
 */
export function resolveBuildRegistry(
  option: BuildRegistry | false | undefined,
  declared: BuildRegistry | undefined,
  options: ResolveRegistryOptions,
): BuildRegistry | undefined {
  if (option === false) return undefined;
  if (option !== undefined) return option;
  if (declared !== undefined) return declared;
  const fromEnv = envBuildRegistry(options.readEnv, options.host);
  if (fromEnv !== undefined) return fromEnv;
  if (options.enableDefault) {
    return new FileSystemBuildRegistry(options.defaultDir, options.host);
  }
  return undefined;
}

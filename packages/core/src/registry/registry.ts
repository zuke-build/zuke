/**
 * The pluggable {@link BuildRegistry} — a catalog of the builds (pipelines) that
 * exist and where they live — kept **separate** from the run
 * {@link "../state/store.ts".StateStore} (a run history and a build catalog are
 * different concerns) but resolved the same way (see
 * {@link "./resolve.ts".resolveBuildRegistry}).
 *
 * Two backends ship, both dependency-free and mirroring the state layer:
 * {@link "./fs_registry.ts".FileSystemBuildRegistry} for a single host (fine for
 * dev) and {@link "./http_registry.ts".HttpBuildRegistry} for a hosted service
 * (the production path — the `/builds` collection of `docs/state-api.md`). A
 * consumer can implement this interface against their own catalog and plug it in
 * via `Build.registry()`, so a richer catalog stays a plugin rather than core.
 *
 * The filesystem effects a backend needs are the same as the state layer's, so
 * the {@link "../state/store.ts".StateHost} is reused rather than re-declared.
 *
 * @module
 */

import type {
  BuildDescriptor,
  BuildQuery,
  BuildSummary,
} from "./descriptor.ts";

/** The result of a {@link BuildRegistry.register} compare-and-swap write. */
export type PutBuildResult =
  | { ok: true; version: string }
  | { ok: false; conflict: true };

/**
 * Pluggable persistence for {@link BuildDescriptor}s. `version` is an opaque
 * token (an ETag or content hash) used for optimistic concurrency: a write only
 * lands if the stored version still matches the one the writer last read, so two
 * registrations racing at the same version cannot both win.
 */
export interface BuildRegistry {
  /** Fetch a build and its current version, or `null` if it is not registered. */
  getBuild(
    id: string,
  ): Promise<{ descriptor: BuildDescriptor; version: string } | null>;
  /**
   * Write `descriptor` only if the stored version equals `expectedVersion`
   * (`null` meaning "must not exist yet"). Returns the new version, or a conflict
   * when the stored version has moved on — the caller re-reads and retries.
   */
  register(
    descriptor: BuildDescriptor,
    expectedVersion: string | null,
  ): Promise<PutBuildResult>;
  /** Remove a registered build by id; a missing build is not an error. */
  deregister(id: string): Promise<void>;
  /** List registered builds matching `query`, newest first (by `createdAt`, then `id`). */
  listBuilds(query: BuildQuery): Promise<BuildSummary[]>;
}

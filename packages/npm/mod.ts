// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/npm` — typed `NpmTasks` wrappers for the `npm` CLI, for use in Zuke
 * build targets (including builds that drive Node projects).
 *
 * ```ts
 * import { NpmTasks } from "jsr:@zuke/npm";
 *
 * await NpmTasks.ci();
 * await NpmTasks.run((s) => s.script("build"));
 * const stale = await NpmTasks.outdatedEntries();
 * ```
 *
 * Typed tasks cover the everyday npm surface — installing, running scripts,
 * publishing, registry administration, inspection, and the project's own
 * files. A handful hand back parsed values rather than raw output:
 * `outdatedEntries`, `auditSummary`, `pkgGet`, and `whoamiName`.
 *
 * @module
 */

export * from "./src/settings.ts";
export * from "./src/npm.ts";
export * from "./src/install.ts";
export * from "./src/scripts.ts";
export * from "./src/publish.ts";
export * from "./src/registry.ts";
export * from "./src/project.ts";
export {
  NpmAuditSettings,
  type NpmAuditSummary,
  NpmLsSettings,
  type NpmOutdatedEntry,
  NpmOutdatedSettings,
  NpmSbomSettings,
} from "./src/inspect.ts";

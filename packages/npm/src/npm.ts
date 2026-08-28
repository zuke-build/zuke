// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `NpmTasks` — typed task functions for the `npm` CLI, in the
 * settings-lambda style: configure a fluent settings object in a lambda, and
 * the task function builds the command line and executes it.
 *
 * ```ts
 * import { NpmTasks } from "jsr:@zuke/npm";
 * await NpmTasks.ci((s) => s.omit("dev"));
 * await NpmTasks.run((s) => s.script("build").workspace("app"));
 * const stale = await NpmTasks.outdatedEntries();
 * ```
 *
 * Every task shares npm's config flags (`--registry`, `--json`, `--loglevel`,
 * `--global`), and the commands that accept workspace selection share
 * `.workspace()` / `.workspaces()`. Most tasks resolve to the raw
 * {@link "@zuke/core/shell".CommandOutput}; the few that name a value —
 * `outdatedEntries`, `auditSummary`, `pkgGet`, `whoamiName` — run a
 * machine-readable form and hand back parsed data instead.
 *
 * On Windows, npm ships as a `.cmd` shim; the shared tooling base retries
 * through `cmd /c` automatically when direct spawning fails.
 *
 * @module
 */

import { type Configure, runSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";
import {
  NpmCiSettings,
  NpmDedupeSettings,
  NpmInstallSettings,
  NpmLinkSettings,
  NpmPruneSettings,
  NpmRebuildSettings,
  NpmUninstallSettings,
  NpmUpdateSettings,
} from "./install.ts";
import { NpmExecSettings, NpmRunSettings, NpmTestSettings } from "./scripts.ts";
import {
  NpmDeprecateSettings,
  NpmDistTagSettings,
  NpmPackSettings,
  NpmPublishSettings,
  NpmUnpublishSettings,
  NpmVersionSettings,
} from "./publish.ts";
import {
  NpmAccessSettings,
  NpmOwnerSettings,
  NpmPingSettings,
  NpmTokenSettings,
  NpmViewSettings,
  NpmWhoamiSettings,
  readWhoami,
} from "./registry.ts";
import {
  NpmAuditSettings,
  type NpmAuditSummary,
  NpmLsSettings,
  type NpmOutdatedEntry,
  NpmOutdatedSettings,
  NpmSbomSettings,
  readAuditSummary,
  readOutdated,
} from "./inspect.ts";
import {
  NpmCacheSettings,
  NpmConfigSettings,
  NpmInitSettings,
  NpmPkgSettings,
  readPkgField,
} from "./project.ts";

/** The shape of {@link NpmTasks}. */
export interface NpmTasksApi {
  /** Install dependencies: `npm install`. */
  install(configure?: Configure<NpmInstallSettings>): Promise<CommandOutput>;
  /** Clean install from the lockfile: `npm ci`. */
  ci(configure?: Configure<NpmCiSettings>): Promise<CommandOutput>;
  /** Remove dependencies: `npm uninstall`. */
  uninstall(
    configure?: Configure<NpmUninstallSettings>,
  ): Promise<CommandOutput>;
  /** Update dependencies within their ranges: `npm update`. */
  update(configure?: Configure<NpmUpdateSettings>): Promise<CommandOutput>;
  /** Flatten duplicated packages: `npm dedupe`. */
  dedupe(configure?: Configure<NpmDedupeSettings>): Promise<CommandOutput>;
  /** Remove packages nothing depends on: `npm prune`. */
  prune(configure?: Configure<NpmPruneSettings>): Promise<CommandOutput>;
  /** Rebuild native packages: `npm rebuild`. */
  rebuild(configure?: Configure<NpmRebuildSettings>): Promise<CommandOutput>;
  /** Symlink a package for local development: `npm link`. */
  link(configure?: Configure<NpmLinkSettings>): Promise<CommandOutput>;
  /** Run a package.json script: `npm run`. */
  run(configure?: Configure<NpmRunSettings>): Promise<CommandOutput>;
  /** Run the project's test script: `npm test`. */
  test(configure?: Configure<NpmTestSettings>): Promise<CommandOutput>;
  /** Execute a package binary: `npm exec`. */
  exec(configure?: Configure<NpmExecSettings>): Promise<CommandOutput>;
  /** Publish the package: `npm publish`. */
  publish(configure?: Configure<NpmPublishSettings>): Promise<CommandOutput>;
  /** Build a tarball without publishing it: `npm pack`. */
  pack(configure?: Configure<NpmPackSettings>): Promise<CommandOutput>;
  /** Bump the package version: `npm version`. */
  version(configure?: Configure<NpmVersionSettings>): Promise<CommandOutput>;
  /** Remove a published version: `npm unpublish`. */
  unpublish(
    configure?: Configure<NpmUnpublishSettings>,
  ): Promise<CommandOutput>;
  /** Warn installers off a version: `npm deprecate`. */
  deprecate(
    configure?: Configure<NpmDeprecateSettings>,
  ): Promise<CommandOutput>;
  /** Manage dist-tags: `npm dist-tag add|rm|ls`. */
  distTag(configure?: Configure<NpmDistTagSettings>): Promise<CommandOutput>;
  /** Read registry metadata: `npm view`. */
  view(configure?: Configure<NpmViewSettings>): Promise<CommandOutput>;
  /** Check the registry is reachable: `npm ping`. */
  ping(configure?: Configure<NpmPingSettings>): Promise<CommandOutput>;
  /** Print the authenticated user: `npm whoami`. */
  whoami(configure?: Configure<NpmWhoamiSettings>): Promise<CommandOutput>;
  /**
   * The authenticated user's name, or `undefined` when this machine is not
   * logged in — an answer a release target can act on, rather than the
   * non-zero exit npm reports.
   */
  whoamiName(
    configure?: Configure<NpmWhoamiSettings>,
  ): Promise<string | undefined>;
  /** Manage package access: `npm access`. */
  access(configure?: Configure<NpmAccessSettings>): Promise<CommandOutput>;
  /** Manage package maintainers: `npm owner add|rm|ls`. */
  owner(configure?: Configure<NpmOwnerSettings>): Promise<CommandOutput>;
  /** Manage registry tokens: `npm token list|create|revoke`. */
  token(configure?: Configure<NpmTokenSettings>): Promise<CommandOutput>;
  /** List the installed tree: `npm ls`. */
  ls(configure?: Configure<NpmLsSettings>): Promise<CommandOutput>;
  /** Report dependencies behind their latest: `npm outdated`. */
  outdated(configure?: Configure<NpmOutdatedSettings>): Promise<CommandOutput>;
  /**
   * The outdated dependencies as parsed {@link NpmOutdatedEntry} values. npm
   * exits non-zero *because* something is outdated, so this reads that as the
   * answer rather than as a failure; an empty array means everything is
   * current.
   */
  outdatedEntries(
    configure?: Configure<NpmOutdatedSettings>,
  ): Promise<NpmOutdatedEntry[]>;
  /** Audit dependencies for vulnerabilities: `npm audit`. */
  audit(configure?: Configure<NpmAuditSettings>): Promise<CommandOutput>;
  /**
   * The audit's vulnerability counts by severity, so a target decides for
   * itself what is worth failing on. npm's non-zero exit is the finding, not
   * an error.
   */
  auditSummary(
    configure?: Configure<NpmAuditSettings>,
  ): Promise<NpmAuditSummary>;
  /** Emit a software bill of materials: `npm sbom`. */
  sbom(configure?: Configure<NpmSbomSettings>): Promise<CommandOutput>;
  /** Create a package or run an initializer: `npm init`. */
  init(configure?: Configure<NpmInitSettings>): Promise<CommandOutput>;
  /** Read or write package.json fields: `npm pkg get|set|delete|fix`. */
  pkg(configure?: Configure<NpmPkgSettings>): Promise<CommandOutput>;
  /**
   * One `package.json` field as a string, or `undefined` when it is unset or
   * is not a scalar — how a build reads its own version without parsing the
   * manifest or guessing where it lives.
   */
  pkgGet(
    key: string,
    configure?: Configure<NpmPkgSettings>,
  ): Promise<string | undefined>;
  /** Read or write npm configuration: `npm config get|set|delete|list|fix`. */
  config(configure?: Configure<NpmConfigSettings>): Promise<CommandOutput>;
  /** Maintain the package cache: `npm cache add|clean|ls|verify`. */
  cache(configure?: Configure<NpmCacheSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `npm` CLI. */
export const NpmTasks: NpmTasksApi = {
  install: (c) => runSettings(new NpmInstallSettings(), c),
  ci: (c) => runSettings(new NpmCiSettings(), c),
  uninstall: (c) => runSettings(new NpmUninstallSettings(), c),
  update: (c) => runSettings(new NpmUpdateSettings(), c),
  dedupe: (c) => runSettings(new NpmDedupeSettings(), c),
  prune: (c) => runSettings(new NpmPruneSettings(), c),
  rebuild: (c) => runSettings(new NpmRebuildSettings(), c),
  link: (c) => runSettings(new NpmLinkSettings(), c),
  run: (c) => runSettings(new NpmRunSettings(), c),
  test: (c) => runSettings(new NpmTestSettings(), c),
  exec: (c) => runSettings(new NpmExecSettings(), c),
  publish: (c) => runSettings(new NpmPublishSettings(), c),
  pack: (c) => runSettings(new NpmPackSettings(), c),
  version: (c) => runSettings(new NpmVersionSettings(), c),
  unpublish: (c) => runSettings(new NpmUnpublishSettings(), c),
  deprecate: (c) => runSettings(new NpmDeprecateSettings(), c),
  distTag: (c) => runSettings(new NpmDistTagSettings(), c),
  view: (c) => runSettings(new NpmViewSettings(), c),
  ping: (c) => runSettings(new NpmPingSettings(), c),
  whoami: (c) => runSettings(new NpmWhoamiSettings(), c),
  whoamiName: (c) => readWhoami(c),
  access: (c) => runSettings(new NpmAccessSettings(), c),
  owner: (c) => runSettings(new NpmOwnerSettings(), c),
  token: (c) => runSettings(new NpmTokenSettings(), c),
  ls: (c) => runSettings(new NpmLsSettings(), c),
  outdated: (c) => runSettings(new NpmOutdatedSettings(), c),
  outdatedEntries: (c) => readOutdated(c),
  audit: (c) => runSettings(new NpmAuditSettings(), c),
  auditSummary: (c) => readAuditSummary(c),
  sbom: (c) => runSettings(new NpmSbomSettings(), c),
  init: (c) => runSettings(new NpmInitSettings(), c),
  pkg: (c) => runSettings(new NpmPkgSettings(), c),
  pkgGet: (key, c) => readPkgField(key, c),
  config: (c) => runSettings(new NpmConfigSettings(), c),
  cache: (c) => runSettings(new NpmCacheSettings(), c),
};

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The commands that change what is installed under `node_modules`:
 * `npm install`, `ci`, `uninstall`, `update`, `dedupe`, `prune`, `rebuild`,
 * and `link`.
 *
 * ```ts
 * import { NpmTasks } from "jsr:@zuke/npm";
 * await NpmTasks.ci((s) => s.omit("dev"));
 * await NpmTasks.update((s) => s.packages("typescript"));
 * await NpmTasks.prune((s) => s.omit("dev")); // drop devDependencies before packaging
 * ```
 *
 * @module
 */

import {
  type NpmIncludeType,
  type NpmOmitType,
  NpmWorkspaceSettings,
} from "./settings.ts";
import { dependencyGroupArgs } from "./flags.ts";

/**
 * Shared base for the install-shaped commands: the `--omit`/`--include`
 * dependency-group selectors npm accepts on all of them, plus the package
 * specs most of them take.
 */
export abstract class NpmDependencySettings extends NpmWorkspaceSettings {
  #packages: string[] = [];
  #omit: NpmOmitType[] = [];
  #include: NpmIncludeType[] = [];
  #ignoreScripts = false;
  #foregroundScripts = false;

  /** Package specs the command operates on (positional); repeatable. */
  packages(...specs: string[]): this {
    this.#packages.push(...specs);
    return this;
  }

  /** Skip a dependency group (`--omit=<group>`); repeatable. */
  omit(...types: NpmOmitType[]): this {
    this.#omit.push(...types);
    return this;
  }

  /** Keep a dependency group npm would otherwise omit (`--include=<group>`); repeatable. */
  include(...types: NpmIncludeType[]): this {
    this.#include.push(...types);
    return this;
  }

  /** Do not run lifecycle scripts (`--ignore-scripts`). */
  ignoreScripts(): this {
    this.#ignoreScripts = true;
    return this;
  }

  /** Show lifecycle-script output as it runs (`--foreground-scripts`). */
  foregroundScripts(): this {
    this.#foregroundScripts = true;
    return this;
  }

  /** The package specs given, for the subclasses that must require them. */
  protected get packageSpecs(): readonly string[] {
    return this.#packages;
  }

  /** The dependency-group and lifecycle-script flags these commands share. */
  protected dependencyArgs(): string[] {
    const argv = dependencyGroupArgs(this.#omit, this.#include);
    if (this.#ignoreScripts) argv.push("--ignore-scripts");
    if (this.#foregroundScripts) argv.push("--foreground-scripts");
    return argv;
  }
}

/** Settings for `npm install`. */
export class NpmInstallSettings extends NpmDependencySettings {
  #saveDev = false;
  #saveExact = false;
  #saveOptional = false;
  #savePeer = false;
  #noSave = false;
  #installStrategy?: string;
  #noAudit = false;
  #noFund = false;

  /** Save to devDependencies (`--save-dev`). */
  saveDev(): this {
    this.#saveDev = true;
    return this;
  }

  /** Save to optionalDependencies (`--save-optional`). */
  saveOptional(): this {
    this.#saveOptional = true;
    return this;
  }

  /** Save to peerDependencies (`--save-peer`). */
  savePeer(): this {
    this.#savePeer = true;
    return this;
  }

  /** Pin exact versions (`--save-exact`). */
  saveExact(): this {
    this.#saveExact = true;
    return this;
  }

  /** Install without recording the dependency (`--no-save`). */
  noSave(): this {
    this.#noSave = true;
    return this;
  }

  /** How npm lays out the tree (`--install-strategy=<strategy>`). */
  installStrategy(
    strategy: "hoisted" | "nested" | "shallow" | "linked",
  ): this {
    this.#installStrategy = strategy;
    return this;
  }

  /** Skip the audit npm runs after installing (`--no-audit`). */
  noAudit(): this {
    this.#noAudit = true;
    return this;
  }

  /** Skip the funding message (`--no-fund`). */
  noFund(): this {
    this.#noFund = true;
    return this;
  }

  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "install";

  /** Assemble the `npm install` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["install"];
    if (this.#saveDev) argv.push("--save-dev");
    if (this.#saveOptional) argv.push("--save-optional");
    if (this.#savePeer) argv.push("--save-peer");
    if (this.#saveExact) argv.push("--save-exact");
    if (this.#noSave) argv.push("--no-save");
    if (this.#installStrategy !== undefined) {
      argv.push(`--install-strategy=${this.#installStrategy}`);
    }
    if (this.#noAudit) argv.push("--no-audit");
    if (this.#noFund) argv.push("--no-fund");
    argv.push(...this.dependencyArgs(), ...this.workspaceArgs());
    argv.push(...this.packageSpecs);
    return argv;
  }
}

/** Settings for `npm ci`. */
export class NpmCiSettings extends NpmDependencySettings {
  #noAudit = false;
  #noFund = false;

  /** Skip the audit npm runs after installing (`--no-audit`). */
  noAudit(): this {
    this.#noAudit = true;
    return this;
  }

  /** Skip the funding message (`--no-fund`). */
  noFund(): this {
    this.#noFund = true;
    return this;
  }

  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "ci";

  /** Assemble the `npm ci` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["ci"];
    argv.push(...this.dependencyArgs());
    if (this.#noAudit) argv.push("--no-audit");
    if (this.#noFund) argv.push("--no-fund");
    argv.push(...this.workspaceArgs());
    return argv;
  }
}

/** Settings for `npm uninstall`. */
export class NpmUninstallSettings extends NpmDependencySettings {
  #noSave = false;

  /** Remove the package without updating `package.json` (`--no-save`). */
  noSave(): this {
    this.#noSave = true;
    return this;
  }

  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "uninstall";

  /** Assemble the `npm uninstall` argv. */
  protected override subcommandArgs(): string[] {
    if (this.packageSpecs.length === 0) {
      throw new Error(
        "NpmTasks.uninstall: .packages(...) is required — it names what to " +
          "remove.",
      );
    }
    const argv = ["uninstall"];
    if (this.#noSave) argv.push("--no-save");
    argv.push(...this.workspaceArgs(), ...this.packageSpecs);
    return argv;
  }
}

/** Settings for `npm update`. */
export class NpmUpdateSettings extends NpmDependencySettings {
  #save = false;

  /** Write the updated ranges back to `package.json` (`--save`). */
  save(): this {
    this.#save = true;
    return this;
  }

  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "update";

  /** Assemble the `npm update` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["update"];
    if (this.#save) argv.push("--save");
    argv.push(...this.dependencyArgs(), ...this.workspaceArgs());
    argv.push(...this.packageSpecs);
    return argv;
  }
}

/** Settings for `npm dedupe`. */
export class NpmDedupeSettings extends NpmDependencySettings {
  #dryRun = false;

  /** Report what would move without changing the tree (`--dry-run`). */
  dryRun(): this {
    this.#dryRun = true;
    return this;
  }

  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "dedupe";

  /** Assemble the `npm dedupe` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["dedupe"];
    if (this.#dryRun) argv.push("--dry-run");
    argv.push(...this.dependencyArgs(), ...this.workspaceArgs());
    return argv;
  }
}

/** Settings for `npm prune`. */
export class NpmPruneSettings extends NpmDependencySettings {
  #dryRun = false;

  /** Report what would be removed without removing it (`--dry-run`). */
  dryRun(): this {
    this.#dryRun = true;
    return this;
  }

  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "prune";

  /** Assemble the `npm prune` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["prune"];
    if (this.#dryRun) argv.push("--dry-run");
    argv.push(...this.dependencyArgs(), ...this.workspaceArgs());
    argv.push(...this.packageSpecs);
    return argv;
  }
}

/** Settings for `npm rebuild`. */
export class NpmRebuildSettings extends NpmDependencySettings {
  #noBinLinks = false;

  /** Do not create the `.bin` symlinks (`--no-bin-links`). */
  noBinLinks(): this {
    this.#noBinLinks = true;
    return this;
  }

  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "rebuild";

  /** Assemble the `npm rebuild` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["rebuild"];
    if (this.#noBinLinks) argv.push("--no-bin-links");
    argv.push(...this.dependencyArgs(), ...this.workspaceArgs());
    argv.push(...this.packageSpecs);
    return argv;
  }
}

/** Settings for `npm link`. */
export class NpmLinkSettings extends NpmDependencySettings {
  #saveDev = false;

  /** Record the linked package in devDependencies (`--save-dev`). */
  saveDev(): this {
    this.#saveDev = true;
    return this;
  }

  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "link";

  /** Assemble the `npm link` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["link"];
    if (this.#saveDev) argv.push("--save-dev");
    argv.push(...this.dependencyArgs(), ...this.workspaceArgs());
    argv.push(...this.packageSpecs);
    return argv;
  }
}

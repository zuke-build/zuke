// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The typed `brew` subcommands that act on formulae and taps: `install`,
 * `uninstall`, `test`, `audit`, `style`, `livecheck`, `tap`, `untap`,
 * `tap-new` and `--repository`. Each setter is named after the flag it
 * renders, so the settings read like brew's own manual.
 *
 * @module
 */

import { BrewCommandSettings } from "./brew_settings.ts";

/** Push `flag` onto `argv` when `on` is set. */
function flagIf(argv: string[], on: boolean, flag: string): void {
  if (on) argv.push(flag);
}

/** Refuse a run with no operand, for a subcommand that needs at least one. */
function requireOperand(
  operands: readonly string[],
  verb: string,
  setter: string,
): void {
  if (operands.length === 0) {
    throw new Error(`brew ${verb} requires .${setter}(...).`);
  }
}

/**
 * Settings for `brew install`. A formula is named by its name, its
 * `user/tap/name`, or — where Homebrew still allows it — a local `.rb` path.
 */
export class BrewInstallSettings extends BrewCommandSettings {
  #formula = false;
  #buildFromSource = false;
  #force = false;
  #verbose = false;

  /** Formulae to install (required); repeatable. */
  formulae(...names: string[]): this {
    this.addOperands(names);
    return this;
  }

  /** Treat every name as a formula, not a cask (`--formula`). */
  formula(): this {
    this.#formula = true;
    return this;
  }

  /** Compile from source even when a bottle exists (`--build-from-source`). */
  buildFromSource(): this {
    this.#buildFromSource = true;
    return this;
  }

  /** Install without checking for keg-only or unmigrated versions (`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Print the verification and post-install steps (`--verbose`). */
  verbose(): this {
    this.#verbose = true;
    return this;
  }

  /** The subcommand: `install`. */
  protected verb(): string {
    return "install";
  }

  /** The flags set, in brew's manual order. */
  protected commandFlags(): string[] {
    requireOperand(this.operands, "install", "formulae");
    const argv: string[] = [];
    flagIf(argv, this.#formula, "--formula");
    flagIf(argv, this.#buildFromSource, "--build-from-source");
    flagIf(argv, this.#force, "--force");
    flagIf(argv, this.#verbose, "--verbose");
    return argv;
  }
}

/** Settings for `brew uninstall`. */
export class BrewUninstallSettings extends BrewCommandSettings {
  #formula = false;
  #force = false;
  #ignoreDependencies = false;

  /** Formulae to uninstall (required); repeatable. */
  formulae(...names: string[]): this {
    this.addOperands(names);
    return this;
  }

  /** Treat every name as a formula, not a cask (`--formula`). */
  formula(): this {
    this.#formula = true;
    return this;
  }

  /** Delete every installed version (`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Uninstall even when another formula depends on it (`--ignore-dependencies`). */
  ignoreDependencies(): this {
    this.#ignoreDependencies = true;
    return this;
  }

  /** The subcommand: `uninstall`. */
  protected verb(): string {
    return "uninstall";
  }

  /** The flags set, in brew's manual order. */
  protected commandFlags(): string[] {
    requireOperand(this.operands, "uninstall", "formulae");
    const argv: string[] = [];
    flagIf(argv, this.#formula, "--formula");
    flagIf(argv, this.#force, "--force");
    flagIf(argv, this.#ignoreDependencies, "--ignore-dependencies");
    return argv;
  }
}

/** Settings for `brew test`, which runs a formula's `test do` block. */
export class BrewTestSettings extends BrewCommandSettings {
  #force = false;
  #keepTmp = false;
  #retry = false;

  /** Installed formulae to test (required); repeatable. */
  formulae(...names: string[]): this {
    this.addOperands(names);
    return this;
  }

  /** Test even when the formula is unlinked (`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Keep the temporary files the test created (`--keep-tmp`). */
  keepTmp(): this {
    this.#keepTmp = true;
    return this;
  }

  /** Retry once if the test fails (`--retry`). */
  retry(): this {
    this.#retry = true;
    return this;
  }

  /** The subcommand: `test`. */
  protected verb(): string {
    return "test";
  }

  /** The flags set, in brew's manual order. */
  protected commandFlags(): string[] {
    requireOperand(this.operands, "test", "formulae");
    const argv: string[] = [];
    flagIf(argv, this.#force, "--force");
    flagIf(argv, this.#keepTmp, "--keep-tmp");
    flagIf(argv, this.#retry, "--retry");
    return argv;
  }
}

/**
 * Settings for `brew audit`. With no formulae named, brew audits every
 * formula it can find.
 */
export class BrewAuditSettings extends BrewCommandSettings {
  #strict = false;
  #online = false;
  #new = false;
  #formula = false;

  /** Formulae to audit; repeatable. */
  formulae(...names: string[]): this {
    this.addOperands(names);
    return this;
  }

  /** Run the additional, stricter checks (`--strict`). */
  strict(): this {
    this.#strict = true;
    return this;
  }

  /** Run the additional checks that need the network (`--online`). */
  online(): this {
    this.#online = true;
    return this;
  }

  /**
   * Run the checks for a formula new to Homebrew (`--new`), which imply
   * `--strict` and `--online`.
   */
  new(): this {
    this.#new = true;
    return this;
  }

  /** Treat every name as a formula, not a cask (`--formula`). */
  formula(): this {
    this.#formula = true;
    return this;
  }

  /** The subcommand: `audit`. */
  protected verb(): string {
    return "audit";
  }

  /** The flags set, in brew's manual order. */
  protected commandFlags(): string[] {
    const argv: string[] = [];
    flagIf(argv, this.#strict, "--strict");
    flagIf(argv, this.#online, "--online");
    flagIf(argv, this.#new, "--new");
    flagIf(argv, this.#formula, "--formula");
    return argv;
  }
}

/**
 * Settings for `brew style`, Homebrew's RuboCop check. With nothing named it
 * checks Homebrew's own code and every tap.
 */
export class BrewStyleSettings extends BrewCommandSettings {
  #fix = false;

  /** Files, taps or formulae to check; repeatable. */
  targets(...values: string[]): this {
    this.addOperands(values);
    return this;
  }

  /** Correct what RuboCop can correct (`--fix`). */
  fix(): this {
    this.#fix = true;
    return this;
  }

  /** The subcommand: `style`. */
  protected verb(): string {
    return "style";
  }

  /** The flags set. */
  protected commandFlags(): string[] {
    return this.#fix ? ["--fix"] : [];
  }
}

/** Settings for `brew livecheck`, which looks for a newer upstream version. */
export class BrewLivecheckSettings extends BrewCommandSettings {
  #json = false;
  #newerOnly = false;
  #formula = false;

  /** Formulae to check; repeatable. */
  formulae(...names: string[]): this {
    this.addOperands(names);
    return this;
  }

  /** Print the result as JSON (`--json`). */
  json(): this {
    this.#json = true;
    return this;
  }

  /** Report only versions newer than the installed one (`--newer-only`). */
  newerOnly(): this {
    this.#newerOnly = true;
    return this;
  }

  /** Check only formulae, not casks (`--formula`). */
  formula(): this {
    this.#formula = true;
    return this;
  }

  /** The subcommand: `livecheck`. */
  protected verb(): string {
    return "livecheck";
  }

  /** The flags set, in brew's manual order. */
  protected commandFlags(): string[] {
    const argv: string[] = [];
    flagIf(argv, this.#json, "--json");
    flagIf(argv, this.#newerOnly, "--newer-only");
    flagIf(argv, this.#formula, "--formula");
    return argv;
  }
}

/** Settings for `brew tap`, which adds a formula repository. */
export class BrewTapSettings extends BrewCommandSettings {
  #force = false;

  /**
   * The tap to add (required), `user/repo` — brew clones
   * `github.com/user/homebrew-repo` — and optionally the URL to clone it from
   * instead.
   */
  name(tap: string, url?: string): this {
    this.addOperands(url === undefined ? [tap] : [tap, url]);
    return this;
  }

  /** Tap a core tap even under API mode (`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** The subcommand: `tap`. */
  protected verb(): string {
    return "tap";
  }

  /** The flags set. */
  protected commandFlags(): string[] {
    requireOperand(this.operands, "tap", "name");
    return this.#force ? ["--force"] : [];
  }
}

/** Settings for `brew untap`, which removes taps. */
export class BrewUntapSettings extends BrewCommandSettings {
  #force = false;

  /** Taps to remove (required), `user/repo`; repeatable. */
  taps(...names: string[]): this {
    this.addOperands(names);
    return this;
  }

  /** Uninstall the tap's formulae first, rather than refusing (`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** The subcommand: `untap`. */
  protected verb(): string {
    return "untap";
  }

  /** The flags set. */
  protected commandFlags(): string[] {
    requireOperand(this.operands, "untap", "taps");
    return this.#force ? ["--force"] : [];
  }
}

/** Settings for `brew tap-new`, which generates a new, local tap. */
export class BrewTapNewSettings extends BrewCommandSettings {
  #noGit = false;
  #branch?: string;

  /** The tap to create (required), `user/repo`. */
  name(tap: string): this {
    this.addOperands([tap]);
    return this;
  }

  /** Do not initialise a git repository for it (`--no-git`). */
  noGit(): this {
    this.#noGit = true;
    return this;
  }

  /** Initialise git on this branch, with its CI workflows (`--branch=`). */
  branch(name: string): this {
    this.#branch = name;
    return this;
  }

  /** The subcommand: `tap-new`. */
  protected verb(): string {
    return "tap-new";
  }

  /** The flags set. */
  protected commandFlags(): string[] {
    requireOperand(this.operands, "tap-new", "name");
    const argv: string[] = [];
    flagIf(argv, this.#noGit, "--no-git");
    if (this.#branch !== undefined) argv.push(`--branch=${this.#branch}`);
    return argv;
  }
}

/**
 * Settings for `brew --repository`, which prints where Homebrew's repository
 * is — or, given a tap, where that tap's directory is.
 */
export class BrewRepositorySettings extends BrewCommandSettings {
  /** The tap whose directory to print, `user/repo`. */
  tap(name: string): this {
    this.addOperands([name]);
    return this;
  }

  /** The "subcommand": brew spells this one as a flag, `--repository`. */
  protected verb(): string {
    return "--repository";
  }

  /** It takes no flags of its own. */
  protected commandFlags(): string[] {
    return [];
  }
}

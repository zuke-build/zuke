// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for the `deno` subcommands that inspect sources without running
 * them: `check`, `fmt`, `lint` and `doc`.
 */

import type { PathLike } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";
import { reportSummary } from "@zuke/core";
import { DenoSettings } from "./settings.ts";
import {
  parseDenoCheckSummary,
  parseDenoFmtSummary,
  parseDenoLintSummary,
} from "./quality_summary.ts";
import {
  ConfigFlags,
  DependencyFlags,
  FileSelectionFlags,
  type NodeModulesLinker,
  type NodeModulesMode,
  WatchFlags,
} from "./flags.ts";

/** How `deno fmt` wraps prose in Markdown (`--prose-wrap`). */
export type DenoProseWrap = "always" | "never" | "preserve";

/** Settings for `deno check`. */
export class DenoCheckSettings extends DenoSettings {
  #paths: string[] = [];
  #all = false;
  #noRemote = false;
  #doc = false;
  #docOnly = false;
  #checkJs = false;
  #config = new ConfigFlags();
  #deps = new DependencyFlags();
  #watch = new WatchFlags();

  /** The files to type-check (at least one is required). */
  paths(...paths: PathLike[]): this {
    this.#paths.push(...paths.map(String));
    return this;
  }

  /**
   * Type-check remote modules and npm packages too (`--all`), not just the
   * local code. Slower, and the only way to catch a dependency whose published
   * types do not actually compile.
   */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Type-check the code blocks in JSDoc and Markdown as well (`--doc`). */
  doc(): this {
    this.#doc = true;
    return this;
  }

  /** Type-check *only* the code blocks in JSDoc and Markdown (`--doc-only`). */
  docOnly(): this {
    this.#docOnly = true;
    return this;
  }

  /** Type-check JavaScript files too (`--check-js`). */
  checkJs(): this {
    this.#checkJs = true;
    return this;
  }

  /**
   * Type-check against a specific configuration file (`--config`) instead of the
   * one Deno would discover by walking up from the checked files.
   *
   * The discovered config decides how bare specifiers resolve, so pointing at
   * another one type-checks the same sources against a different dependency
   * set — for example checking a workspace member against the *published*
   * version of a sibling it declares, rather than the local member that
   * workspace resolution would substitute.
   */
  config(path: PathLike): this {
    this.#config.config(path);
    return this;
  }

  /** Discover no configuration file at all (`--no-config`). */
  noConfig(): this {
    this.#config.noConfig();
    return this;
  }

  /**
   * Ignore the lockfile entirely (`--no-lock`), neither reading nor writing it.
   *
   * Use it for a check whose resolutions are deliberately not the project's:
   * writing them into the committed lock would corrupt it, and reading it would
   * pin the very versions the check is trying to vary.
   */
  noLock(): this {
    this.#deps.noLock();
    return this;
  }

  /**
   * Error out if the lockfile is out of date (`--frozen`). See
   * {@link DenoPermissionSettings.frozen} for why the name mirrors the real
   * Deno flag rather than `PnpmSettings.frozenLockfile()`'s naming.
   */
  frozen(): this {
    this.#deps.frozen();
    return this;
  }

  /** Use an explicit lockfile (`--lock`) instead of the discovered `deno.lock`. */
  lock(path: PathLike): this {
    this.#deps.lock(path);
    return this;
  }

  /** Load an import map from a file or URL (`--import-map`). */
  importMap(path: PathLike): this {
    this.#deps.importMap(path);
    return this;
  }

  /** Do not resolve npm modules (`--no-npm`). */
  noNpm(): this {
    this.#deps.noNpm();
    return this;
  }

  /** Do not resolve remote modules (`--no-remote`). */
  noRemote(): this {
    this.#noRemote = true;
    this.#deps.noRemote();
    return this;
  }

  /** Reload the module cache (`--reload`), optionally only these specifiers. */
  reload(...specifiers: string[]): this {
    this.#deps.reload(specifiers);
    return this;
  }

  /** Set the node-modules management mode (`--node-modules-dir`). */
  nodeModulesDir(mode: NodeModulesMode): this {
    this.#deps.nodeModulesDir(mode);
    return this;
  }

  /** Set the npm linker mode (`--node-modules-linker`). */
  nodeModulesLinker(mode: NodeModulesLinker): this {
    this.#deps.nodeModulesLinker(mode);
    return this;
  }

  /** Toggle the local vendor folder (`--vendor`). */
  vendor(enabled = true): this {
    this.#deps.vendor(enabled);
    return this;
  }

  /** Re-check when a watched file changes (`--watch`). */
  watch(): this {
    this.#watch.watch();
    return this;
  }

  /** Exclude paths from the watcher (`--watch-exclude`). */
  watchExclude(...paths: PathLike[]): this {
    this.#watch.exclude(paths.map(String));
    return this;
  }

  /** Keep previous output when re-running under `--watch` (`--no-clear-screen`). */
  noClearScreen(): this {
    this.#watch.noClearScreen();
    return this;
  }

  /** Report `Errors`, the diagnostics printed, onto the build summary. */
  protected override onOutput(output: CommandOutput): void {
    const pairs = parseDenoCheckSummary(output);
    if (pairs !== undefined) reportSummary(pairs);
  }

  /** Assemble the `deno check` argv. */
  protected override buildArgs(): string[] {
    if (this.#paths.length === 0) {
      throw new Error(
        "DenoTasks.check: at least one path is required (use .paths()).",
      );
    }
    if (this.#config.contradictory) {
      throw new Error(
        "DenoTasks.check: .config() names a configuration file and " +
          ".noConfig() discards it — pick one.",
      );
    }
    if (this.#all && this.#noRemote) {
      throw new Error(
        "DenoTasks.check: .all() type-checks the remote modules too and " +
          ".noRemote() refuses to resolve them — deno rejects the pair; " +
          "pick one.",
      );
    }
    if (this.#doc && this.#docOnly) {
      throw new Error(
        "DenoTasks.check: .doc() checks the sources and their documentation, " +
          ".docOnly() checks only the documentation — pick one.",
      );
    }
    const argv = ["check", ...this.#config.render(), ...this.#deps.render()];
    if (this.#all) argv.push("--all");
    if (this.#doc) argv.push("--doc");
    if (this.#docOnly) argv.push("--doc-only");
    if (this.#checkJs) argv.push("--check-js");
    argv.push(...this.#watch.render(), ...this.#paths);
    return argv;
  }
}

/** Settings for `deno fmt`. */
export class DenoFmtSettings extends DenoSettings {
  #check = false;
  #failFast = false;
  #lineWidth?: number;
  #indentWidth?: number;
  #useTabs?: boolean;
  #singleQuote?: boolean;
  #noSemicolons?: boolean;
  #proseWrap?: DenoProseWrap;
  #unstableComponent = false;
  #unstableSql = false;
  #paths: string[] = [];
  #files = new FileSelectionFlags();
  #config = new ConfigFlags();
  #watch = new WatchFlags();

  /** Verify formatting without writing changes (`--check`). */
  check(): this {
    this.#check = true;
    return this;
  }

  /** Stop at the first badly formatted file (`--fail-fast`). */
  failFast(): this {
    this.#failFast = true;
    return this;
  }

  /** Maximum line width (`--line-width`), 80 by default. */
  lineWidth(columns: number): this {
    this.#lineWidth = columns;
    return this;
  }

  /** Indentation width (`--indent-width`), 2 by default. */
  indentWidth(columns: number): this {
    this.#indentWidth = columns;
    return this;
  }

  /** Indent with tabs rather than spaces (`--use-tabs`). */
  useTabs(enabled = true): this {
    this.#useTabs = enabled;
    return this;
  }

  /** Quote strings with single quotes (`--single-quote`). */
  singleQuote(enabled = true): this {
    this.#singleQuote = enabled;
    return this;
  }

  /** Omit semicolons except where they are required (`--no-semicolons`). */
  noSemicolons(enabled = true): this {
    this.#noSemicolons = enabled;
    return this;
  }

  /** How to wrap prose in Markdown (`--prose-wrap`). */
  proseWrap(mode: DenoProseWrap): this {
    this.#proseWrap = mode;
    return this;
  }

  /** Format Svelte, Vue, Astro and Angular files (`--unstable-component`). */
  unstableComponent(): this {
    this.#unstableComponent = true;
    return this;
  }

  /** Format SQL files (`--unstable-sql`). */
  unstableSql(): this {
    this.#unstableSql = true;
    return this;
  }

  /**
   * Treat the inputs as this content type (`--ext`). `deno fmt` accepts far
   * more than the script extensions — Markdown, JSON, CSS, HTML, YAML and the
   * component formats among them — so this takes a string rather than the
   * narrower script-only union the runtime subcommands use.
   */
  ext(value: string): this {
    this.#files.ext(value);
    return this;
  }

  /** Skip files matching these patterns (`--ignore`). */
  ignore(...patterns: string[]): this {
    this.#files.ignore(patterns);
    return this;
  }

  /** Succeed when no files matched (`--permit-no-files`). */
  permitNoFiles(): this {
    this.#files.permitNoFiles();
    return this;
  }

  /** Use an explicit config file (`--config`). */
  config(path: PathLike): this {
    this.#config.config(path);
    return this;
  }

  /** Discover no configuration file at all (`--no-config`). */
  noConfig(): this {
    this.#config.noConfig();
    return this;
  }

  /** Re-format when a watched file changes (`--watch`). */
  watch(): this {
    this.#watch.watch();
    return this;
  }

  /** Exclude paths from the watcher (`--watch-exclude`). */
  watchExclude(...paths: PathLike[]): this {
    this.#watch.exclude(paths.map(String));
    return this;
  }

  /** Keep previous output when re-running under `--watch` (`--no-clear-screen`). */
  noClearScreen(): this {
    this.#watch.noClearScreen();
    return this;
  }

  /** Restrict formatting to specific files or directories. */
  paths(...paths: PathLike[]): this {
    this.#paths.push(...paths.map(String));
    return this;
  }

  /** Report `Files` (and `Unformatted` under `--check`) onto the build summary. */
  protected override onOutput(output: CommandOutput): void {
    const pairs = parseDenoFmtSummary(output);
    if (pairs !== undefined) reportSummary(pairs);
  }

  /** Assemble the `deno fmt` argv. */
  protected override buildArgs(): string[] {
    if (this.#config.contradictory) {
      throw new Error(
        "DenoTasks.fmt: .config() names a configuration file and " +
          ".noConfig() discards it — pick one.",
      );
    }
    const argv = ["fmt", ...this.#config.render()];
    if (this.#check) argv.push("--check");
    if (this.#failFast) argv.push("--fail-fast");
    if (this.#lineWidth !== undefined) {
      argv.push("--line-width", String(this.#lineWidth));
    }
    if (this.#indentWidth !== undefined) {
      argv.push("--indent-width", String(this.#indentWidth));
    }
    if (this.#useTabs !== undefined) argv.push(`--use-tabs=${this.#useTabs}`);
    if (this.#singleQuote !== undefined) {
      argv.push(`--single-quote=${this.#singleQuote}`);
    }
    if (this.#noSemicolons !== undefined) {
      argv.push(`--no-semicolons=${this.#noSemicolons}`);
    }
    if (this.#proseWrap !== undefined) {
      argv.push("--prose-wrap", this.#proseWrap);
    }
    if (this.#unstableComponent) argv.push("--unstable-component");
    if (this.#unstableSql) argv.push("--unstable-sql");
    argv.push(...this.#files.render(), ...this.#watch.render(), ...this.#paths);
    return argv;
  }
}

/** Settings for `deno lint`. */
export class DenoLintSettings extends DenoSettings {
  #fix = false;
  #listRules = false;
  #format?: "--json" | "--compact";
  #rulesTags: string[] = [];
  #rulesInclude: string[] = [];
  #rulesExclude: string[] = [];
  #paths: string[] = [];
  #files = new FileSelectionFlags();
  #config = new ConfigFlags();
  #watch = new WatchFlags();

  /** Apply automatic fixes (`--fix`). */
  fix(): this {
    this.#fix = true;
    return this;
  }

  /**
   * List the available rules and exit (`--rules`) rather than linting. Pair it
   * with {@link json} to get the catalogue in machine-readable form.
   */
  listRules(): this {
    this.#listRules = true;
    return this;
  }

  /** Report diagnostics as JSON (`--json`). */
  json(): this {
    return this.#setFormat("--json");
  }

  /** Report diagnostics one per line (`--compact`). */
  compact(): this {
    return this.#setFormat("--compact");
  }

  /** Enable the rule sets carrying these tags (`--rules-tags`). */
  rulesTags(...tags: string[]): this {
    this.#rulesTags.push(...tags);
    return this;
  }

  /** Enable these rules on top of the configured set (`--rules-include`). */
  rulesInclude(...rules: string[]): this {
    this.#rulesInclude.push(...rules);
    return this;
  }

  /** Disable these rules (`--rules-exclude`). */
  rulesExclude(...rules: string[]): this {
    this.#rulesExclude.push(...rules);
    return this;
  }

  /** Treat the inputs as this content type (`--ext`). */
  ext(value: string): this {
    this.#files.ext(value);
    return this;
  }

  /** Skip files matching these patterns (`--ignore`). */
  ignore(...patterns: string[]): this {
    this.#files.ignore(patterns);
    return this;
  }

  /** Succeed when no files matched (`--permit-no-files`). */
  permitNoFiles(): this {
    this.#files.permitNoFiles();
    return this;
  }

  /** Use an explicit config file (`--config`). */
  config(path: PathLike): this {
    this.#config.config(path);
    return this;
  }

  /** Discover no configuration file at all (`--no-config`). */
  noConfig(): this {
    this.#config.noConfig();
    return this;
  }

  /** Re-lint when a watched file changes (`--watch`). */
  watch(): this {
    this.#watch.watch();
    return this;
  }

  /** Exclude paths from the watcher (`--watch-exclude`). */
  watchExclude(...paths: PathLike[]): this {
    this.#watch.exclude(paths.map(String));
    return this;
  }

  /** Keep previous output when re-running under `--watch` (`--no-clear-screen`). */
  noClearScreen(): this {
    this.#watch.noClearScreen();
    return this;
  }

  /** Restrict linting to specific files or directories. */
  paths(...paths: PathLike[]): this {
    this.#paths.push(...paths.map(String));
    return this;
  }

  #setFormat(format: "--json" | "--compact"): this {
    if (this.#format !== undefined && this.#format !== format) {
      throw new Error(
        "DenoTasks.lint: --json and --compact are two report formats and " +
          "deno accepts only one — pick the one you will parse.",
      );
    }
    this.#format = format;
    return this;
  }

  /** Report `Files` and `Problems` onto the build summary. */
  protected override onOutput(output: CommandOutput): void {
    const pairs = parseDenoLintSummary(output);
    if (pairs !== undefined) reportSummary(pairs);
  }

  /** Assemble the `deno lint` argv. */
  protected override buildArgs(): string[] {
    if (this.#config.contradictory) {
      throw new Error(
        "DenoTasks.lint: .config() names a configuration file and " +
          ".noConfig() discards it — pick one.",
      );
    }
    if (this.#fix && this.#listRules) {
      throw new Error(
        "DenoTasks.lint: deno accepts --rules with --fix and silently " +
          "ignores the fixing — .listRules() prints the rule catalogue and " +
          "lints nothing. Pick one, so a target that meant to fix does.",
      );
    }
    const argv = ["lint", ...this.#config.render()];
    if (this.#fix) argv.push("--fix");
    if (this.#listRules) argv.push("--rules");
    if (this.#format !== undefined) argv.push(this.#format);
    if (this.#rulesTags.length > 0) {
      argv.push(`--rules-tags=${this.#rulesTags.join(",")}`);
    }
    if (this.#rulesInclude.length > 0) {
      argv.push(`--rules-include=${this.#rulesInclude.join(",")}`);
    }
    if (this.#rulesExclude.length > 0) {
      argv.push(`--rules-exclude=${this.#rulesExclude.join(",")}`);
    }
    argv.push(...this.#files.render(), ...this.#watch.render(), ...this.#paths);
    return argv;
  }
}

/** Settings for `deno doc`. */
export class DenoDocSettings extends DenoSettings {
  #paths: string[] = [];
  #json = false;
  #html = false;
  #lint = false;
  #private = false;
  #stripTrailingHtml = false;
  #name?: string;
  #output?: string;
  #filter?: string;
  #categoryDocs?: string;
  #symbolRedirectMap?: string;
  #defaultSymbolMap?: string;
  #deps = new DependencyFlags();

  /** The source files (entry points) to document. */
  paths(...paths: PathLike[]): this {
    this.#paths.push(...paths.map(String));
    return this;
  }

  /** Output the documentation as JSON (`--json`). */
  json(): this {
    this.#json = true;
    return this;
  }

  /** Generate static HTML documentation (`--html`). */
  html(): this {
    this.#html = true;
    return this;
  }

  /** Report documentation diagnostics rather than rendering docs (`--lint`). */
  lint(): this {
    this.#lint = true;
    return this;
  }

  /** Include private and internal symbols (`--private`). */
  private(): this {
    this.#private = true;
    return this;
  }

  /** Drop the trailing `.html` from generated links (`--strip-trailing-html`). */
  stripTrailingHtml(): this {
    this.#stripTrailingHtml = true;
    return this;
  }

  /** Title for the generated HTML documentation (`--name`). */
  name(title: string): this {
    this.#name = title;
    return this;
  }

  /** Output directory for HTML documentation (`--output`). */
  output(dir: PathLike): this {
    this.#output = String(dir);
    return this;
  }

  /** Document only the symbol at this dot-separated path (`--filter`). */
  filter(symbol: string): this {
    this.#filter = symbol;
    return this;
  }

  /** JSON file of per-category Markdown docs (`--category-docs`). */
  categoryDocs(path: PathLike): this {
    this.#categoryDocs = String(path);
    return this;
  }

  /** JSON file redirecting symbols to external links (`--symbol-redirect-map`). */
  symbolRedirectMap(path: PathLike): this {
    this.#symbolRedirectMap = String(path);
    return this;
  }

  /** Mapping of default export names to the names usage blocks show (`--default-symbol-map`). */
  defaultSymbolMap(path: PathLike): this {
    this.#defaultSymbolMap = String(path);
    return this;
  }

  /**
   * Error out if the lockfile is out of date (`--frozen`). See
   * {@link DenoPermissionSettings.frozen} for why the name mirrors the real
   * Deno flag rather than `PnpmSettings.frozenLockfile()`'s naming.
   */
  frozen(): this {
    this.#deps.frozen();
    return this;
  }

  /** Ignore the lockfile entirely (`--no-lock`). */
  noLock(): this {
    this.#deps.noLock();
    return this;
  }

  /** Use an explicit lockfile (`--lock`). */
  lock(path: PathLike): this {
    this.#deps.lock(path);
    return this;
  }

  /** Load an import map from a file or URL (`--import-map`). */
  importMap(path: PathLike): this {
    this.#deps.importMap(path);
    return this;
  }

  /** Do not resolve npm modules (`--no-npm`). */
  noNpm(): this {
    this.#deps.noNpm();
    return this;
  }

  /** Do not resolve remote modules (`--no-remote`). */
  noRemote(): this {
    this.#deps.noRemote();
    return this;
  }

  /** Reload the module cache (`--reload`), optionally only these specifiers. */
  reload(...specifiers: string[]): this {
    this.#deps.reload(specifiers);
    return this;
  }

  /** Assemble the `deno doc` argv. */
  protected override buildArgs(): string[] {
    if (this.#json && this.#html) {
      throw new Error(
        "DenoTasks.doc: --json and --html are two output formats and deno " +
          "accepts only one — pick the one you want.",
      );
    }
    const argv = ["doc", ...this.#deps.render()];
    if (this.#json) argv.push("--json");
    if (this.#html) argv.push("--html");
    if (this.#lint) argv.push("--lint");
    if (this.#private) argv.push("--private");
    if (this.#name !== undefined) argv.push("--name", this.#name);
    if (this.#output !== undefined) argv.push("--output", this.#output);
    if (this.#stripTrailingHtml) argv.push("--strip-trailing-html");
    if (this.#categoryDocs !== undefined) {
      argv.push(`--category-docs=${this.#categoryDocs}`);
    }
    if (this.#symbolRedirectMap !== undefined) {
      argv.push(`--symbol-redirect-map=${this.#symbolRedirectMap}`);
    }
    if (this.#defaultSymbolMap !== undefined) {
      argv.push(`--default-symbol-map=${this.#defaultSymbolMap}`);
    }
    if (this.#filter !== undefined) argv.push("--filter", this.#filter);
    argv.push(...this.#paths);
    return argv;
  }
}

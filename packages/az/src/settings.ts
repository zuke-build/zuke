// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link AzSettings} — the base every `az` command's settings extend: the
 * binary, the command-path builder, the Azure CLI's global options
 * (`--subscription`, `--output`, `--query`, …), and the runner seam.
 *
 * It lives apart from the commands so a command in its own module (see
 * `group.ts`) can extend it without importing the module that assembles
 * `AzTasks`, which would import it back.
 *
 * A command's settings class emits its whole invocation — the group, the
 * verb, and its own options — from `leadingTokens`, so the validation and the
 * argv it guards sit together. The global options follow from
 * `middleTokens`; the Azure CLI accepts them anywhere on the line.
 *
 * @module
 */

import { Command, CommandError, type CommandOutput } from "@zuke/core/shell";
import { defaultReadEnv } from "@zuke/core";
import { SubcommandSettings } from "@zuke/core/tooling";
import { option } from "./validate.ts";

/**
 * Runs one prepared `az` command and returns what the process produced. The
 * default spawns the CLI; a test, or a build that executes the CLI some other
 * way, injects its own with {@link AzSettings.runner}. The runner only
 * produces the output: the exit code is judged afterwards exactly as for a
 * spawned process, so a non-zero `code` still raises a `CommandError` unless
 * the settings say `.noThrow()`.
 */
export type AzSettingsRunner = (
  settings: AzSettings,
) => Promise<CommandOutput>;

/** The values the Azure CLI's `--output` option accepts. */
export type AzOutputFormat =
  | "json"
  | "jsonc"
  | "yaml"
  | "yamlc"
  | "table"
  | "tsv"
  | "none";

/**
 * The credentials in the environment that the CLI — or an extension — reads,
 * which `--debug` can print: the storage commands' account key, connection
 * string and SAS token (read through the CLI's `AZURE_STORAGE_*` config
 * variables), the service-principal secret one code path reads, and the
 * Azure DevOps extension's token. `ARM_CLIENT_SECRET` is Terraform's, not the
 * CLI's; it is registered because a runner that sets one usually sets both.
 */
const CREDENTIAL_VARIABLES = [
  "AZURE_CLIENT_SECRET",
  "AZURE_STORAGE_KEY",
  "AZURE_STORAGE_CONNECTION_STRING",
  "AZURE_STORAGE_SAS_TOKEN",
  "AZURE_DEVOPS_EXT_PAT",
  "ARM_CLIENT_SECRET",
];

/**
 * Throw core's `CommandError` for a failed exit, rendered through a
 * `Command` so the run's redactor masks the line exactly as it does for a
 * spawned command's failure. Internal: the runner path of
 * {@link AzSettings.run} and the readers, which insist on success whatever
 * `.noThrow()` said, share it.
 */
export function failOnExit(settings: AzSettings, output: CommandOutput) {
  if (output.code === 0) return;
  const line = new Command(settings.argv()).commandLine;
  throw new CommandError(line, output.code, output.stderr);
}

/**
 * Settings for an `az` invocation.
 *
 * Every instance sets three of the CLI's configuration variables in the
 * child's environment, so the CLI never waits on a keypress, installs code,
 * or colours a build log:
 *
 * - `AZURE_EXTENSION_USE_DYNAMIC_INSTALL=no` — a command from an extension
 *   that is not installed fails, instead of prompting (on a terminal) or
 *   silently downloading and installing the extension (without one). The
 *   CLI's message does not name the extension — it says the command `is
 *   misspelled or not recognized by the system` and exits 2 — so install what
 *   a build needs up front with `az extension add --name <name>`.
 * - `AZURE_CORE_LOGIN_EXPERIENCE_V2=off` — an interactive `az login` does not
 *   open its subscription selector.
 * - `AZURE_CORE_NO_COLOR=true` — no ANSI colour codes in captured output.
 *
 * Setting them there keeps the argv exactly what the settings say; override
 * any of them with `.env({...})`. A confirmation prompt (`group delete`
 * without `--yes`) is not switched off: on a terminal it asks, without one
 * the CLI fails — call the command's `.yes()` to confirm in the build.
 */
export class AzSettings extends SubcommandSettings {
  #subscription?: string;
  #output?: AzOutputFormat;
  #query?: string;
  #onlyShowErrors = false;
  #verbose = false;
  #debug = false;
  #runner?: AzSettingsRunner;
  /** The environment set through {@link env}, which `--debug` can print. */
  readonly #ownEnv: Record<string, string> = {};

  /** Settings with the CLI's prompts, extension installs and colour off. */
  constructor() {
    super();
    this.env({
      AZURE_EXTENSION_USE_DYNAMIC_INSTALL: "no",
      AZURE_CORE_LOGIN_EXPERIENCE_V2: "off",
      AZURE_CORE_NO_COLOR: "true",
    });
  }

  /** The default executable name (`az`). */
  protected override defaultTool(): string {
    return "az";
  }

  /**
   * The subscription to run against, by name or id (`--subscription`); the
   * CLI's default subscription when omitted. Most commands take it; the
   * `account` commands read it as the subscription they act on.
   */
  subscription(nameOrId: string): this {
    this.#subscription = nameOrId;
    return this;
  }

  /**
   * The output format (`--output`): `json`, `jsonc`, `yaml`, `yamlc`,
   * `table`, `tsv` or `none`.
   */
  output(format: AzOutputFormat): this {
    this.#output = format;
    return this;
  }

  /** A JMESPath expression that filters the output (`--query`). */
  query(expression: string): this {
    this.#query = expression;
    return this;
  }

  /**
   * Print errors only, suppressing warnings (`--only-show-errors`). The CLI
   * refuses it beside `--debug` or `--verbose`, and so do these settings.
   */
  onlyShowErrors(): this {
    this.#onlyShowErrors = true;
    return this;
  }

  /** More logging, on stderr (`--verbose`). */
  verbose(): this {
    this.#verbose = true;
    return this;
  }

  /**
   * Merge additional environment variables for the process. Under
   * {@link debug} — set before or after — a credential variable set here is
   * registered with the run's redactor, like one in the build's environment.
   */
  override env(record: Record<string, string>): this {
    super.env(record);
    Object.assign(this.#ownEnv, record);
    if (this.#debug) this.#markCredentials();
    return this;
  }

  /** Register every credential variable, from the settings or the process. */
  #markCredentials(): void {
    for (const name of CREDENTIAL_VARIABLES) {
      for (const value of [this.#ownEnv[name], defaultReadEnv(name)]) {
        if (value !== undefined && value !== "") this.markSecret(value);
      }
    }
  }

  /**
   * Turn on the CLI's debug logging (`--debug`), written to stderr.
   *
   * **The debug log can carry credentials**: request and response details,
   * which for a Key Vault or storage command include what was read or sent.
   * The credentials the CLI reads from the environment — `AZURE_STORAGE_KEY`,
   * `AZURE_STORAGE_CONNECTION_STRING`, `AZURE_STORAGE_SAS_TOKEN`,
   * `AZURE_CLIENT_SECRET`, `AZURE_DEVOPS_EXT_PAT`, and Terraform's
   * `ARM_CLIENT_SECRET` beside them — are registered with the run's redactor,
   * whether they are in the build's environment or set with {@link env}, but a token the CLI holds in its own cache
   * (`~/.azure`) is not known here and is not masked. Keep it for a local
   * investigation, never a shared CI log.
   */
  debug(): this {
    this.#debug = true;
    this.#markCredentials();
    return this;
  }

  /**
   * Add an arbitrary option: `--name value`, or the bare `--name`.
   *
   * Two hazards come with the escape hatch, which the typed setters guard and
   * this does not: a value that starts with `-` is read by the CLI as the next
   * option, and a value that starts with `@` — or, in a `key=value` list
   * element, a value after the `=` that does — is replaced by that file's
   * contents (`@-` by standard input), which then leave the machine in the
   * request. Never pass an untrusted value here, or through `.args(...)` or
   * `.command(...)`.
   */
  override flag(name: string, value?: string | number): this {
    return super.flag(name, value);
  }

  /**
   * The `--output` a command insists on, whatever the settings or the user's
   * config say; `undefined` leaves it to them. A credential-bearing command
   * pins `json`, which is the form its secrets can be found in.
   */
  protected pinnedOutput(): AzOutputFormat | undefined {
    return undefined;
  }

  /**
   * Whether a `--query` was set — by the caller, or pinned by a reader. A
   * credential-bearing command then registers every long scalar it printed,
   * since the query may have moved the secret away from its usual key.
   */
  protected get queried(): boolean {
    return this.#query !== undefined;
  }

  /**
   * Replace how this command is run. The default spawns the CLI; this is the
   * seam a test answers commands through, and the way a build executes `az`
   * through something else. The runner reads the argv from the settings it is
   * handed and must not call their `run()` — that is the call it replaces.
   */
  runner(run: AzSettingsRunner): this {
    this.#runner = run;
    return this;
  }

  /**
   * Run the command — through the {@link runner} when one is set, otherwise
   * by spawning the CLI. Either way the output is reported to the settings'
   * output hook and a non-zero exit throws a `CommandError` unless
   * `.noThrow()` was called.
   */
  override async run(): Promise<CommandOutput> {
    const runner = this.#runner;
    if (runner === undefined) return await super.run();
    // Build the argv first, as a real spawn does, so every refusal a setter's
    // value triggers fires before a runner sees the settings.
    this.argv();
    // Core's ToolSettings has no hook to swap the spawn while keeping its
    // output hook and exit judgement, so the two are repeated here.
    const output = await runner(this);
    this.onOutput(output);
    if (this.throwsOnError) failOnExit(this, output);
    return output;
  }

  /** Emit the Azure CLI's global options after the command. */
  protected override middleTokens(): string[] {
    if (this.#onlyShowErrors && (this.#debug || this.#verbose)) {
      throw new Error(
        "AzTasks: --only-show-errors cannot be combined with --debug or " +
          "--verbose — the CLI refuses the pair. Drop one of them.",
      );
    }
    const argv: string[] = [];
    if (this.#subscription !== undefined) {
      argv.push(option("--subscription", this.#subscription));
    }
    const output = this.pinnedOutput() ?? this.#output;
    if (output !== undefined) argv.push(option("--output", output));
    if (this.#query !== undefined) argv.push(option("--query", this.#query));
    if (this.#onlyShowErrors) argv.push("--only-show-errors");
    if (this.#verbose) argv.push("--verbose");
    if (this.#debug) argv.push("--debug");
    return argv;
  }
}

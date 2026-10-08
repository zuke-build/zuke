// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link AwsSettings} — the base every `aws` command's settings extend: the
 * binary, the command-path builder, the AWS CLI's global options (`--profile`,
 * `--region`, `--output`, `--query`, …), and the runner seam.
 *
 * It lives apart from the commands so a command in its own module (see
 * `s3.ts`) can extend it without importing the module that assembles
 * `AwsTasks`, which would import it back.
 *
 * A command's settings class emits its whole invocation — the service, the
 * operation, its operands and its own options — from `leadingTokens`, so the
 * validation and the argv it guards sit together. The global options follow
 * from `middleTokens`; the AWS CLI accepts them anywhere on the line.
 *
 * @module
 */

import { Command, CommandError, type CommandOutput } from "@zuke/core/shell";
import { defaultReadEnv } from "@zuke/core";
import { SubcommandSettings } from "@zuke/core/tooling";

/**
 * Runs one prepared `aws` command and returns what the process produced. The
 * default spawns the CLI; a test, or a build that executes the CLI some other
 * way, injects its own with {@link AwsSettings.runner}. The runner only
 * produces the output: the exit code is judged afterwards exactly as for a
 * spawned process, so a non-zero `code` still raises a `CommandError` unless
 * the settings say `.noThrow()`.
 */
export type AwsSettingsRunner = (
  settings: AwsSettings,
) => Promise<CommandOutput>;

/** The values the AWS CLI's `--output` option accepts. */
export type AwsOutputFormat =
  | "json"
  | "text"
  | "table"
  | "yaml"
  | "yaml-stream"
  | "off";

/** The credentials the CLI reads from the environment, which `--debug` prints. */
const CREDENTIAL_VARIABLES = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
];

/**
 * Throw core's `CommandError` for a failed exit, rendered through a
 * `Command` so the run's redactor masks the line exactly as it does for a
 * spawned command's failure. Internal: the runner path of
 * {@link AwsSettings.run} and the readers, which insist on success whatever
 * `.noThrow()` said, share it.
 */
export function failOnExit(settings: AwsSettings, output: CommandOutput) {
  if (output.code === 0) return;
  const line = new Command(settings.argv()).commandLine;
  throw new CommandError(line, output.code, output.stderr);
}

/**
 * Settings for an `aws` invocation.
 *
 * Every instance sets two variables in the child's environment so the CLI
 * can never sit waiting for a keypress in a build: `AWS_PAGER` to the empty
 * string (CLI v2 pipes output through `less` by default) and
 * `AWS_CLI_AUTO_PROMPT` to `off` (a profile's `cli_auto_prompt` would
 * otherwise open the interactive prompt). Setting them there keeps the argv
 * exactly what the settings say; override either with `.env({...})`, or add
 * the explicit flag with {@link noCliPager}.
 */
export class AwsSettings extends SubcommandSettings {
  #profile?: string;
  #region?: string;
  #output?: AwsOutputFormat;
  #query?: string;
  #endpointUrl?: string;
  #noCliPager = false;
  #noVerifySsl = false;
  #noSignRequest = false;
  #caBundle?: string;
  #cliReadTimeout?: number;
  #cliConnectTimeout?: number;
  #debug = false;
  #runner?: AwsSettingsRunner;

  /** Settings with the CLI's pager and auto-prompt off in the child's environment. */
  constructor() {
    super();
    this.env({ AWS_PAGER: "", AWS_CLI_AUTO_PROMPT: "off" });
  }

  /** The default executable name (`aws`). */
  protected override defaultTool(): string {
    return "aws";
  }

  /** The named profile from the shared config and credentials files (`--profile`). */
  profile(name: string): this {
    this.#profile = name;
    return this;
  }

  /** The AWS Region to send the request to (`--region`), e.g. `"eu-west-1"`. */
  region(name: string): this {
    this.#region = name;
    return this;
  }

  /** The output format (`--output`): `json`, `text`, `table`, `yaml` or `yaml-stream`. */
  output(format: AwsOutputFormat): this {
    this.#output = format;
    return this;
  }

  /** A JMESPath expression that filters the response (`--query`). */
  query(expression: string): this {
    this.#query = expression;
    return this;
  }

  /** Send the request to this URL instead of the service's default endpoint (`--endpoint-url`). */
  endpointUrl(url: string): this {
    this.#endpointUrl = url;
    return this;
  }

  /**
   * Pass `--no-cli-pager` explicitly. The pager is already off through
   * `AWS_PAGER` (see {@link AwsSettings}); the flag is for a build that wants
   * it on the command line as well. AWS CLI v2 only.
   */
  noCliPager(): this {
    this.#noCliPager = true;
    return this;
  }

  /**
   * Skip TLS certificate verification (`--no-verify-ssl`). This disables the
   * check that the endpoint is who it claims to be — meant for a local
   * emulator, never for a real account; prefer {@link caBundle}.
   */
  noVerifySsl(): this {
    this.#noVerifySsl = true;
    return this;
  }

  /** Send the request unsigned, without loading credentials (`--no-sign-request`). */
  noSignRequest(): this {
    this.#noSignRequest = true;
    return this;
  }

  /** The CA certificate bundle to verify TLS against (`--ca-bundle`). */
  caBundle(path: string): this {
    this.#caBundle = path;
    return this;
  }

  /** The socket read timeout in seconds; `0` blocks forever (`--cli-read-timeout`). */
  cliReadTimeout(seconds: number): this {
    this.#cliReadTimeout = seconds;
    return this;
  }

  /** The socket connect timeout in seconds; `0` blocks forever (`--cli-connect-timeout`). */
  cliConnectTimeout(seconds: number): this {
    this.#cliConnectTimeout = seconds;
    return this;
  }

  /**
   * Turn on the CLI's debug logging (`--debug`), written to stderr.
   *
   * **The debug log carries credentials**: request headers with the session
   * token, and response bodies — a secret's value among them. The access key,
   * secret key and session token in the environment are registered with the
   * run's redactor when this is called, but a credential the CLI loads from a
   * profile, an SSO cache or a role is not known here and is not masked. Keep
   * it for a local investigation, never a shared CI log.
   */
  debug(): this {
    this.#debug = true;
    for (const name of CREDENTIAL_VARIABLES) {
      const value = defaultReadEnv(name);
      if (value !== undefined && value !== "") this.markSecret(value);
    }
    return this;
  }

  /**
   * Add an arbitrary option: `--name value`, or the bare `--name`.
   *
   * Two hazards come with the escape hatch, which the typed setters guard and
   * this does not: a value that starts with `-` is read by the CLI as the next
   * option, and a value that starts with `file://` or `fileb://` is replaced
   * by that file's contents — which then leave the machine in the request.
   * Never pass an untrusted value here.
   */
  override flag(name: string, value?: string | number): this {
    return super.flag(name, value);
  }

  /**
   * The `--output` a command insists on, whatever the settings or the user's
   * config say; `undefined` leaves it to them. A credential-bearing command
   * pins `json`, which is the form its secrets can be found in.
   */
  protected pinnedOutput(): AwsOutputFormat | undefined {
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
   * seam a test answers commands through, and the way a build executes `aws`
   * through something else. The runner reads the argv from the settings it is
   * handed and must not call their `run()` — that is the call it replaces.
   */
  runner(run: AwsSettingsRunner): this {
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

  /** Emit the AWS CLI's global options after the command. */
  protected override middleTokens(): string[] {
    const argv: string[] = [];
    if (this.#profile !== undefined) argv.push("--profile", this.#profile);
    if (this.#region !== undefined) argv.push("--region", this.#region);
    const output = this.pinnedOutput() ?? this.#output;
    if (output !== undefined) argv.push("--output", output);
    if (this.#query !== undefined) argv.push("--query", this.#query);
    if (this.#endpointUrl !== undefined) {
      argv.push("--endpoint-url", this.#endpointUrl);
    }
    if (this.#noCliPager) argv.push("--no-cli-pager");
    if (this.#noVerifySsl) argv.push("--no-verify-ssl");
    if (this.#noSignRequest) argv.push("--no-sign-request");
    if (this.#caBundle !== undefined) argv.push("--ca-bundle", this.#caBundle);
    if (this.#cliReadTimeout !== undefined) {
      argv.push("--cli-read-timeout", String(this.#cliReadTimeout));
    }
    if (this.#cliConnectTimeout !== undefined) {
      argv.push("--cli-connect-timeout", String(this.#cliConnectTimeout));
    }
    if (this.#debug) argv.push("--debug");
    return argv;
  }
}

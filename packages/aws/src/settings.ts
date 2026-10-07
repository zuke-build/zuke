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
  | "yaml-stream";

/**
 * Settings for an `aws` invocation.
 *
 * Every instance sets `AWS_PAGER` to the empty string in the child's
 * environment. AWS CLI v2 pipes output through a pager (`less`) by default,
 * and a pager waiting for a keypress is a build that never finishes; the
 * variable is the off-switch both CLI majors honour, and setting it there
 * keeps the argv exactly what the settings say. Override it with
 * `.env({ AWS_PAGER: "…" })`, or add the explicit flag with
 * {@link noCliPager}.
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

  /** Settings with the CLI pager switched off in the child's environment. */
  constructor() {
    super();
    this.env({ AWS_PAGER: "" });
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

  /** Turn on the CLI's debug logging (`--debug`), written to stderr. */
  debug(): this {
    this.#debug = true;
    return this;
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
    const output = await runner(this);
    this.onOutput(output);
    if (output.code !== 0 && this.throwsOnError) {
      // Rendered through a Command so the run's redactor masks it, exactly as
      // a spawned command's failure is.
      const line = new Command(this.argv()).commandLine;
      throw new CommandError(line, output.code, output.stderr);
    }
    return output;
  }

  /** Emit the AWS CLI's global options after the command. */
  protected override middleTokens(): string[] {
    const argv: string[] = [];
    if (this.#profile !== undefined) argv.push("--profile", this.#profile);
    if (this.#region !== undefined) argv.push("--region", this.#region);
    if (this.#output !== undefined) argv.push("--output", this.#output);
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

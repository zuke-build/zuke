/**
 * Secret sources: resolve a `secret` parameter's value at run time from an
 * external provider instead of requiring it pre-set in the environment.
 *
 * A build declares where a secret comes from with
 * `parameter(...).secret().from(source)`, where `source` is built by
 * {@link execSecret} (run a command, take its stdout) or {@link fileSecret}
 * (read a file). Both are dependency-free — they shell out to a tool you
 * already trust (`op`, `vault`, `gcloud`, …) or read a mounted secret file —
 * so Zuke ships no provider SDKs and no registry to maintain.
 *
 * ```ts
 * import { execSecret, fileSecret, parameter } from "jsr:@zuke/core";
 *
 * // 1Password CLI:
 * const dbPassword = parameter("Database password")
 *   .secret()
 *   .from(execSecret((s) => s.command("op").arg("read", "op://vault/db/password")));
 *
 * // A Kubernetes secret mounted into the pod:
 * const apiToken = parameter("API token")
 *   .secret()
 *   .from(fileSecret((s) => s.path("/run/secrets/api_token")));
 * ```
 *
 * A source is only consulted when no `--flag` and no environment variable
 * supplied the value, so a source is a fallback provider, not an override.
 * Because the parameter is `secret()`, its resolved value is redacted from all
 * of Zuke's reporter output (see {@link Redactor}).
 *
 * @module
 */

import { Command } from "./shell.ts";
import { FileTasks } from "./file.ts";
import type { AbsolutePath, PathLike } from "./path.ts";
import type { Configure } from "./tooling.ts";

/** Raised when a {@link SecretSource} cannot produce a value. */
export class SecretError extends Error {
  /** The error name. */
  override name = "SecretError";
}

/**
 * A provider that resolves a secret's value on demand. Built by
 * {@link execSecret} or {@link fileSecret} and attached to a parameter with
 * `.from(source)`; the framework calls {@link SecretSource.resolve} during
 * parameter resolution.
 */
export interface SecretSource {
  /** Produce the secret value, or throw {@link SecretError} on failure. */
  resolve(): Promise<string>;
}

/**
 * Fluent settings for {@link execSecret}: a command whose standard output is
 * the secret. Configure the binary with {@link ExecSecretSettings.command},
 * arguments with {@link ExecSecretSettings.arg}, and optionally the environment
 * and working directory. Output is trimmed of surrounding whitespace unless
 * {@link ExecSecretSettings.trim} is turned off (some values are
 * whitespace-sensitive).
 */
export class ExecSecretSettings {
  #command?: string;
  #args: string[] = [];
  #env: Record<string, string> = {};
  #cwd?: string;
  #trim = true;

  /** The binary to run (e.g. `op`, `vault`, `gcloud`). Required. */
  command(binary: PathLike): this {
    this.#command = String(binary);
    return this;
  }

  /** Append one or more arguments to the command. */
  arg(...values: Array<string | number | AbsolutePath>): this {
    this.#args.push(...values.map(String));
    return this;
  }

  /** Merge additional environment variables for the process. */
  env(record: Record<string, string>): this {
    this.#env = { ...this.#env, ...record };
    return this;
  }

  /** Set the working directory for the process. */
  cwd(path: PathLike): this {
    this.#cwd = String(path);
    return this;
  }

  /** Whether to trim surrounding whitespace from stdout (default `true`). */
  trim(on = true): this {
    this.#trim = on;
    return this;
  }

  /**
   * Run the command and return its captured stdout as the secret. Streaming is
   * suppressed (`quiet`) so the value is never echoed to the terminal, and a
   * non-zero exit throws a {@link SecretError} naming the command.
   */
  async resolve_(): Promise<string> {
    if (this.#command === undefined) {
      throw new SecretError(
        "execSecret requires a command; call .command(...) in the settings.",
      );
    }
    const command = new Command([this.#command, ...this.#args])
      .env(this.#env)
      .quiet()
      .noThrow();
    if (this.#cwd !== undefined) command.cwd(this.#cwd);
    let output;
    try {
      output = await command;
    } catch (error) {
      // A missing binary (or other spawn failure) surfaces as a clean
      // SecretError rather than a raw Deno error.
      const message = error instanceof Error ? error.message : String(error);
      throw new SecretError(
        `execSecret command "${this.#command}" failed: ${message}`,
      );
    }
    if (output.code !== 0) {
      throw new SecretError(
        `execSecret command "${this.#command}" exited with code ` +
          `${output.code}${output.stderr ? `: ${output.stderr.trim()}` : ""}`,
      );
    }
    return this.#trim ? output.stdout.trim() : output.stdout;
  }
}

/**
 * Fluent settings for {@link fileSecret}: read a secret from a file. Set the
 * path with {@link FileSecretSettings.path}; the content is trimmed of
 * surrounding whitespace unless {@link FileSecretSettings.trim} is turned off.
 */
export class FileSecretSettings {
  #path?: string;
  #trim = true;

  /** The file to read the secret from. Required. */
  path(path: PathLike): this {
    this.#path = String(path);
    return this;
  }

  /** Whether to trim surrounding whitespace from the content (default `true`). */
  trim(on = true): this {
    this.#trim = on;
    return this;
  }

  /**
   * Read the file and return its content as the secret. A missing or
   * unreadable file throws a {@link SecretError} naming the path.
   */
  async resolve_(): Promise<string> {
    if (this.#path === undefined) {
      throw new SecretError(
        "fileSecret requires a path; call .path(...) in the settings.",
      );
    }
    let text: string;
    try {
      text = await FileTasks.readText(this.#path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SecretError(
        `fileSecret could not read "${this.#path}": ${message}`,
      );
    }
    return this.#trim ? text.trim() : text;
  }
}

/**
 * A {@link SecretSource} that runs a command and takes its standard output as
 * the secret value. Configure it through an {@link ExecSecretSettings} lambda.
 *
 * ```ts
 * parameter("Vault token").secret().from(
 *   execSecret((s) => s.command("vault").arg("kv", "get", "-field=token", "secret/ci")),
 * );
 * ```
 */
export function execSecret(
  configure: Configure<ExecSecretSettings>,
): SecretSource {
  const settings = configure(new ExecSecretSettings());
  return { resolve: () => settings.resolve_() };
}

/**
 * A {@link SecretSource} that reads a file and takes its content as the secret
 * value — for a mounted Kubernetes/Docker secret or a CI-provided file.
 * Configure it through a {@link FileSecretSettings} lambda.
 *
 * ```ts
 * parameter("Registry password").secret().from(
 *   fileSecret((s) => s.path("/run/secrets/registry_password")),
 * );
 * ```
 */
export function fileSecret(
  configure: Configure<FileSecretSettings>,
): SecretSource {
  const settings = configure(new FileSecretSettings());
  return { resolve: () => settings.resolve_() };
}

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The bases every `deno deploy` settings class builds on: the token and the
 * output and prompting flags every subcommand shares; the organization, for
 * the commands scoped to one; the application, for the commands scoped to
 * one; and the flags shared by the two commands that upload source
 * (`deno deploy` and `deno deploy create`). Each setter exists only on the
 * commands the CLI accepts it on — `whoami --org`, say, is a usage error.
 *
 * Every valued option renders as one `--name=value` argv entry, so a value
 * that starts with `-` cannot be read as a flag of its own.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { DenoSettings } from "./settings.ts";

/** `--name=value` as one argv entry. */
export function option(name: string, value: string | number): string {
  return `--${name}=${value}`;
}

/** `path` as a positional: prefixed with `./` when it starts with `-`. */
export function pathOperand(path: PathLike): string {
  const text = String(path);
  return text.startsWith("-") ? `./${text}` : text;
}

/**
 * Base for all `deno deploy` settings. Each subcommand names its command path
 * and its own arguments; the shared flags go between them.
 */
export abstract class DenoDeployCommandSettings extends DenoSettings {
  #shared: string[] = [];

  /** The command path after `deploy`, e.g. `["env", "add"]`. */
  protected abstract commandPath(): string[];

  /** The subcommand's own flags and operands. */
  protected abstract commandArgs(): string[];

  /**
   * The Deno Deploy access token. It is passed in the `DENO_DEPLOY_TOKEN`
   * environment variable rather than on the command line, so it never shows
   * in a process listing or an error's command line, and it is registered
   * with the run's redactor. Without it, the CLI reads `DENO_DEPLOY_TOKEN`
   * from the build's own environment.
   */
  token(value: string): this {
    this.markSecret(value);
    return this.env({ DENO_DEPLOY_TOKEN: value });
  }

  /** The config file to read and write the org and app from (`--config`). */
  config(path: PathLike): this {
    this.#shared.push(option("config", String(path)));
    return this;
  }

  /** Print one JSON object on stdout instead of human-readable output (`--json`). */
  json(): this {
    this.#shared.push("--json");
    return this;
  }

  /**
   * Fail instead of prompting, taking every value from flags or the
   * environment (`--non-interactive`). Use it in CI, where nothing can answer
   * a prompt.
   */
  nonInteractive(): this {
    this.#shared.push("--non-interactive");
    return this;
  }

  /** Suppress non-essential output (`--quiet`). */
  quietOutput(): this {
    return this.shared("--quiet");
  }

  /** Append flags to the shared ones, which precede the command's own. */
  protected shared(...tokens: string[]): this {
    this.#shared.push(...tokens);
    return this;
  }

  /** Assemble the `deno deploy …` argv. */
  protected override buildArgs(): string[] {
    return [
      "deploy",
      ...this.commandPath(),
      ...this.#shared,
      ...this.commandArgs(),
    ];
  }
}

/** Base for the `deno deploy` commands scoped to an organization. */
export abstract class DenoDeployOrgSettings extends DenoDeployCommandSettings {
  /** The organization (`--org`). */
  org(name: string): this {
    return this.shared(option("org", name));
  }
}

/** Base for the `deno deploy` commands scoped to an application. */
export abstract class DenoDeployAppSettings extends DenoDeployOrgSettings {
  /** The application (`--app`). */
  app(name: string): this {
    return this.shared(option("app", name));
  }
}

/**
 * The flags shared by the commands that upload source from a local directory:
 * `deno deploy` and `deno deploy create`.
 */
export abstract class DenoDeployUploadSettings extends DenoDeployAppSettings {
  #root?: string;
  #upload: string[] = [];

  /** The directory to upload (defaults to the working directory). */
  root(path: PathLike): this {
    this.#root = pathOperand(path);
    return this;
  }

  /** Leave a path out of the upload (`--ignore`); repeatable. */
  ignore(path: PathLike): this {
    this.#upload.push(option("ignore", String(path)));
    return this;
  }

  /** Include the `node_modules` directory in the upload (`--allow-node-modules`). */
  allowNodeModules(): this {
    this.#upload.push("--allow-node-modules");
    return this;
  }

  /** Return once uploaded, without waiting for the build (`--no-wait`). */
  noWait(): this {
    this.#upload.push("--no-wait");
    return this;
  }

  /** The upload flags, then the root directory last. */
  protected uploadArgs(): string[] {
    return this.#root === undefined
      ? [...this.#upload]
      : [...this.#upload, this.#root];
  }
}

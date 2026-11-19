// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `npm trust`: the trusted publishers npm accepts for a package, so CI can
 * publish by OIDC identity instead of a token.
 *
 * ```ts
 * import { NpmTasks } from "@zuke/npm";
 * await NpmTasks.trust((s) =>
 *   s.github("app", "release.yml").repo("owner/app").allowPublish().yes()
 * );
 * await NpmTasks.trust((s) => s.list("app"));
 * ```
 *
 * @module
 */

import { NpmSettings } from "./settings.ts";

/** Which `npm trust` subcommand a {@link NpmTrustSettings} runs. */
type TrustMode = "github" | "gitlab" | "circleci" | "list" | "revoke";

/**
 * Settings for `npm trust`. Pick the subcommand with {@link github},
 * {@link gitlab}, {@link circleci}, {@link list}, or {@link revoke}; the
 * provider flags apply to the three provider subcommands.
 */
export class NpmTrustSettings extends NpmSettings {
  #mode: TrustMode = "list";
  #pkg?: string;
  #file?: string;
  #repo?: string;
  #environment?: string;
  #allowPublish = false;
  #allowStagePublish = false;
  #yes = false;
  #id?: string;

  /** Trust a GitHub Actions workflow (`trust github [<pkg>]`). */
  github(pkg?: string, file?: string): this {
    return this.#provider("github", pkg, file);
  }

  /** Trust a GitLab CI/CD pipeline file (`trust gitlab [<pkg>]`). */
  gitlab(pkg?: string, file?: string): this {
    return this.#provider("gitlab", pkg, file);
  }

  /** Trust a CircleCI pipeline (`trust circleci [<pkg>]`). */
  circleci(pkg?: string, file?: string): this {
    return this.#provider("circleci", pkg, file);
  }

  /** List a package's trusted publishers (`trust list [<pkg>]`), the default. */
  list(pkg?: string): this {
    this.#mode = "list";
    this.#id = undefined;
    this.#pkg = pkg;
    return this;
  }

  /** Remove a trusted publisher by id (`trust revoke [<pkg>] --id=<id>`). */
  revoke(id: string, pkg?: string): this {
    this.#mode = "revoke";
    this.#id = id;
    this.#pkg = pkg;
    return this;
  }

  /** The workflow or pipeline file to trust (`--file=<name>`). */
  file(name: string): this {
    this.#file = name;
    return this;
  }

  /** The source repository as `owner/name` (`--repo=<owner/name>`). */
  repo(name: string): this {
    this.#repo = name;
    return this;
  }

  /** Bind the trust to a deployment environment (`--environment=<name>`). */
  environment(name: string): this {
    this.#environment = name;
    return this;
  }

  /** Let the trusted workflow publish the package (`--allow-publish`). */
  allowPublish(): this {
    this.#allowPublish = true;
    return this;
  }

  /** Let the trusted workflow stage a publish (`--allow-stage-publish`). */
  allowStagePublish(): this {
    this.#allowStagePublish = true;
    return this;
  }

  /** Skip the confirmation prompt (`--yes`). */
  yes(): this {
    this.#yes = true;
    return this;
  }

  /**
   * Provide a one-time password.
   *
   * Carried in `npm_config_otp` rather than on the command line — see
   * {@link NpmSettings.applyOtp} for why.
   */
  otp(code: string): this {
    this.applyOtp(code);
    return this;
  }

  #provider(mode: TrustMode, pkg?: string, file?: string): this {
    this.#mode = mode;
    this.#id = undefined;
    this.#pkg = pkg;
    if (file !== undefined) this.#file = file;
    return this;
  }

  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "trust";

  /** Assemble the `npm trust` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["trust", this.#mode];
    if (this.#pkg !== undefined) argv.push(this.#pkg);
    if (this.#id !== undefined) argv.push(`--id=${this.#id}`);
    if (this.#file !== undefined) argv.push(`--file=${this.#file}`);
    if (this.#repo !== undefined) argv.push(`--repo=${this.#repo}`);
    if (this.#environment !== undefined) {
      argv.push(`--environment=${this.#environment}`);
    }
    if (this.#allowPublish) argv.push("--allow-publish");
    if (this.#allowStagePublish) argv.push("--allow-stage-publish");
    if (this.#yes) argv.push("--yes");
    return argv;
  }
}

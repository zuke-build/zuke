// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `gh api` subcommand — an authenticated REST/GraphQL call through the
 * user's own `gh` login, for the endpoints that have no dedicated CLI verb
 * (starring a repository, say). Distinct from `./api.ts`, the token-based
 * transport the Actions-oriented tasks share: this one rides whatever
 * credentials `gh auth login` stored, so it fits interactive, developer-machine
 * flows.
 *
 * @module
 */

import { type Configure, runSettings, ToolSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/**
 * Settings for {@link "./gh.ts".GhTasksApi.api | GhTasks.api}, mirroring the
 * real `gh api` flags: `--method`, `--field`, `--raw-field`, `--header`,
 * `--jq`, and `--silent`.
 */
export class GhApiSettings extends ToolSettings {
  #flags: string[] = [];

  /** Build settings for a call to `endpoint` (e.g. `"user/starred/o/r"`). */
  constructor(
    /** The REST endpoint path, or `graphql`. */
    readonly endpoint: string,
  ) {
    super();
  }

  /** The default binary: `gh`. */
  protected override defaultTool(): string {
    return "gh";
  }

  /** The HTTP method (`--method`, e.g. `"PUT"`; `gh` defaults to GET). */
  method(verb: string): this {
    this.#flags.push("--method", verb);
    return this;
  }

  /** Add a typed body parameter (`--field key=value`). Repeatable. */
  field(key: string, value: string | number | boolean): this {
    this.#flags.push("--field", `${key}=${value}`);
    return this;
  }

  /** Add a string body parameter (`--raw-field key=value`). Repeatable. */
  rawField(key: string, value: string): this {
    this.#flags.push("--raw-field", `${key}=${value}`);
    return this;
  }

  /** Add a request header (`--header key:value`). Repeatable. */
  header(name: string, value: string): this {
    this.#flags.push("--header", `${name}:${value}`);
    return this;
  }

  /** Filter the response through a jq expression (`--jq`). */
  jq(expression: string): this {
    this.#flags.push("--jq", expression);
    return this;
  }

  /** Do not print the response body (`--silent`). */
  silent(): this {
    this.#flags.push("--silent");
    return this;
  }

  /** Assemble `api <endpoint>` plus the flags, in call order. */
  protected override buildArgs(): string[] {
    return ["api", this.endpoint, ...this.#flags];
  }
}

/** Run `gh api <endpoint>` with the configured flags. */
export function callApi(
  endpoint: string,
  configure?: Configure<GhApiSettings>,
): Promise<CommandOutput> {
  return runSettings(new GhApiSettings(endpoint), configure);
}

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `gcloud functions` group — deploying and inspecting Cloud Functions.
 *
 * ```ts
 * import { GcloudTasks } from "jsr:@zuke/gcloud";
 * await GcloudTasks.functionsDeploy((s) =>
 *   s.function("ingest").runtime("nodejs20").triggerHttp()
 *     .region("us-central1").entryPoint("main").gen2()
 * );
 * ```
 *
 * @module
 */

import { GcloudSettings } from "./settings.ts";
import { commaJoined } from "./comma_list.ts";

/** Settings for `gcloud functions deploy`. */
export class GcloudFunctionsDeploySettings extends GcloudSettings {
  #name?: string;
  #runtime?: string;
  #region?: string;
  #entryPoint?: string;
  #source?: string;
  #triggerHttp = false;
  #triggerTopic?: string;
  #triggerBucket?: string;
  #triggerEventFilters: string[] = [];
  #serviceAccount?: string;
  #envVars: string[] = [];
  #memory?: string;
  #timeout?: string;
  #gen2 = false;

  /** The function to deploy (positional). */
  function(name: string): this {
    this.#name = name;
    return this;
  }

  /** The language runtime (`--runtime`), e.g. `"nodejs20"`. */
  runtime(value: string): this {
    this.#runtime = value;
    return this;
  }

  /** The region to deploy into (`--region`). */
  region(value: string): this {
    this.#region = value;
    return this;
  }

  /** The exported symbol to invoke (`--entry-point`). */
  entryPoint(value: string): this {
    this.#entryPoint = value;
    return this;
  }

  /** Where the source lives (`--source`). */
  source(path: string): this {
    this.#source = path;
    return this;
  }

  /** Trigger on HTTP requests (`--trigger-http`). */
  triggerHttp(): this {
    this.#triggerHttp = true;
    return this;
  }

  /** Trigger on a Pub/Sub topic (`--trigger-topic`). */
  triggerTopic(name: string): this {
    this.#triggerTopic = name;
    return this;
  }

  /** Trigger on a Cloud Storage bucket (`--trigger-bucket`). */
  triggerBucket(name: string): this {
    this.#triggerBucket = name;
    return this;
  }

  /** Trigger on matching Eventarc events (`--trigger-event-filters`). */
  triggerEventFilters(...filters: string[]): this {
    this.#triggerEventFilters.push(...filters);
    return this;
  }

  /** The identity the function runs as (`--service-account`). */
  serviceAccount(email: string): this {
    this.#serviceAccount = email;
    return this;
  }

  /** Environment variables (`--set-env-vars`), as `KEY=value`; repeatable. */
  setEnvVars(...pairs: string[]): this {
    this.#envVars.push(...pairs);
    return this;
  }

  /** Memory per instance (`--memory`). */
  memory(value: string): this {
    this.#memory = value;
    return this;
  }

  /** Execution timeout (`--timeout`). */
  timeout(value: string): this {
    this.#timeout = value;
    return this;
  }

  /** Deploy as a 2nd-generation function (`--gen2`). */
  gen2(): this {
    this.#gen2 = true;
    return this;
  }

  /** Emit `functions deploy` with its operand and flags. */
  protected override leadingTokens(): string[] {
    if (this.#name === undefined) {
      throw new Error(
        "GcloudTasks.functionsDeploy: no function named — add " +
          ".function('ingest').",
      );
    }
    // A function is reached one way. gcloud reports its own conflict for some
    // pairings, but not all, so the refusal is here rather than left to which
    // trigger flag the CLI happens to honour.
    const triggers = [
      [".triggerHttp()", this.#triggerHttp],
      [".triggerTopic()", this.#triggerTopic !== undefined],
      [".triggerBucket()", this.#triggerBucket !== undefined],
      [".triggerEventFilters()", this.#triggerEventFilters.length > 0],
    ].filter(([, on]) => on).map(([name]) => name);
    if (triggers.length > 1) {
      throw new Error(
        `GcloudTasks.functionsDeploy: ${triggers.join(" and ")} each say how ` +
          "the function is invoked — keep one.",
      );
    }
    const argv = ["functions", "deploy", this.#name];
    if (this.#runtime !== undefined) argv.push("--runtime", this.#runtime);
    if (this.#region !== undefined) argv.push("--region", this.#region);
    if (this.#entryPoint !== undefined) {
      argv.push("--entry-point", this.#entryPoint);
    }
    if (this.#source !== undefined) argv.push("--source", this.#source);
    if (this.#triggerHttp) argv.push("--trigger-http");
    if (this.#triggerTopic !== undefined) {
      argv.push("--trigger-topic", this.#triggerTopic);
    }
    if (this.#triggerBucket !== undefined) {
      argv.push("--trigger-bucket", this.#triggerBucket);
    }
    for (const filter of this.#triggerEventFilters) {
      argv.push("--trigger-event-filters", filter);
    }
    if (this.#serviceAccount !== undefined) {
      argv.push("--service-account", this.#serviceAccount);
    }
    if (this.#envVars.length > 0) {
      argv.push(
        "--set-env-vars",
        commaJoined(this.#envVars, "functionsDeploy", "--set-env-vars"),
      );
    }
    if (this.#memory !== undefined) argv.push("--memory", this.#memory);
    if (this.#timeout !== undefined) argv.push("--timeout", this.#timeout);
    if (this.#gen2) argv.push("--gen2");
    return argv;
  }
}

/** Settings for `gcloud functions describe`. */
export class GcloudFunctionsDescribeSettings extends GcloudSettings {
  #name?: string;
  #region?: string;
  #gen2 = false;

  /** The function to describe (positional). */
  function(name: string): this {
    this.#name = name;
    return this;
  }

  /** The region it runs in (`--region`). */
  region(value: string): this {
    this.#region = value;
    return this;
  }

  /** Look it up as a 2nd-generation function (`--gen2`). */
  gen2(): this {
    this.#gen2 = true;
    return this;
  }

  /** Emit `functions describe` with its operand. */
  protected override leadingTokens(): string[] {
    if (this.#name === undefined) {
      throw new Error(
        "GcloudTasks.functionsDescribe: no function named — add " +
          ".function('ingest').",
      );
    }
    const argv = ["functions", "describe", this.#name];
    if (this.#region !== undefined) argv.push("--region", this.#region);
    if (this.#gen2) argv.push("--gen2");
    return argv;
  }
}

/** Settings for `gcloud secrets versions access`. */
export class GcloudSecretsVersionsAccessSettings extends GcloudSettings {
  #version = "latest";
  #secret?: string;

  /** The version to read (positional); defaults to `latest`. */
  version(value: string): this {
    this.#version = value;
    return this;
  }

  /** The secret to read it from (`--secret`). */
  secret(name: string): this {
    this.#secret = name;
    return this;
  }

  /** Emit `secrets versions access` with its operand. */
  protected override leadingTokens(): string[] {
    if (this.#secret === undefined) {
      throw new Error(
        "GcloudTasks.secretsAccess: no secret named — add .secret('api-key').",
      );
    }
    return [
      "secrets",
      "versions",
      "access",
      this.#version,
      "--secret",
      this.#secret,
    ];
  }
}

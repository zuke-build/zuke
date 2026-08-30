// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `gcloud run` group — deploying to Cloud Run and reading back what the
 * deploy produced.
 *
 * ```ts
 * import { GcloudTasks } from "jsr:@zuke/gcloud";
 * await GcloudTasks.runDeploy((s) =>
 *   s.service("api").image(image).region("us-central1").allowUnauthenticated()
 * );
 * const url = await GcloudTasks.runServiceUrl((s) =>
 *   s.service("api").region("us-central1")
 * );
 * ```
 *
 * {@link "./gcloud.ts".GcloudTasks.runServiceUrl} is the reader, and the way it
 * gets its answer is the point: it pins `--format` to gcloud's own
 * `value(status.url)` projection, so **gcloud** extracts the field and the
 * reader receives a bare line. Nothing here parses a JSON document, because
 * there is no project in this repository's test environment to produce one to
 * check a parser against.
 *
 * @module
 */

import { GcloudSettings } from "./settings.ts";
import { commaJoined } from "./comma_list.ts";

/** The `--format` the service-URL reader pins, so gcloud does the extraction. */
export const RUN_SERVICE_URL_FORMAT = "value(status.url)";

/** Settings for `gcloud run deploy`. */
export class GcloudRunDeploySettings extends GcloudSettings {
  #service?: string;
  #image?: string;
  #source?: string;
  #region?: string;
  #platform?: string;
  #allowUnauthenticated = false;
  #noAllowUnauthenticated = false;
  #serviceAccount?: string;
  #envVars: string[] = [];
  #secrets: string[] = [];
  #memory?: string;
  #cpu?: string;
  #concurrency?: number;
  #maxInstances?: number;
  #minInstances?: number;
  #port?: number;
  #timeout?: string;
  #tag?: string;
  #noTraffic = false;

  /** The service to deploy (positional). */
  service(name: string): this {
    this.#service = name;
    return this;
  }

  /** The container image to deploy (`--image`). */
  image(reference: string): this {
    this.#image = reference;
    return this;
  }

  /** Build and deploy from source instead of an image (`--source`). */
  source(path: string): this {
    this.#source = path;
    return this;
  }

  /** The region to deploy into (`--region`). */
  region(value: string): this {
    this.#region = value;
    return this;
  }

  /** The platform to target (`--platform`), e.g. `"managed"`. */
  platform(value: string): this {
    this.#platform = value;
    return this;
  }

  /** Let unauthenticated callers invoke the service (`--allow-unauthenticated`). */
  allowUnauthenticated(): this {
    this.#allowUnauthenticated = true;
    return this;
  }

  /** Require authentication to invoke it (`--no-allow-unauthenticated`). */
  noAllowUnauthenticated(): this {
    this.#noAllowUnauthenticated = true;
    return this;
  }

  /** The identity the service runs as (`--service-account`). */
  serviceAccount(email: string): this {
    this.#serviceAccount = email;
    return this;
  }

  /** Environment variables (`--set-env-vars`), as `KEY=value`; repeatable. */
  setEnvVars(...pairs: string[]): this {
    this.#envVars.push(...pairs);
    return this;
  }

  /** Secret Manager mounts (`--set-secrets`); repeatable. */
  setSecrets(...pairs: string[]): this {
    this.#secrets.push(...pairs);
    return this;
  }

  /** Memory per instance (`--memory`), e.g. `"512Mi"`. */
  memory(value: string): this {
    this.#memory = value;
    return this;
  }

  /** CPU per instance (`--cpu`). */
  cpu(value: string): this {
    this.#cpu = value;
    return this;
  }

  /** Requests served concurrently per instance (`--concurrency`). */
  concurrency(value: number): this {
    this.#concurrency = value;
    return this;
  }

  /** Upper bound on instances (`--max-instances`). */
  maxInstances(value: number): this {
    this.#maxInstances = value;
    return this;
  }

  /** Lower bound on instances (`--min-instances`). */
  minInstances(value: number): this {
    this.#minInstances = value;
    return this;
  }

  /** The port the container listens on (`--port`). */
  port(value: number): this {
    this.#port = value;
    return this;
  }

  /** Request timeout (`--timeout`). */
  timeout(value: string): this {
    this.#timeout = value;
    return this;
  }

  /** Tag this revision (`--tag`), so it is addressable without traffic. */
  tag(value: string): this {
    this.#tag = value;
    return this;
  }

  /** Deploy without moving traffic to the new revision (`--no-traffic`). */
  noTraffic(): this {
    this.#noTraffic = true;
    return this;
  }

  /** Emit `run deploy` with its operand and flags. */
  protected override leadingTokens(): string[] {
    if (this.#service === undefined) {
      throw new Error(
        "GcloudTasks.runDeploy: no service named — add .service('api').",
      );
    }
    if (this.#image !== undefined && this.#source !== undefined) {
      throw new Error(
        "GcloudTasks.runDeploy: .image() deploys a built container and " +
          ".source() builds one first — keep one.",
      );
    }
    // gcloud accepts both spellings and resolves them silently. Which one wins
    // decides whether the service is reachable by anyone on the internet, so it
    // is not a thing to leave to the order the settings lambda happened to call
    // them in.
    if (this.#allowUnauthenticated && this.#noAllowUnauthenticated) {
      throw new Error(
        "GcloudTasks.runDeploy: .allowUnauthenticated() and " +
          ".noAllowUnauthenticated() are opposites, and gcloud accepts both " +
          "without complaint — the difference is whether the service is " +
          "publicly invokable. Keep one.",
      );
    }
    const argv = ["run", "deploy", this.#service];
    if (this.#image !== undefined) argv.push("--image", this.#image);
    if (this.#source !== undefined) argv.push("--source", this.#source);
    if (this.#region !== undefined) argv.push("--region", this.#region);
    if (this.#platform !== undefined) argv.push("--platform", this.#platform);
    if (this.#allowUnauthenticated) argv.push("--allow-unauthenticated");
    if (this.#noAllowUnauthenticated) argv.push("--no-allow-unauthenticated");
    if (this.#serviceAccount !== undefined) {
      argv.push("--service-account", this.#serviceAccount);
    }
    if (this.#envVars.length > 0) {
      argv.push(
        "--set-env-vars",
        commaJoined(this.#envVars, "runDeploy", "--set-env-vars"),
      );
    }
    if (this.#secrets.length > 0) {
      argv.push(
        "--set-secrets",
        commaJoined(this.#secrets, "runDeploy", "--set-secrets"),
      );
    }
    if (this.#memory !== undefined) argv.push("--memory", this.#memory);
    if (this.#cpu !== undefined) argv.push("--cpu", this.#cpu);
    if (this.#concurrency !== undefined) {
      argv.push("--concurrency", String(this.#concurrency));
    }
    if (this.#maxInstances !== undefined) {
      argv.push("--max-instances", String(this.#maxInstances));
    }
    if (this.#minInstances !== undefined) {
      argv.push("--min-instances", String(this.#minInstances));
    }
    if (this.#port !== undefined) argv.push("--port", String(this.#port));
    if (this.#timeout !== undefined) argv.push("--timeout", this.#timeout);
    if (this.#tag !== undefined) argv.push("--tag", this.#tag);
    if (this.#noTraffic) argv.push("--no-traffic");
    return argv;
  }
}

/** Settings for `gcloud run services describe`. */
export class GcloudRunServicesDescribeSettings extends GcloudSettings {
  #service?: string;
  #region?: string;
  #platform?: string;

  /** The service to describe (positional). */
  service(name: string): this {
    this.#service = name;
    return this;
  }

  /** The region it runs in (`--region`). */
  region(value: string): this {
    this.#region = value;
    return this;
  }

  /** The platform it runs on (`--platform`). */
  platform(value: string): this {
    this.#platform = value;
    return this;
  }

  /** Emit `run services describe` with its operand. */
  protected override leadingTokens(): string[] {
    if (this.#service === undefined) {
      throw new Error(
        "GcloudTasks.runServicesDescribe: no service named — add " +
          ".service('api').",
      );
    }
    const argv = ["run", "services", "describe", this.#service];
    if (this.#region !== undefined) argv.push("--region", this.#region);
    if (this.#platform !== undefined) argv.push("--platform", this.#platform);
    return argv;
  }
}

/** Settings for `gcloud run services list`. */
export class GcloudRunServicesListSettings extends GcloudSettings {
  #region?: string;
  #platform?: string;
  #filter?: string;

  /** The region to list from (`--region`). */
  region(value: string): this {
    this.#region = value;
    return this;
  }

  /** The platform to list from (`--platform`). */
  platform(value: string): this {
    this.#platform = value;
    return this;
  }

  /** Restrict the listing (`--filter`). */
  filter(expression: string): this {
    this.#filter = expression;
    return this;
  }

  /** Emit `run services list` with its flags. */
  protected override leadingTokens(): string[] {
    const argv = ["run", "services", "list"];
    if (this.#region !== undefined) argv.push("--region", this.#region);
    if (this.#platform !== undefined) argv.push("--platform", this.#platform);
    if (this.#filter !== undefined) argv.push("--filter", this.#filter);
    return argv;
  }
}

/** Settings for `gcloud run services update-traffic`. */
export class GcloudRunUpdateTrafficSettings extends GcloudSettings {
  #service?: string;
  #region?: string;
  #toLatest = false;
  #toRevisions: string[] = [];
  #toTags: string[] = [];

  /** The service whose traffic to move (positional). */
  service(name: string): this {
    this.#service = name;
    return this;
  }

  /** The region it runs in (`--region`). */
  region(value: string): this {
    this.#region = value;
    return this;
  }

  /** Send all traffic to the newest revision (`--to-latest`). */
  toLatest(): this {
    this.#toLatest = true;
    return this;
  }

  /** Split traffic across revisions (`--to-revisions`), as `rev=percent`. */
  toRevisions(...splits: string[]): this {
    this.#toRevisions.push(...splits);
    return this;
  }

  /** Split traffic across tags (`--to-tags`), as `tag=percent`. */
  toTags(...splits: string[]): this {
    this.#toTags.push(...splits);
    return this;
  }

  /** Emit `run services update-traffic` with its operand and target. */
  protected override leadingTokens(): string[] {
    if (this.#service === undefined) {
      throw new Error(
        "GcloudTasks.runUpdateTraffic: no service named — add " +
          ".service('api').",
      );
    }
    // gcloud: "argument --to-latest: At most one of --to-latest |
    // --to-revisions | --to-tags can be specified."
    const chosen = [
      [".toLatest()", this.#toLatest],
      [".toRevisions()", this.#toRevisions.length > 0],
      [".toTags()", this.#toTags.length > 0],
    ].filter(([, on]) => on).map(([name]) => name);
    if (chosen.length > 1) {
      throw new Error(
        `GcloudTasks.runUpdateTraffic: ${chosen.join(" and ")} each describe ` +
          "where the traffic goes, and gcloud accepts at most one of " +
          "--to-latest, --to-revisions and --to-tags. Keep one.",
      );
    }
    if (chosen.length === 0) {
      throw new Error(
        "GcloudTasks.runUpdateTraffic: no destination — add .toLatest(), " +
          ".toRevisions(...) or .toTags(...), since the command exists to " +
          "move traffic somewhere.",
      );
    }
    const argv = ["run", "services", "update-traffic", this.#service];
    if (this.#region !== undefined) argv.push("--region", this.#region);
    if (this.#toLatest) argv.push("--to-latest");
    if (this.#toRevisions.length > 0) {
      argv.push(
        "--to-revisions",
        commaJoined(this.#toRevisions, "runUpdateTraffic", "--to-revisions"),
      );
    }
    if (this.#toTags.length > 0) {
      argv.push(
        "--to-tags",
        commaJoined(this.#toTags, "runUpdateTraffic", "--to-tags"),
      );
    }
    return argv;
  }
}

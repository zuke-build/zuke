// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `aws ecs` service — registering a task definition, rolling a service
 * onto it, and waiting for the rollout to settle.
 *
 * ```ts
 * import { AwsTasks } from "@zuke/aws";
 * await AwsTasks.ecsUpdateService((s) =>
 *   s.cluster("prod").service("api").taskDefinition("api:42")
 * );
 * await AwsTasks.ecsWaitServicesStable((s) => s.cluster("prod").services("api"));
 * ```
 *
 * @module
 */

import { freeText, operands, option } from "./validate.ts";
import { AwsSettings } from "./settings.ts";

/** Settings for `aws ecs update-service`. */
export class AwsEcsUpdateServiceSettings extends AwsSettings {
  #cluster?: string;
  #service?: string;
  #taskDefinition?: string;
  #desiredCount?: number;
  #forceNewDeployment = false;
  #healthCheckGracePeriodSeconds?: number;

  /** The cluster the service runs in (`--cluster`); the default cluster when omitted. */
  cluster(name: string): this {
    this.#cluster = name;
    return this;
  }

  /** The service to update (`--service`). */
  service(name: string): this {
    this.#service = name;
    return this;
  }

  /** The task definition to run, as `family:revision` or an ARN (`--task-definition`). */
  taskDefinition(value: string): this {
    this.#taskDefinition = value;
    return this;
  }

  /** How many tasks to keep running (`--desired-count`). */
  desiredCount(count: number): this {
    this.#desiredCount = count;
    return this;
  }

  /** Start a new deployment even when nothing changed (`--force-new-deployment`). */
  forceNewDeployment(): this {
    this.#forceNewDeployment = true;
    return this;
  }

  /** Seconds to ignore failing health checks after a task starts (`--health-check-grace-period-seconds`). */
  healthCheckGracePeriodSeconds(seconds: number): this {
    this.#healthCheckGracePeriodSeconds = seconds;
    return this;
  }

  /** Emit `ecs update-service` with its options. */
  protected override leadingTokens(): string[] {
    if (this.#service === undefined) {
      throw new Error(
        "AwsTasks.ecsUpdateService: no service named — add .service('api').",
      );
    }
    const argv = ["ecs", "update-service"];
    if (this.#cluster !== undefined) {
      argv.push(option("--cluster", this.#cluster));
    }
    argv.push(option("--service", this.#service));
    if (this.#taskDefinition !== undefined) {
      argv.push(option("--task-definition", this.#taskDefinition));
    }
    if (this.#desiredCount !== undefined) {
      argv.push(option("--desired-count", this.#desiredCount));
    }
    if (this.#forceNewDeployment) argv.push("--force-new-deployment");
    if (this.#healthCheckGracePeriodSeconds !== undefined) {
      argv.push(
        option(
          "--health-check-grace-period-seconds",
          this.#healthCheckGracePeriodSeconds,
        ),
      );
    }
    return argv;
  }
}

/**
 * The cluster and the list of services `describe-services` and
 * `wait services-stable` share; each class names its own command.
 */
function servicesArgv(
  task: string,
  command: string[],
  cluster: string | undefined,
  services: readonly string[],
): string[] {
  if (services.length === 0) {
    throw new Error(
      `AwsTasks.${task}: no services named — add .services('api').`,
    );
  }
  const argv = ["ecs", ...command];
  if (cluster !== undefined) argv.push(option("--cluster", cluster));
  argv.push("--services", ...operands(task, "--services", services));
  return argv;
}

/** Settings for `aws ecs describe-services`. */
export class AwsEcsDescribeServicesSettings extends AwsSettings {
  #cluster?: string;
  readonly #services: string[] = [];

  /** The cluster the services run in (`--cluster`). */
  cluster(name: string): this {
    this.#cluster = name;
    return this;
  }

  /** The services to describe (`--services`); repeatable. */
  services(...names: string[]): this {
    this.#services.push(...names);
    return this;
  }

  /** Emit `ecs describe-services` with its options. */
  protected override leadingTokens(): string[] {
    return servicesArgv(
      "ecsDescribeServices",
      ["describe-services"],
      this.#cluster,
      this.#services,
    );
  }
}

/**
 * Settings for `aws ecs wait services-stable`: block until every named
 * service has its desired count running on one deployment. The CLI polls
 * every 15 seconds and gives up after 40 attempts with a non-zero exit, which
 * surfaces as a `CommandError`.
 */
export class AwsEcsWaitServicesStableSettings extends AwsSettings {
  #cluster?: string;
  readonly #services: string[] = [];

  /** The cluster the services run in (`--cluster`). */
  cluster(name: string): this {
    this.#cluster = name;
    return this;
  }

  /** The services to wait for (`--services`); repeatable. */
  services(...names: string[]): this {
    this.#services.push(...names);
    return this;
  }

  /** Emit `ecs wait services-stable` with its options. */
  protected override leadingTokens(): string[] {
    return servicesArgv(
      "ecsWaitServicesStable",
      ["wait", "services-stable"],
      this.#cluster,
      this.#services,
    );
  }
}

/**
 * Settings for `aws ecs register-task-definition`.
 *
 * Either hand the whole definition over with {@link cliInputJson} — the usual
 * form, a `file://` path to a JSON document — or set the family and its
 * container definitions. Environment values in a container definition land
 * on the command line; keep secrets in the definition's `secrets` (Secrets
 * Manager or SSM references) rather than its `environment`.
 */
export class AwsEcsRegisterTaskDefinitionSettings extends AwsSettings {
  #cliInputJson?: string;
  #family?: string;
  #containerDefinitions?: string;
  #taskRoleArn?: string;
  #executionRoleArn?: string;
  #networkMode?: string;
  readonly #requiresCompatibilities: string[] = [];
  #cpu?: string;
  #memory?: string;

  /**
   * The whole request as JSON (`--cli-input-json`): a `file://` path to the
   * document, or the document itself.
   */
  cliInputJson(value: string): this {
    this.#cliInputJson = value;
    return this;
  }

  /** The task definition family (`--family`). */
  family(name: string): this {
    this.#family = name;
    return this;
  }

  /** The container definitions, as a JSON array or a `file://` path (`--container-definitions`). */
  containerDefinitions(json: string): this {
    this.#containerDefinitions = json;
    return this;
  }

  /** The role the task's containers assume (`--task-role-arn`). */
  taskRoleArn(arn: string): this {
    this.#taskRoleArn = arn;
    return this;
  }

  /** The role ECS uses to pull images and read secrets (`--execution-role-arn`). */
  executionRoleArn(arn: string): this {
    this.#executionRoleArn = arn;
    return this;
  }

  /** The Docker networking mode (`--network-mode`), e.g. `"awsvpc"`. */
  networkMode(mode: string): this {
    this.#networkMode = mode;
    return this;
  }

  /** The launch types the definition must suit (`--requires-compatibilities`). */
  requiresCompatibilities(...types: string[]): this {
    this.#requiresCompatibilities.push(...types);
    return this;
  }

  /** CPU units for the task (`--cpu`), e.g. `"256"`. */
  cpu(value: string): this {
    this.#cpu = value;
    return this;
  }

  /** Memory for the task in MiB (`--memory`), e.g. `"512"`. */
  memory(value: string): this {
    this.#memory = value;
    return this;
  }

  /** Emit `ecs register-task-definition` with its options. */
  protected override leadingTokens(): string[] {
    if (this.#cliInputJson === undefined && this.#family === undefined) {
      throw new Error(
        "AwsTasks.ecsRegisterTaskDefinition: nothing to register — add " +
          ".cliInputJson('file://taskdef.json'), or .family(name) with " +
          ".containerDefinitions(json).",
      );
    }
    const argv = ["ecs", "register-task-definition"];
    if (this.#cliInputJson !== undefined) {
      argv.push(option("--cli-input-json", this.#cliInputJson));
    }
    if (this.#family !== undefined) argv.push(option("--family", this.#family));
    if (this.#containerDefinitions !== undefined) {
      argv.push(option("--container-definitions", this.#containerDefinitions));
    }
    if (this.#taskRoleArn !== undefined) {
      argv.push(option("--task-role-arn", this.#taskRoleArn));
    }
    if (this.#executionRoleArn !== undefined) {
      argv.push(option("--execution-role-arn", this.#executionRoleArn));
    }
    if (this.#networkMode !== undefined) {
      argv.push(option("--network-mode", this.#networkMode));
    }
    if (this.#requiresCompatibilities.length > 0) {
      argv.push(
        "--requires-compatibilities",
        ...operands(
          "ecsRegisterTaskDefinition",
          "--requires-compatibilities",
          this.#requiresCompatibilities,
        ),
      );
    }
    if (this.#cpu !== undefined) argv.push(option("--cpu", this.#cpu));
    if (this.#memory !== undefined) argv.push(option("--memory", this.#memory));
    return argv;
  }
}

/** Settings for `aws ecs run-task`. */
export class AwsEcsRunTaskSettings extends AwsSettings {
  #cluster?: string;
  #taskDefinition?: string;
  #count?: number;
  #launchType?: string;
  #networkConfiguration?: string;
  #overrides?: string;
  #startedBy?: string;
  #group?: string;

  /** The cluster to run the task in (`--cluster`). */
  cluster(name: string): this {
    this.#cluster = name;
    return this;
  }

  /** The task definition to run (`--task-definition`). */
  taskDefinition(value: string): this {
    this.#taskDefinition = value;
    return this;
  }

  /** How many copies to start (`--count`). */
  count(value: number): this {
    this.#count = value;
    return this;
  }

  /** The launch type (`--launch-type`): `"FARGATE"`, `"EC2"` or `"EXTERNAL"`. */
  launchType(value: string): this {
    this.#launchType = value;
    return this;
  }

  /** The `awsvpc` network configuration, as JSON (`--network-configuration`). */
  networkConfiguration(json: string): this {
    this.#networkConfiguration = json;
    return this;
  }

  /** Container overrides, as JSON (`--overrides`). */
  overrides(json: string): this {
    this.#overrides = json;
    return this;
  }

  /** A label for who started the task (`--started-by`). */
  startedBy(value: string): this {
    this.#startedBy = freeText("ecsRunTask", "--started-by", value);
    return this;
  }

  /** The task group name (`--group`). */
  group(name: string): this {
    this.#group = name;
    return this;
  }

  /** Emit `ecs run-task` with its options. */
  protected override leadingTokens(): string[] {
    if (this.#taskDefinition === undefined) {
      throw new Error(
        "AwsTasks.ecsRunTask: no task definition named — add " +
          ".taskDefinition('migrate:3').",
      );
    }
    const argv = ["ecs", "run-task"];
    if (this.#cluster !== undefined) {
      argv.push(option("--cluster", this.#cluster));
    }
    argv.push(option("--task-definition", this.#taskDefinition));
    if (this.#count !== undefined) argv.push(option("--count", this.#count));
    if (this.#launchType !== undefined) {
      argv.push(option("--launch-type", this.#launchType));
    }
    if (this.#networkConfiguration !== undefined) {
      argv.push(option("--network-configuration", this.#networkConfiguration));
    }
    if (this.#overrides !== undefined) {
      argv.push(option("--overrides", this.#overrides));
    }
    if (this.#startedBy !== undefined) {
      argv.push(option("--started-by", this.#startedBy));
    }
    if (this.#group !== undefined) argv.push(option("--group", this.#group));
    return argv;
  }
}

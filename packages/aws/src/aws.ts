// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `AwsTasks` — a typed wrapper for the `aws` CLI (AWS CLI v2), in the same
 * settings-lambda style as the other Zuke tool wrappers.
 *
 * The CLI is vast, so the wrapper is both: typed settings for the commands a
 * build's deploy path uses — STS, S3, ECR, ECS, Lambda, CloudFormation,
 * Secrets Manager, SSM, EKS, CloudWatch and CloudWatch Logs — and a general
 * builder for everything else:
 *
 * ```ts
 * import { AwsTasks } from "@zuke/aws";
 * await AwsTasks.run((s) =>
 *   s.command("sns", "publish").flag("topic-arn", topic)
 *     .flag("message", "deployed").region("eu-west-1")
 * );
 * ```
 *
 * Readers — {@link AwsTasksApi.accountId}, {@link AwsTasksApi.secretString},
 * {@link AwsTasksApi.metricValue}, … — return a value rather than the
 * command's output. Each pins `--output` and `--query` after the caller's
 * lambda, so the CLI does the extraction, and each runs quietly so what it
 * read is not streamed to the build log.
 *
 * Arguments stay a discrete argv array end-to-end — never a concatenated
 * shell string — so command construction is injection-free.
 *
 * @module
 */

import { type Configure, runSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";
import { AwsSettings } from "./settings.ts";
import { AwsOutputError } from "./errors.ts";
import { jsonFrom, scalarFrom } from "./reader.ts";
import { isStringArray } from "./shape.ts";
import {
  ACCOUNT_ID_QUERY,
  AwsStsAssumeRoleSettings,
  AwsStsGetCallerIdentitySettings,
} from "./sts.ts";
import {
  AwsConfigureGetSettings,
  AwsConfigureSetSettings,
} from "./configure.ts";
import {
  AwsS3CpSettings,
  AwsS3LsSettings,
  AwsS3MbSettings,
  AwsS3PresignSettings,
  AwsS3RmSettings,
  AwsS3SyncSettings,
} from "./s3.ts";
import {
  AwsEcrBatchDeleteImageSettings,
  AwsEcrDescribeImagesSettings,
  AwsEcrDescribeRepositoriesSettings,
  AwsEcrGetLoginPasswordSettings,
} from "./ecr.ts";
import {
  AwsEcsDescribeServicesSettings,
  AwsEcsRegisterTaskDefinitionSettings,
  AwsEcsRunTaskSettings,
  AwsEcsUpdateServiceSettings,
  AwsEcsWaitServicesStableSettings,
} from "./ecs.ts";
import {
  AwsLambdaGetFunctionSettings,
  AwsLambdaInvokeSettings,
  AwsLambdaPublishVersionSettings,
  AwsLambdaUpdateAliasSettings,
  AwsLambdaUpdateFunctionCodeSettings,
  AwsLambdaUpdateFunctionConfigurationSettings,
  FUNCTION_VERSION_QUERY,
} from "./lambda.ts";
import {
  AwsCloudformationDeleteStackSettings,
  AwsCloudformationDeploySettings,
  AwsCloudformationDescribeStacksSettings,
  AwsCloudformationWaitSettings,
  stackOutputQuery,
} from "./cloudformation.ts";
import {
  AwsSecretsmanagerGetSecretValueSettings,
  SECRET_STRING_QUERY,
} from "./secretsmanager.ts";
import {
  AwsSsmGetParameterSettings,
  AwsSsmPutParameterSettings,
  PARAMETER_VALUE_QUERY,
} from "./ssm.ts";
import {
  AwsEksDescribeClusterSettings,
  AwsEksUpdateKubeconfigSettings,
} from "./eks.ts";
import {
  type AwsCloudwatchAlarmState,
  AwsCloudwatchDescribeAlarmsSettings,
  AwsCloudwatchGetMetricDataSettings,
  AwsCloudwatchGetMetricStatisticsSettings,
} from "./cloudwatch.ts";
import {
  AwsCloudwatchMetricValueSettings,
  metricValueOf,
} from "./metric_value.ts";
import { METRIC_DATA_RESULTS_QUERY } from "./metric_data.ts";
import { ALARMS_QUERY, alarmStateOf } from "./alarm_state.ts";
import {
  AwsLogsFilterLogEventsSettings,
  AwsLogsGetQueryResultsSettings,
  AwsLogsStartQuerySettings,
  AwsLogsStopQuerySettings,
  AwsLogsTailSettings,
} from "./logs.ts";
import {
  AwsLogsInsightsQuerySettings,
  type AwsLogsInsightsRow,
  runLogsInsightsQuery,
} from "./logs_insights.ts";

export { AwsSettings };

/** The shape of {@link AwsTasks}. */
export interface AwsTasksApi {
  /** Run any `aws` command, built with `.command(service, operation, …)`. */
  run(configure?: Configure<AwsSettings>): Promise<CommandOutput>;

  /** Who the build runs as: `aws sts get-caller-identity`. */
  stsGetCallerIdentity(
    configure?: Configure<AwsStsGetCallerIdentitySettings>,
  ): Promise<CommandOutput>;

  /**
   * The AWS account id the build runs as, read back as a string. Pins
   * `--query Account --output text`.
   */
  accountId(
    configure?: Configure<AwsStsGetCallerIdentitySettings>,
  ): Promise<string>;

  /** Take on a role's temporary credentials: `aws sts assume-role` (captured, never streamed). */
  stsAssumeRole(
    configure?: Configure<AwsStsAssumeRoleSettings>,
  ): Promise<CommandOutput>;

  /** Read a CLI setting: `aws configure get`. */
  configureGet(
    configure?: Configure<AwsConfigureGetSettings>,
  ): Promise<CommandOutput>;

  /** Write a CLI setting: `aws configure set`. */
  configureSet(
    configure?: Configure<AwsConfigureSetSettings>,
  ): Promise<CommandOutput>;

  /** Copy a file or tree to, from or within S3: `aws s3 cp`. */
  s3Cp(configure?: Configure<AwsS3CpSettings>): Promise<CommandOutput>;

  /** Sync a tree to, from or within S3: `aws s3 sync`. */
  s3Sync(configure?: Configure<AwsS3SyncSettings>): Promise<CommandOutput>;

  /** List buckets or objects: `aws s3 ls`. */
  s3Ls(configure?: Configure<AwsS3LsSettings>): Promise<CommandOutput>;

  /** Remove objects: `aws s3 rm`. */
  s3Rm(configure?: Configure<AwsS3RmSettings>): Promise<CommandOutput>;

  /** Make a bucket: `aws s3 mb`. */
  s3Mb(configure?: Configure<AwsS3MbSettings>): Promise<CommandOutput>;

  /** Print a presigned URL for an object: `aws s3 presign`. */
  s3Presign(
    configure?: Configure<AwsS3PresignSettings>,
  ): Promise<CommandOutput>;

  /** Print a registry password: `aws ecr get-login-password` (captured, never streamed). */
  ecrGetLoginPassword(
    configure?: Configure<AwsEcrGetLoginPasswordSettings>,
  ): Promise<CommandOutput>;

  /**
   * The ECR registry password, read back as a string, for
   * `docker login --password-stdin`.
   */
  ecrLoginPassword(
    configure?: Configure<AwsEcrGetLoginPasswordSettings>,
  ): Promise<string>;

  /** Describe a repository's images: `aws ecr describe-images`. */
  ecrDescribeImages(
    configure?: Configure<AwsEcrDescribeImagesSettings>,
  ): Promise<CommandOutput>;

  /** Describe repositories: `aws ecr describe-repositories`. */
  ecrDescribeRepositories(
    configure?: Configure<AwsEcrDescribeRepositoriesSettings>,
  ): Promise<CommandOutput>;

  /** Delete images: `aws ecr batch-delete-image`. */
  ecrBatchDeleteImage(
    configure?: Configure<AwsEcrBatchDeleteImageSettings>,
  ): Promise<CommandOutput>;

  /** Roll a service onto a task definition: `aws ecs update-service`. */
  ecsUpdateService(
    configure?: Configure<AwsEcsUpdateServiceSettings>,
  ): Promise<CommandOutput>;

  /** Describe services: `aws ecs describe-services`. */
  ecsDescribeServices(
    configure?: Configure<AwsEcsDescribeServicesSettings>,
  ): Promise<CommandOutput>;

  /** Block until services are stable: `aws ecs wait services-stable`. */
  ecsWaitServicesStable(
    configure?: Configure<AwsEcsWaitServicesStableSettings>,
  ): Promise<CommandOutput>;

  /** Register a task definition: `aws ecs register-task-definition`. */
  ecsRegisterTaskDefinition(
    configure?: Configure<AwsEcsRegisterTaskDefinitionSettings>,
  ): Promise<CommandOutput>;

  /** Start a one-off task: `aws ecs run-task`. */
  ecsRunTask(
    configure?: Configure<AwsEcsRunTaskSettings>,
  ): Promise<CommandOutput>;

  /** Ship new code: `aws lambda update-function-code`. */
  lambdaUpdateFunctionCode(
    configure?: Configure<AwsLambdaUpdateFunctionCodeSettings>,
  ): Promise<CommandOutput>;

  /** Change a function's settings: `aws lambda update-function-configuration`. */
  lambdaUpdateFunctionConfiguration(
    configure?: Configure<AwsLambdaUpdateFunctionConfigurationSettings>,
  ): Promise<CommandOutput>;

  /** Publish a version: `aws lambda publish-version`. */
  lambdaPublishVersion(
    configure?: Configure<AwsLambdaPublishVersionSettings>,
  ): Promise<CommandOutput>;

  /**
   * **Publish** a new version of the function — `aws lambda publish-version`,
   * which changes the account — and return the number it was given. Pins
   * `--query Version --output text`. Not a lookup: every call publishes.
   */
  lambdaPublishedVersion(
    configure?: Configure<AwsLambdaPublishVersionSettings>,
  ): Promise<string>;

  /** Move an alias: `aws lambda update-alias`. */
  lambdaUpdateAlias(
    configure?: Configure<AwsLambdaUpdateAliasSettings>,
  ): Promise<CommandOutput>;

  /** Describe a function: `aws lambda get-function`. */
  lambdaGetFunction(
    configure?: Configure<AwsLambdaGetFunctionSettings>,
  ): Promise<CommandOutput>;

  /** Invoke a function: `aws lambda invoke`. */
  lambdaInvoke(
    configure?: Configure<AwsLambdaInvokeSettings>,
  ): Promise<CommandOutput>;

  /** Create or update a stack: `aws cloudformation deploy`. */
  cloudformationDeploy(
    configure?: Configure<AwsCloudformationDeploySettings>,
  ): Promise<CommandOutput>;

  /** Describe stacks: `aws cloudformation describe-stacks`. */
  cloudformationDescribeStacks(
    configure?: Configure<AwsCloudformationDescribeStacksSettings>,
  ): Promise<CommandOutput>;

  /**
   * One output of a stack, read back as a string. Pins a `--query` projecting
   * that output and `--output json`; fails when the stack has no such output.
   */
  stackOutput(
    stack: string,
    key: string,
    configure?: Configure<AwsCloudformationDescribeStacksSettings>,
  ): Promise<string>;

  /** Delete a stack: `aws cloudformation delete-stack`. */
  cloudformationDeleteStack(
    configure?: Configure<AwsCloudformationDeleteStackSettings>,
  ): Promise<CommandOutput>;

  /** Block until a stack reaches a state: `aws cloudformation wait <waiter>`. */
  cloudformationWait(
    configure?: Configure<AwsCloudformationWaitSettings>,
  ): Promise<CommandOutput>;

  /** Read a secret: `aws secretsmanager get-secret-value` (captured, never streamed). */
  secretsmanagerGetSecretValue(
    configure?: Configure<AwsSecretsmanagerGetSecretValueSettings>,
  ): Promise<CommandOutput>;

  /**
   * A secret's `SecretString`, read back exactly — multi-line values and
   * surrounding whitespace included. Pins `--query SecretString --output
   * json`; fails for a binary secret.
   */
  secretString(
    configure?: Configure<AwsSecretsmanagerGetSecretValueSettings>,
  ): Promise<string>;

  /** Read a parameter: `aws ssm get-parameter` (captured, never streamed). */
  ssmGetParameter(
    configure?: Configure<AwsSsmGetParameterSettings>,
  ): Promise<CommandOutput>;

  /**
   * A parameter's value, read back exactly. Pins `--query Parameter.Value
   * --output json`; add `.withDecryption()` for a `SecureString`.
   */
  parameterValue(
    configure?: Configure<AwsSsmGetParameterSettings>,
  ): Promise<string>;

  /** Write a parameter: `aws ssm put-parameter`. */
  ssmPutParameter(
    configure?: Configure<AwsSsmPutParameterSettings>,
  ): Promise<CommandOutput>;

  /** Write a kubeconfig entry for a cluster: `aws eks update-kubeconfig`. */
  eksUpdateKubeconfig(
    configure?: Configure<AwsEksUpdateKubeconfigSettings>,
  ): Promise<CommandOutput>;

  /** Describe a cluster: `aws eks describe-cluster`. */
  eksDescribeCluster(
    configure?: Configure<AwsEksDescribeClusterSettings>,
  ): Promise<CommandOutput>;

  /** Read metric datapoints: `aws cloudwatch get-metric-data`. */
  cloudwatchGetMetricData(
    configure?: Configure<AwsCloudwatchGetMetricDataSettings>,
  ): Promise<CommandOutput>;

  /**
   * One number from CloudWatch: the latest datapoint of a series, or an
   * aggregate over the window. Pins `--query MetricDataResults --output
   * json`; fails on no data unless `.missingDataAs(value)` says what it
   * means.
   */
  metricValue(
    configure: Configure<AwsCloudwatchMetricValueSettings>,
  ): Promise<number>;

  /** Read metric statistics: `aws cloudwatch get-metric-statistics`. */
  cloudwatchGetMetricStatistics(
    configure?: Configure<AwsCloudwatchGetMetricStatisticsSettings>,
  ): Promise<CommandOutput>;

  /** Describe alarms: `aws cloudwatch describe-alarms`. */
  cloudwatchDescribeAlarms(
    configure?: Configure<AwsCloudwatchDescribeAlarmsSettings>,
  ): Promise<CommandOutput>;

  /** The state of one metric, composite or log alarm: `OK`, `ALARM` or `INSUFFICIENT_DATA`. */
  alarmState(
    name: string,
    configure?: Configure<AwsCloudwatchDescribeAlarmsSettings>,
  ): Promise<AwsCloudwatchAlarmState>;

  /** Start a Logs Insights query: `aws logs start-query`. */
  logsStartQuery(
    configure?: Configure<AwsLogsStartQuerySettings>,
  ): Promise<CommandOutput>;

  /** Read a Logs Insights query's results: `aws logs get-query-results`. */
  logsGetQueryResults(
    configure?: Configure<AwsLogsGetQueryResultsSettings>,
  ): Promise<CommandOutput>;

  /** Stop a running Logs Insights query: `aws logs stop-query`. */
  logsStopQuery(
    configure?: Configure<AwsLogsStopQuerySettings>,
  ): Promise<CommandOutput>;

  /**
   * Run a Logs Insights query to the end and return its rows: start it, poll
   * `get-query-results` until it is `Complete`, and fail with an
   * `AwsLogsQueryError` when it ends otherwise or outlasts the timeout.
   */
  logsInsightsQuery(
    configure: Configure<AwsLogsInsightsQuerySettings>,
  ): Promise<AwsLogsInsightsRow[]>;

  /** Search a log group's events: `aws logs filter-log-events`. */
  logsFilterLogEvents(
    configure?: Configure<AwsLogsFilterLogEventsSettings>,
  ): Promise<CommandOutput>;

  /** Print a log group's recent events: `aws logs tail`. */
  logsTail(configure?: Configure<AwsLogsTailSettings>): Promise<CommandOutput>;
}

/** `settings`, configured by `configure` when there is one. */
function configured<S>(settings: S, configure: Configure<S> | undefined): S {
  return configure ? configure(settings) : settings;
}

/** The JSON string a pinned `--query` projected, or a clear refusal. */
function jsonString(value: unknown, task: string, subject: string): string {
  if (typeof value !== "string") {
    throw new AwsOutputError(task, `the response carries no ${subject}.`);
  }
  return value;
}

/** Typed task functions for the `aws` CLI. */
export const AwsTasks: AwsTasksApi = {
  run: (c) => runSettings(new AwsSettings(), c),

  stsGetCallerIdentity: (c) =>
    runSettings(new AwsStsGetCallerIdentitySettings(), c),
  // Pinned after the caller's lambda: the reader promises an account id, so
  // the projection that produces one is not the caller's to replace.
  accountId: (c) =>
    scalarFrom(
      configured(new AwsStsGetCallerIdentitySettings(), c)
        .output("text").query(ACCOUNT_ID_QUERY),
      "AwsTasks.accountId",
      "account id",
    ),
  stsAssumeRole: (c) => runSettings(new AwsStsAssumeRoleSettings(), c),

  configureGet: (c) => runSettings(new AwsConfigureGetSettings(), c),
  configureSet: (c) => runSettings(new AwsConfigureSetSettings(), c),

  s3Cp: (c) => runSettings(new AwsS3CpSettings(), c),
  s3Sync: (c) => runSettings(new AwsS3SyncSettings(), c),
  s3Ls: (c) => runSettings(new AwsS3LsSettings(), c),
  s3Rm: (c) => runSettings(new AwsS3RmSettings(), c),
  s3Mb: (c) => runSettings(new AwsS3MbSettings(), c),
  s3Presign: (c) => runSettings(new AwsS3PresignSettings(), c),

  ecrGetLoginPassword: (c) =>
    runSettings(new AwsEcrGetLoginPasswordSettings(), c),
  ecrLoginPassword: (c) =>
    scalarFrom(
      configured(new AwsEcrGetLoginPasswordSettings(), c),
      "AwsTasks.ecrLoginPassword",
      "registry password",
    ),
  ecrDescribeImages: (c) => runSettings(new AwsEcrDescribeImagesSettings(), c),
  ecrDescribeRepositories: (c) =>
    runSettings(new AwsEcrDescribeRepositoriesSettings(), c),
  ecrBatchDeleteImage: (c) =>
    runSettings(new AwsEcrBatchDeleteImageSettings(), c),

  ecsUpdateService: (c) => runSettings(new AwsEcsUpdateServiceSettings(), c),
  ecsDescribeServices: (c) =>
    runSettings(new AwsEcsDescribeServicesSettings(), c),
  ecsWaitServicesStable: (c) =>
    runSettings(new AwsEcsWaitServicesStableSettings(), c),
  ecsRegisterTaskDefinition: (c) =>
    runSettings(new AwsEcsRegisterTaskDefinitionSettings(), c),
  ecsRunTask: (c) => runSettings(new AwsEcsRunTaskSettings(), c),

  lambdaUpdateFunctionCode: (c) =>
    runSettings(new AwsLambdaUpdateFunctionCodeSettings(), c),
  lambdaUpdateFunctionConfiguration: (c) =>
    runSettings(new AwsLambdaUpdateFunctionConfigurationSettings(), c),
  lambdaPublishVersion: (c) =>
    runSettings(new AwsLambdaPublishVersionSettings(), c),
  lambdaPublishedVersion: (c) =>
    scalarFrom(
      configured(new AwsLambdaPublishVersionSettings(), c)
        .output("text").query(FUNCTION_VERSION_QUERY),
      "AwsTasks.lambdaPublishedVersion",
      "version number",
    ),
  lambdaUpdateAlias: (c) => runSettings(new AwsLambdaUpdateAliasSettings(), c),
  lambdaGetFunction: (c) => runSettings(new AwsLambdaGetFunctionSettings(), c),
  lambdaInvoke: (c) => runSettings(new AwsLambdaInvokeSettings(), c),

  cloudformationDeploy: (c) =>
    runSettings(new AwsCloudformationDeploySettings(), c),
  cloudformationDescribeStacks: (c) =>
    runSettings(new AwsCloudformationDescribeStacksSettings(), c),
  stackOutput: async (stack, key, c) => {
    const task = "AwsTasks.stackOutput";
    const query = stackOutputQuery(key);
    const values = await jsonFrom(
      configured(new AwsCloudformationDescribeStacksSettings(), c)
        .stackName(stack),
      task,
      query,
    );
    if (!isStringArray(values)) {
      throw new AwsOutputError(task, "the stack's outputs are not a list.");
    }
    const [value] = values;
    if (value === undefined) {
      throw new AwsOutputError(
        task,
        `stack "${stack}" has no output "${key}".`,
      );
    }
    return value;
  },
  cloudformationDeleteStack: (c) =>
    runSettings(new AwsCloudformationDeleteStackSettings(), c),
  cloudformationWait: (c) =>
    runSettings(new AwsCloudformationWaitSettings(), c),

  secretsmanagerGetSecretValue: (c) =>
    runSettings(new AwsSecretsmanagerGetSecretValueSettings(), c),
  secretString: async (c) => {
    const task = "AwsTasks.secretString";
    const value = await jsonFrom(
      configured(new AwsSecretsmanagerGetSecretValueSettings(), c),
      task,
      SECRET_STRING_QUERY,
    );
    return jsonString(
      value,
      task,
      "SecretString — a binary secret keeps its value in SecretBinary",
    );
  },

  ssmGetParameter: (c) => runSettings(new AwsSsmGetParameterSettings(), c),
  parameterValue: async (c) => {
    const task = "AwsTasks.parameterValue";
    const value = await jsonFrom(
      configured(new AwsSsmGetParameterSettings(), c),
      task,
      PARAMETER_VALUE_QUERY,
    );
    return jsonString(value, task, "Parameter.Value");
  },
  ssmPutParameter: (c) => runSettings(new AwsSsmPutParameterSettings(), c),

  eksUpdateKubeconfig: (c) =>
    runSettings(new AwsEksUpdateKubeconfigSettings(), c),
  eksDescribeCluster: (c) =>
    runSettings(new AwsEksDescribeClusterSettings(), c),

  cloudwatchGetMetricData: (c) =>
    runSettings(new AwsCloudwatchGetMetricDataSettings(), c),
  metricValue: async (c) => {
    const settings = c(new AwsCloudwatchMetricValueSettings());
    const document = await jsonFrom(
      settings,
      "AwsTasks.metricValue",
      METRIC_DATA_RESULTS_QUERY,
    );
    return metricValueOf(document, settings);
  },
  cloudwatchGetMetricStatistics: (c) =>
    runSettings(new AwsCloudwatchGetMetricStatisticsSettings(), c),
  cloudwatchDescribeAlarms: (c) =>
    runSettings(new AwsCloudwatchDescribeAlarmsSettings(), c),
  alarmState: async (name, c) => {
    const alarms = await jsonFrom(
      configured(new AwsCloudwatchDescribeAlarmsSettings(), c)
        .alarmNames(name)
        .alarmTypes("MetricAlarm", "CompositeAlarm", "LogAlarm"),
      "AwsTasks.alarmState",
      ALARMS_QUERY,
    );
    return alarmStateOf(alarms, name);
  },

  logsStartQuery: (c) => runSettings(new AwsLogsStartQuerySettings(), c),
  logsGetQueryResults: (c) =>
    runSettings(new AwsLogsGetQueryResultsSettings(), c),
  logsStopQuery: (c) => runSettings(new AwsLogsStopQuerySettings(), c),
  logsInsightsQuery: (c) =>
    runLogsInsightsQuery(c(new AwsLogsInsightsQuerySettings())),
  logsFilterLogEvents: (c) =>
    runSettings(new AwsLogsFilterLogEventsSettings(), c),
  logsTail: (c) => runSettings(new AwsLogsTailSettings(), c),
};

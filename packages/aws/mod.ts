// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/aws` — typed AWS CLI tasks for Zuke builds, readers and a canary analysis.
 *
 * The `aws` CLI wrapper has typed settings for the deploy path (STS, S3, ECR,
 * ECS, Lambda, CloudFormation, Secrets Manager, SSM, EKS), CloudWatch and
 * CloudWatch Logs monitoring, readers that return a value, and a
 * `cloudwatch(...)` analysis for `@zuke/canary` rollouts.
 *
 * ```ts
 * import { AwsTasks, cloudwatch } from "@zuke/aws";
 *
 * const account = await AwsTasks.accountId((s) => s.profile("deploy"));
 * await AwsTasks.s3Sync((s) => s.source("dist").destination("s3://site"));
 * const errors = await AwsTasks.metricValue((s) =>
 *   s.metricStat("errors", (m) =>
 *     m.namespace("AWS/Lambda").metricName("Errors")
 *       .dimension("FunctionName", "api").stat("Sum")
 *   ).window("15m").aggregate("sum").missingDataAs(0)
 * );
 * ```
 *
 * The wrapper builds a discrete argv array (never a shell string), and every
 * settings class takes a `.runner(...)`, so a build's AWS steps are testable
 * without an account or the CLI.
 *
 * @module
 */

export * from "./src/aws.ts";
export {
  type AwsOutputFormat,
  type AwsSettingsRunner,
} from "./src/settings.ts";
export { AwsLogsQueryError, AwsOutputError } from "./src/errors.ts";
export {
  AwsStsAssumeRoleSettings,
  AwsStsGetCallerIdentitySettings,
} from "./src/sts.ts";
export {
  AwsConfigureGetSettings,
  AwsConfigureSetSettings,
} from "./src/configure.ts";
export {
  AwsS3CpSettings,
  AwsS3LsSettings,
  AwsS3MbSettings,
  AwsS3PresignSettings,
  AwsS3RmSettings,
  AwsS3SyncSettings,
} from "./src/s3.ts";
export {
  AwsEcrBatchDeleteImageSettings,
  AwsEcrDescribeImagesSettings,
  AwsEcrDescribeRepositoriesSettings,
  AwsEcrGetLoginPasswordSettings,
} from "./src/ecr.ts";
export {
  AwsEcsDescribeServicesSettings,
  AwsEcsRegisterTaskDefinitionSettings,
  AwsEcsRunTaskSettings,
  AwsEcsUpdateServiceSettings,
  AwsEcsWaitServicesStableSettings,
} from "./src/ecs.ts";
export {
  AwsLambdaGetFunctionSettings,
  AwsLambdaInvokeSettings,
  AwsLambdaPublishVersionSettings,
  AwsLambdaUpdateAliasSettings,
  AwsLambdaUpdateFunctionCodeSettings,
  AwsLambdaUpdateFunctionConfigurationSettings,
} from "./src/lambda.ts";
export {
  AwsCloudformationDeleteStackSettings,
  AwsCloudformationDeploySettings,
  AwsCloudformationDescribeStacksSettings,
  type AwsCloudformationStackWaiter,
  AwsCloudformationWaitSettings,
} from "./src/cloudformation.ts";
export { AwsSecretsmanagerGetSecretValueSettings } from "./src/secretsmanager.ts";
export {
  AwsSsmGetParameterSettings,
  type AwsSsmParameterType,
  AwsSsmPutParameterSettings,
} from "./src/ssm.ts";
export {
  AwsEksDescribeClusterSettings,
  AwsEksUpdateKubeconfigSettings,
} from "./src/eks.ts";
export {
  type AwsCloudwatchAlarmState,
  type AwsCloudwatchAlarmType,
  AwsCloudwatchDescribeAlarmsSettings,
  AwsCloudwatchGetMetricDataSettings,
  AwsCloudwatchGetMetricStatisticsSettings,
  type AwsTime,
} from "./src/cloudwatch.ts";
export {
  AwsCloudwatchExpressionSettings,
  AwsCloudwatchMetricStatSettings,
  type AwsCloudwatchStatistic,
} from "./src/metric_query.ts";
export {
  type AwsCloudwatchAggregate,
  AwsCloudwatchMetricValueSettings,
} from "./src/metric_value.ts";
export {
  AwsLogsFilterLogEventsSettings,
  AwsLogsGetQueryResultsSettings,
  AwsLogsStartQuerySettings,
  AwsLogsStopQuerySettings,
  AwsLogsTailSettings,
} from "./src/logs.ts";
export {
  AwsLogsInsightsQuerySettings,
  type AwsLogsInsightsRow,
} from "./src/logs_insights.ts";
export {
  type AwsCloudwatchAnalysis,
  type AwsCloudwatchAnalysisContext,
  AwsCloudwatchAnalysisSettings,
  cloudwatch,
} from "./src/cloudwatch_canary.ts";

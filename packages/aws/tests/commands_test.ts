// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import { missingTool } from "@zuke/core/tooling/conformance";
import {
  AwsCloudformationDeleteStackSettings,
  AwsCloudformationDeploySettings,
  AwsCloudformationDescribeStacksSettings,
  AwsCloudformationWaitSettings,
  AwsConfigureGetSettings,
  AwsConfigureSetSettings,
  AwsEcrBatchDeleteImageSettings,
  AwsEcrDescribeImagesSettings,
  AwsEcrDescribeRepositoriesSettings,
  AwsEcrGetLoginPasswordSettings,
  AwsEcsDescribeServicesSettings,
  AwsEcsRegisterTaskDefinitionSettings,
  AwsEcsRunTaskSettings,
  AwsEcsUpdateServiceSettings,
  AwsEcsWaitServicesStableSettings,
  AwsEksDescribeClusterSettings,
  AwsEksUpdateKubeconfigSettings,
  AwsLambdaGetFunctionSettings,
  AwsLambdaInvokeSettings,
  AwsLambdaPublishVersionSettings,
  AwsLambdaUpdateAliasSettings,
  AwsLambdaUpdateFunctionCodeSettings,
  AwsLambdaUpdateFunctionConfigurationSettings,
  AwsS3CpSettings,
  AwsS3LsSettings,
  AwsS3MbSettings,
  AwsS3PresignSettings,
  AwsS3RmSettings,
  AwsS3SyncSettings,
  AwsSecretsmanagerGetSecretValueSettings,
  AwsSsmGetParameterSettings,
  AwsSsmPutParameterSettings,
  AwsStsAssumeRoleSettings,
  AwsStsGetCallerIdentitySettings,
  AwsTasks,
} from "../mod.ts";

/** The argv after the binary. */
function args(settings: { argv(): string[] }): string[] {
  return settings.argv().slice(1);
}

Deno.test("sts get-caller-identity", () => {
  assertEquals(args(new AwsStsGetCallerIdentitySettings()), [
    "sts",
    "get-caller-identity",
  ]);
});

Deno.test("sts assume-role with every option", () => {
  assertEquals(
    args(
      new AwsStsAssumeRoleSettings()
        .roleArn("arn:aws:iam::1:role/deploy").roleSessionName("ci")
        .durationSeconds(900).externalId("ext").policy("{}")
        .serialNumber("arn:aws:iam::1:mfa/me").tokenCode("123456"),
    ),
    [
      "sts",
      "assume-role",
      "--role-arn=arn:aws:iam::1:role/deploy",
      "--role-session-name=ci",
      "--duration-seconds=900",
      "--external-id=ext",
      "--policy={}",
      "--serial-number=arn:aws:iam::1:mfa/me",
      "--token-code=123456",
      "--output",
      "json",
    ],
  );
  assertThrows(
    () => new AwsStsAssumeRoleSettings().roleArn("r").argv(),
    Error,
    "roleSessionName",
  );
});

Deno.test("configure get and set", () => {
  assertEquals(
    args(new AwsConfigureGetSettings().varname("region").profile("p")),
    ["configure", "get", "region", "--profile", "p"],
  );
  assertEquals(
    args(new AwsConfigureSetSettings().varname("region").value("eu-west-1")),
    ["configure", "set", "region", "eu-west-1"],
  );
  assertThrows(() => new AwsConfigureGetSettings().argv(), Error, "varname");
  assertThrows(
    () => new AwsConfigureSetSettings().varname("region").argv(),
    Error,
    ".value(",
  );
});

/** Settings that record what they register with the run's redactor. */
class RecordingConfigureSet extends AwsConfigureSetSettings {
  readonly marked: string[] = [];
  protected override markSecret(value: string): void {
    this.marked.push(value);
  }
}

Deno.test("configure set registers a credential value as a secret", () => {
  const secret = new RecordingConfigureSet()
    .value("example-secret-key").varname("AWS_SECRET_ACCESS_KEY");
  assertEquals(secret.marked, ["example-secret-key"]);
  const token = new RecordingConfigureSet()
    .varname("aws_session_token").value("FwoGZXIvYXdz");
  assertEquals(token.marked, ["FwoGZXIvYXdz"]);
  const plain = new RecordingConfigureSet().varname("region").value(
    "us-east-1",
  );
  assertEquals(plain.marked, []);
});

Deno.test("s3 cp keeps filters in call order", () => {
  assertEquals(
    args(
      new AwsS3CpSettings().source("dist").destination("s3://b/app")
        .recursive().exclude("*").include("*.js").dryrun().acl("private")
        .contentType("text/javascript").cacheControl("max-age=60")
        .storageClass("STANDARD_IA").sse("aws:kms").sseKmsKeyId("key")
        .onlyShowErrors().noProgress(),
    ),
    [
      "s3",
      "cp",
      "dist",
      "s3://b/app",
      "--recursive",
      "--exclude=*",
      "--include=*.js",
      "--dryrun",
      "--acl=private",
      "--content-type=text/javascript",
      "--cache-control=max-age=60",
      "--storage-class=STANDARD_IA",
      "--sse=aws:kms",
      "--sse-kms-key-id=key",
      "--only-show-errors",
      "--no-progress",
    ],
  );
  assertEquals(args(new AwsS3CpSettings().source("a").destination("s3://b")), [
    "s3",
    "cp",
    "a",
    "s3://b",
  ]);
  assertThrows(() => new AwsS3CpSettings().source("a").argv(), Error, "both");
});

Deno.test("s3 sync with every option", () => {
  assertEquals(
    args(
      new AwsS3SyncSettings().source("dist").destination("s3://b").delete()
        .exclude("*.map").include("a.map").dryrun().exactTimestamps()
        .sizeOnly().acl("public-read").contentType("text/html")
        .cacheControl("no-cache").storageClass("STANDARD").onlyShowErrors()
        .noProgress(),
    ),
    [
      "s3",
      "sync",
      "dist",
      "s3://b",
      "--delete",
      "--exclude=*.map",
      "--include=a.map",
      "--dryrun",
      "--exact-timestamps",
      "--size-only",
      "--acl=public-read",
      "--content-type=text/html",
      "--cache-control=no-cache",
      "--storage-class=STANDARD",
      "--only-show-errors",
      "--no-progress",
    ],
  );
  assertEquals(args(new AwsS3SyncSettings().source("a").destination("b")), [
    "s3",
    "sync",
    "a",
    "b",
  ]);
  assertThrows(() => new AwsS3SyncSettings().argv(), Error, "both");
});

Deno.test("s3 ls, rm, mb and presign", () => {
  assertEquals(args(new AwsS3LsSettings()), ["s3", "ls"]);
  assertEquals(
    args(
      new AwsS3LsSettings().path("s3://b/p/").recursive().humanReadable()
        .summarize(),
    ),
    [
      "s3",
      "ls",
      "s3://b/p/",
      "--recursive",
      "--human-readable",
      "--summarize",
    ],
  );
  assertEquals(
    args(
      new AwsS3RmSettings().path("s3://b/p/").recursive().exclude("keep/*")
        .include("keep/old").dryrun(),
    ),
    [
      "s3",
      "rm",
      "s3://b/p/",
      "--recursive",
      "--exclude=keep/*",
      "--include=keep/old",
      "--dryrun",
    ],
  );
  assertEquals(args(new AwsS3RmSettings().path("s3://b/k")), [
    "s3",
    "rm",
    "s3://b/k",
  ]);
  assertThrows(() => new AwsS3RmSettings().argv(), Error, "nothing to remove");
  assertEquals(args(new AwsS3MbSettings().bucket("s3://new")), [
    "s3",
    "mb",
    "s3://new",
  ]);
  assertThrows(() => new AwsS3MbSettings().argv(), Error, "bucket");
  assertEquals(
    args(new AwsS3PresignSettings().path("s3://b/k").expiresIn(300)),
    ["s3", "presign", "s3://b/k", "--expires-in=300"],
  );
  assertEquals(args(new AwsS3PresignSettings().path("s3://b/k")), [
    "s3",
    "presign",
    "s3://b/k",
  ]);
  assertThrows(() => new AwsS3PresignSettings().argv(), Error, "object");
});

Deno.test("ecr commands send image ids as JSON", () => {
  assertEquals(args(new AwsEcrGetLoginPasswordSettings().region("eu-west-1")), [
    "ecr",
    "get-login-password",
    "--region",
    "eu-west-1",
  ]);
  assertEquals(
    args(
      new AwsEcrDescribeImagesSettings().repositoryName("api").registryId("1")
        .imageTag("v1,imageTag=x").imageDigest("sha256:ab").tagStatus("TAGGED"),
    ),
    [
      "ecr",
      "describe-images",
      "--repository-name=api",
      "--registry-id=1",
      "--image-ids",
      '[{"imageTag":"v1,imageTag=x"},{"imageDigest":"sha256:ab"}]',
      '--filter={"tagStatus":"TAGGED"}',
    ],
  );
  assertEquals(args(new AwsEcrDescribeImagesSettings().repositoryName("api")), [
    "ecr",
    "describe-images",
    "--repository-name=api",
  ]);
  assertThrows(
    () => new AwsEcrDescribeImagesSettings().argv(),
    Error,
    "repositoryName",
  );
  assertEquals(args(new AwsEcrDescribeRepositoriesSettings()), [
    "ecr",
    "describe-repositories",
  ]);
  assertEquals(
    args(
      new AwsEcrDescribeRepositoriesSettings().repositoryNames("a", "b")
        .registryId("1"),
    ),
    [
      "ecr",
      "describe-repositories",
      "--repository-names",
      "a",
      "b",
      "--registry-id=1",
    ],
  );
  assertEquals(
    args(
      new AwsEcrBatchDeleteImageSettings().repositoryName("api")
        .imageTag("old").imageDigest("sha256:cd").registryId("1"),
    ),
    [
      "ecr",
      "batch-delete-image",
      "--repository-name=api",
      "--image-ids",
      '[{"imageTag":"old"},{"imageDigest":"sha256:cd"}]',
      "--registry-id=1",
    ],
  );
  assertEquals(
    args(
      new AwsEcrBatchDeleteImageSettings().repositoryName("api").imageTag("o"),
    ).length,
    5,
  );
  assertThrows(
    () => new AwsEcrBatchDeleteImageSettings().repositoryName("api").argv(),
    Error,
    "at least one image",
  );
});

Deno.test("ecs update-service, describe-services and wait", () => {
  assertEquals(
    args(
      new AwsEcsUpdateServiceSettings().cluster("prod").service("api")
        .taskDefinition("api:42").desiredCount(3).forceNewDeployment()
        .healthCheckGracePeriodSeconds(60),
    ),
    [
      "ecs",
      "update-service",
      "--cluster=prod",
      "--service=api",
      "--task-definition=api:42",
      "--desired-count=3",
      "--force-new-deployment",
      "--health-check-grace-period-seconds=60",
    ],
  );
  assertEquals(args(new AwsEcsUpdateServiceSettings().service("api")), [
    "ecs",
    "update-service",
    "--service=api",
  ]);
  assertThrows(
    () => new AwsEcsUpdateServiceSettings().argv(),
    Error,
    "service",
  );
  assertEquals(
    args(new AwsEcsDescribeServicesSettings().cluster("c").services("a", "b")),
    ["ecs", "describe-services", "--cluster=c", "--services", "a", "b"],
  );
  assertEquals(
    args(new AwsEcsWaitServicesStableSettings().services("api")),
    ["ecs", "wait", "services-stable", "--services", "api"],
  );
  assertEquals(
    args(new AwsEcsWaitServicesStableSettings().cluster("c").services("api")),
    ["ecs", "wait", "services-stable", "--cluster=c", "--services", "api"],
  );
  assertThrows(
    () => new AwsEcsDescribeServicesSettings().argv(),
    Error,
    "AwsTasks.ecsDescribeServices",
  );
  assertThrows(
    () => new AwsEcsWaitServicesStableSettings().cluster("c").argv(),
    Error,
    "AwsTasks.ecsWaitServicesStable",
  );
});

Deno.test("ecs register-task-definition and run-task", () => {
  assertEquals(
    args(
      new AwsEcsRegisterTaskDefinitionSettings()
        .cliInputJson("file://taskdef.json"),
    ),
    [
      "ecs",
      "register-task-definition",
      "--cli-input-json=file://taskdef.json",
    ],
  );
  assertEquals(
    args(
      new AwsEcsRegisterTaskDefinitionSettings().family("api")
        .containerDefinitions("[]").taskRoleArn("t").executionRoleArn("e")
        .networkMode("awsvpc").requiresCompatibilities("FARGATE").cpu("256")
        .memory("512"),
    ),
    [
      "ecs",
      "register-task-definition",
      "--family=api",
      "--container-definitions=[]",
      "--task-role-arn=t",
      "--execution-role-arn=e",
      "--network-mode=awsvpc",
      "--requires-compatibilities",
      "FARGATE",
      "--cpu=256",
      "--memory=512",
    ],
  );
  assertThrows(
    () => new AwsEcsRegisterTaskDefinitionSettings().argv(),
    Error,
    "nothing to register",
  );
  assertEquals(
    args(
      new AwsEcsRunTaskSettings().cluster("prod").taskDefinition("migrate:3")
        .count(1).launchType("FARGATE").networkConfiguration("{}")
        .overrides("{}").startedBy("zuke").group("migrations"),
    ),
    [
      "ecs",
      "run-task",
      "--cluster=prod",
      "--task-definition=migrate:3",
      "--count=1",
      "--launch-type=FARGATE",
      "--network-configuration={}",
      "--overrides={}",
      "--started-by=zuke",
      "--group=migrations",
    ],
  );
  assertEquals(args(new AwsEcsRunTaskSettings().taskDefinition("m")), [
    "ecs",
    "run-task",
    "--task-definition=m",
  ]);
  assertThrows(
    () => new AwsEcsRunTaskSettings().argv(),
    Error,
    "taskDefinition",
  );
});

Deno.test("lambda update-function-code takes exactly one source", () => {
  assertEquals(
    args(
      new AwsLambdaUpdateFunctionCodeSettings().functionName("api")
        .zipFile("dist/api.zip").publish().dryRun().revisionId("r")
        .architectures("arm64"),
    ),
    [
      "lambda",
      "update-function-code",
      "--function-name=api",
      "--zip-file=fileb://dist/api.zip",
      "--publish",
      "--dry-run",
      "--revision-id=r",
      "--architectures",
      "arm64",
    ],
  );
  assertEquals(
    args(
      new AwsLambdaUpdateFunctionCodeSettings().functionName("api")
        .zipFile("fileb://a.zip"),
    ).slice(3),
    ["--zip-file=fileb://a.zip"],
  );
  assertEquals(
    args(
      new AwsLambdaUpdateFunctionCodeSettings().functionName("api")
        .s3Bucket("b").s3Key("k").s3ObjectVersion("v"),
    ).slice(3),
    ["--s3-bucket=b", "--s3-key=k", "--s3-object-version=v"],
  );
  assertEquals(
    args(
      new AwsLambdaUpdateFunctionCodeSettings().functionName("api")
        .imageUri("1.dkr.ecr/api:1"),
    ).slice(3),
    ["--image-uri=1.dkr.ecr/api:1"],
  );
  assertThrows(
    () =>
      new AwsLambdaUpdateFunctionCodeSettings().functionName("api")
        .zipFile("a.zip").imageUri("i").argv(),
    Error,
    "exactly one source",
  );
  assertThrows(
    () => new AwsLambdaUpdateFunctionCodeSettings().zipFile("a.zip").argv(),
    Error,
    "AwsTasks.lambdaUpdateFunctionCode: no function named",
  );
});

Deno.test("lambda update-function-configuration sends the environment as JSON", () => {
  assertEquals(
    args(
      new AwsLambdaUpdateFunctionConfigurationSettings().functionName("api")
        .environment({ STAGE: "prod", A: "b c" }).timeout(30).memorySize(512)
        .handler("index.handler").runtime("nodejs22.x").role("arn:role")
        .description("api").layers("arn:l:1", "arn:l:2"),
    ),
    [
      "lambda",
      "update-function-configuration",
      "--function-name=api",
      '--environment={"Variables":{"STAGE":"prod","A":"b c"}}',
      "--timeout=30",
      "--memory-size=512",
      "--handler=index.handler",
      "--runtime=nodejs22.x",
      "--role=arn:role",
      "--description=api",
      "--layers",
      "arn:l:1",
      "arn:l:2",
    ],
  );
  assertEquals(
    args(
      new AwsLambdaUpdateFunctionConfigurationSettings().functionName("api"),
    ),
    ["lambda", "update-function-configuration", "--function-name=api"],
  );
});

Deno.test("lambda publish-version, get-function and update-alias", () => {
  assertEquals(
    args(
      new AwsLambdaPublishVersionSettings().functionName("api")
        .description("v").codeSha256("abc").revisionId("r"),
    ),
    [
      "lambda",
      "publish-version",
      "--function-name=api",
      "--description=v",
      "--code-sha256=abc",
      "--revision-id=r",
    ],
  );
  assertEquals(
    args(new AwsLambdaGetFunctionSettings().functionName("api").qualifier("7")),
    ["lambda", "get-function", "--function-name=api", "--qualifier=7"],
  );
  assertEquals(
    args(new AwsLambdaGetFunctionSettings().functionName("api")),
    ["lambda", "get-function", "--function-name=api"],
  );
  assertEquals(
    args(
      new AwsLambdaUpdateAliasSettings().functionName("api").name("live")
        .functionVersion("6").description("d").additionalVersionWeight(
          "7",
          0.1,
        ),
    ),
    [
      "lambda",
      "update-alias",
      "--function-name=api",
      "--name=live",
      "--function-version=6",
      "--description=d",
      '--routing-config={"AdditionalVersionWeights":{"7":0.1}}',
    ],
  );
  assertEquals(
    args(
      new AwsLambdaUpdateAliasSettings().functionName("api").name("live")
        .additionalVersionWeight("7", 0.1).clearRouting(),
    ).slice(4),
    ['--routing-config={"AdditionalVersionWeights":{}}'],
  );
  assertEquals(
    args(new AwsLambdaUpdateAliasSettings().functionName("api").name("live")),
    ["lambda", "update-alias", "--function-name=api", "--name=live"],
  );
  assertThrows(
    () => new AwsLambdaUpdateAliasSettings().functionName("api").argv(),
    Error,
    "no alias named",
  );
});

Deno.test("lambda invoke sends a raw JSON payload and ends with the outfile", () => {
  assertEquals(
    args(
      new AwsLambdaInvokeSettings().functionName("api").payload('{"a":1}')
        .invocationType("RequestResponse").logType("Tail").qualifier("live")
        .outfile("out.json").region("eu-west-1"),
    ),
    [
      "lambda",
      "invoke",
      "--function-name=api",
      "--cli-binary-format=raw-in-base64-out",
      '--payload={"a":1}',
      "--invocation-type=RequestResponse",
      "--log-type=Tail",
      "--qualifier=live",
      "out.json",
      "--region",
      "eu-west-1",
    ],
  );
  assertEquals(
    args(new AwsLambdaInvokeSettings().functionName("api").outfile("o")),
    ["lambda", "invoke", "--function-name=api", "o"],
  );
  assertThrows(
    () => new AwsLambdaInvokeSettings().functionName("api").argv(),
    Error,
    "outfile",
  );
});

Deno.test("cloudformation deploy with every option", () => {
  assertEquals(
    args(
      new AwsCloudformationDeploySettings().templateFile("stack.yaml")
        .stackName("api").parameterOverride("Image", "repo:tag=v1")
        .parameterOverride("Env", "prod").capabilities("CAPABILITY_IAM")
        .tag("team", "web").noExecuteChangeset().noFailOnEmptyChangeset()
        .roleArn("arn:role").s3Bucket("b").s3Prefix("p").kmsKeyId("k"),
    ),
    [
      "cloudformation",
      "deploy",
      "--template-file=stack.yaml",
      "--stack-name=api",
      "--parameter-overrides",
      "Image=repo:tag=v1",
      "Env=prod",
      "--capabilities",
      "CAPABILITY_IAM",
      "--tags",
      "team=web",
      "--no-execute-changeset",
      "--no-fail-on-empty-changeset",
      "--role-arn=arn:role",
      "--s3-bucket=b",
      "--s3-prefix=p",
      "--kms-key-id=k",
    ],
  );
  assertEquals(
    args(
      new AwsCloudformationDeploySettings().templateFile("t").stackName("s"),
    ),
    ["cloudformation", "deploy", "--template-file=t", "--stack-name=s"],
  );
  assertThrows(
    () => new AwsCloudformationDeploySettings().templateFile("t").argv(),
    Error,
    "stackName",
  );
  assertThrows(
    () =>
      new AwsCloudformationDeploySettings().templateFile("t").stackName("s")
        .parameterOverride("A=B", "c").argv(),
    Error,
    "first '='",
  );
  assertThrows(
    () =>
      new AwsCloudformationDeploySettings().templateFile("t").stackName("s")
        .tag("", "c").argv(),
    Error,
    "--tags",
  );
});

Deno.test("cloudformation describe-stacks, delete-stack and wait", () => {
  assertEquals(args(new AwsCloudformationDescribeStacksSettings()), [
    "cloudformation",
    "describe-stacks",
  ]);
  assertEquals(
    args(new AwsCloudformationDescribeStacksSettings().stackName("api")),
    ["cloudformation", "describe-stacks", "--stack-name=api"],
  );
  assertEquals(
    args(
      new AwsCloudformationDeleteStackSettings().stackName("api")
        .roleArn("arn:role").retainResources("Bucket", "Table"),
    ),
    [
      "cloudformation",
      "delete-stack",
      "--stack-name=api",
      "--role-arn=arn:role",
      "--retain-resources",
      "Bucket",
      "Table",
    ],
  );
  assertEquals(
    args(new AwsCloudformationDeleteStackSettings().stackName("api")),
    ["cloudformation", "delete-stack", "--stack-name=api"],
  );
  assertThrows(
    () => new AwsCloudformationDeleteStackSettings().argv(),
    Error,
    "stackName",
  );
  assertEquals(
    args(
      new AwsCloudformationWaitSettings().waiter("stack-update-complete")
        .stackName("api"),
    ),
    ["cloudformation", "wait", "stack-update-complete", "--stack-name=api"],
  );
  assertThrows(
    () => new AwsCloudformationWaitSettings().stackName("api").argv(),
    Error,
    "waiter",
  );
});

Deno.test("secretsmanager get-secret-value", () => {
  assertEquals(
    args(
      new AwsSecretsmanagerGetSecretValueSettings().secretId("prod/db")
        .versionId("v").versionStage("AWSPREVIOUS"),
    ),
    [
      "secretsmanager",
      "get-secret-value",
      "--secret-id=prod/db",
      "--version-id=v",
      "--version-stage=AWSPREVIOUS",
      "--output",
      "json",
    ],
  );
  assertEquals(
    args(new AwsSecretsmanagerGetSecretValueSettings().secretId("s")),
    ["secretsmanager", "get-secret-value", "--secret-id=s", "--output", "json"],
  );
  assertThrows(
    () => new AwsSecretsmanagerGetSecretValueSettings().argv(),
    Error,
    "secretId",
  );
});

Deno.test("ssm get-parameter and put-parameter", () => {
  assertEquals(
    args(new AwsSsmGetParameterSettings().name("/a").withDecryption()),
    [
      "ssm",
      "get-parameter",
      "--name=/a",
      "--with-decryption",
      "--output",
      "json",
    ],
  );
  assertEquals(args(new AwsSsmGetParameterSettings().name("/a")), [
    "ssm",
    "get-parameter",
    "--name=/a",
    "--output",
    "json",
  ]);
  assertThrows(() => new AwsSsmGetParameterSettings().argv(), Error, "name");
  assertEquals(
    args(
      new AwsSsmPutParameterSettings().name("/a").valueFile("token.txt")
        .type("SecureString").overwrite().keyId("alias/k").description("d")
        .tier("Advanced").dataType("text"),
    ),
    [
      "ssm",
      "put-parameter",
      "--name=/a",
      "--value=file://token.txt",
      "--type=SecureString",
      "--overwrite",
      "--key-id=alias/k",
      "--description=d",
      "--tier=Advanced",
      "--data-type=text",
    ],
  );
  assertEquals(
    args(new AwsSsmPutParameterSettings().name("/a").value("v")),
    ["ssm", "put-parameter", "--name=/a", "--value=v"],
  );
  // A value starting with a hyphen stays a value, not the next option.
  assertEquals(
    args(
      new AwsSsmPutParameterSettings().name("/a").value("-starts-with-dash"),
    ),
    ["ssm", "put-parameter", "--name=/a", "--value=-starts-with-dash"],
  );
  assertThrows(
    () => new AwsSsmPutParameterSettings().name("/a").argv(),
    Error,
    "valueFile",
  );
});

Deno.test("ssm put-parameter refuses a literal value the CLI would read as a file", () => {
  for (const value of ["file:///etc/passwd", "fileb://key.bin"]) {
    assertThrows(
      () => new AwsSsmPutParameterSettings().value(value),
      Error,
      "file://",
    );
  }
});

/** Put-parameter settings that record what they register as secret. */
class RecordingPut extends AwsSsmPutParameterSettings {
  readonly marked: string[] = [];
  protected override markSecret(value: string): void {
    this.marked.push(value);
  }
}

Deno.test("ssm put-parameter registers a literal SecureString value", () => {
  assertEquals(
    new RecordingPut().value("s3cr3t-value").type("SecureString").marked,
    ["s3cr3t-value"],
  );
  assertEquals(
    new RecordingPut().type("SecureString").value("s3cr3t-value").marked,
    ["s3cr3t-value"],
  );
  assertEquals(new RecordingPut().type("String").value("plain").marked, []);
  // A file path is not the secret, and is not registered as one.
  assertEquals(
    new RecordingPut().valueFile("token.txt").type("SecureString").marked,
    [],
  );
});

Deno.test("eks update-kubeconfig and describe-cluster", () => {
  assertEquals(
    args(
      new AwsEksUpdateKubeconfigSettings().name("prod").kubeconfig("kc")
        .alias("prod").userAlias("ci").roleArn("arn:role").dryRun()
        .region("eu-west-1"),
    ),
    [
      "eks",
      "update-kubeconfig",
      "--name=prod",
      "--kubeconfig=kc",
      "--alias=prod",
      "--user-alias=ci",
      "--role-arn=arn:role",
      "--dry-run",
      "--region",
      "eu-west-1",
    ],
  );
  assertEquals(args(new AwsEksUpdateKubeconfigSettings().name("p")), [
    "eks",
    "update-kubeconfig",
    "--name=p",
  ]);
  assertThrows(
    () => new AwsEksUpdateKubeconfigSettings().argv(),
    Error,
    "name",
  );
  assertEquals(args(new AwsEksDescribeClusterSettings().name("p")), [
    "eks",
    "describe-cluster",
    "--name=p",
  ]);
  assertThrows(() => new AwsEksDescribeClusterSettings().argv(), Error, "name");
});

/**
 * Every task, with the minimum configuration its settings demand, pointed at
 * a binary that cannot exist. Each proves the task reaches execution — a
 * settings class that never runs would pass its argv test while being
 * unreachable through `AwsTasks`.
 */
const REACH: Array<[string, () => Promise<unknown>]> = [
  ["stsGetCallerIdentity", () => AwsTasks.stsGetCallerIdentity(missingTool)],
  ["accountId", () => AwsTasks.accountId(missingTool)],
  [
    "stsAssumeRole",
    () =>
      AwsTasks.stsAssumeRole((s) =>
        missingTool(s.roleArn("r").roleSessionName("n"))
      ),
  ],
  [
    "configureGet",
    () => AwsTasks.configureGet((s) => missingTool(s.varname("region"))),
  ],
  [
    "configureSet",
    () =>
      AwsTasks.configureSet((s) => missingTool(s.varname("region").value("x"))),
  ],
  [
    "s3Cp",
    () =>
      AwsTasks.s3Cp((s) => missingTool(s.source("a").destination("s3://b"))),
  ],
  [
    "s3Sync",
    () =>
      AwsTasks.s3Sync((s) => missingTool(s.source("a").destination("s3://b"))),
  ],
  ["s3Ls", () => AwsTasks.s3Ls(missingTool)],
  ["s3Rm", () => AwsTasks.s3Rm((s) => missingTool(s.path("s3://b/k")))],
  ["s3Mb", () => AwsTasks.s3Mb((s) => missingTool(s.bucket("s3://b")))],
  [
    "s3Presign",
    () => AwsTasks.s3Presign((s) => missingTool(s.path("s3://b/k"))),
  ],
  ["ecrGetLoginPassword", () => AwsTasks.ecrGetLoginPassword(missingTool)],
  ["ecrLoginPassword", () => AwsTasks.ecrLoginPassword(missingTool)],
  [
    "ecrDescribeImages",
    () => AwsTasks.ecrDescribeImages((s) => missingTool(s.repositoryName("a"))),
  ],
  [
    "ecrDescribeRepositories",
    () => AwsTasks.ecrDescribeRepositories(missingTool),
  ],
  [
    "ecrBatchDeleteImage",
    () =>
      AwsTasks.ecrBatchDeleteImage((s) =>
        missingTool(s.repositoryName("a").imageTag("t"))
      ),
  ],
  [
    "ecsUpdateService",
    () => AwsTasks.ecsUpdateService((s) => missingTool(s.service("api"))),
  ],
  [
    "ecsDescribeServices",
    () => AwsTasks.ecsDescribeServices((s) => missingTool(s.services("api"))),
  ],
  [
    "ecsWaitServicesStable",
    () => AwsTasks.ecsWaitServicesStable((s) => missingTool(s.services("api"))),
  ],
  [
    "ecsRegisterTaskDefinition",
    () =>
      AwsTasks.ecsRegisterTaskDefinition((s) =>
        missingTool(s.cliInputJson("file://t.json"))
      ),
  ],
  [
    "ecsRunTask",
    () => AwsTasks.ecsRunTask((s) => missingTool(s.taskDefinition("t"))),
  ],
  [
    "lambdaUpdateFunctionCode",
    () =>
      AwsTasks.lambdaUpdateFunctionCode((s) =>
        missingTool(s.functionName("f").zipFile("a.zip"))
      ),
  ],
  [
    "lambdaUpdateFunctionConfiguration",
    () =>
      AwsTasks.lambdaUpdateFunctionConfiguration((s) =>
        missingTool(s.functionName("f"))
      ),
  ],
  [
    "lambdaPublishVersion",
    () =>
      AwsTasks.lambdaPublishVersion((s) => missingTool(s.functionName("f"))),
  ],
  [
    "lambdaPublishedVersion",
    () =>
      AwsTasks.lambdaPublishedVersion((s) => missingTool(s.functionName("f"))),
  ],
  [
    "lambdaUpdateAlias",
    () =>
      AwsTasks.lambdaUpdateAlias((s) =>
        missingTool(s.functionName("f").name("live"))
      ),
  ],
  [
    "lambdaGetFunction",
    () => AwsTasks.lambdaGetFunction((s) => missingTool(s.functionName("f"))),
  ],
  [
    "lambdaInvoke",
    () =>
      AwsTasks.lambdaInvoke((s) =>
        missingTool(s.functionName("f").outfile("o"))
      ),
  ],
  [
    "cloudformationDeploy",
    () =>
      AwsTasks.cloudformationDeploy((s) =>
        missingTool(s.templateFile("t").stackName("s"))
      ),
  ],
  [
    "cloudformationDescribeStacks",
    () => AwsTasks.cloudformationDescribeStacks(missingTool),
  ],
  ["stackOutput", () => AwsTasks.stackOutput("s", "Url", missingTool)],
  [
    "cloudformationDeleteStack",
    () =>
      AwsTasks.cloudformationDeleteStack((s) => missingTool(s.stackName("s"))),
  ],
  [
    "cloudformationWait",
    () =>
      AwsTasks.cloudformationWait((s) =>
        missingTool(s.waiter("stack-create-complete").stackName("s"))
      ),
  ],
  [
    "secretsmanagerGetSecretValue",
    () =>
      AwsTasks.secretsmanagerGetSecretValue((s) =>
        missingTool(s.secretId("x"))
      ),
  ],
  [
    "secretString",
    () => AwsTasks.secretString((s) => missingTool(s.secretId("x"))),
  ],
  [
    "ssmGetParameter",
    () => AwsTasks.ssmGetParameter((s) => missingTool(s.name("/a"))),
  ],
  [
    "parameterValue",
    () => AwsTasks.parameterValue((s) => missingTool(s.name("/a"))),
  ],
  [
    "ssmPutParameter",
    () => AwsTasks.ssmPutParameter((s) => missingTool(s.name("/a").value("v"))),
  ],
  [
    "eksUpdateKubeconfig",
    () => AwsTasks.eksUpdateKubeconfig((s) => missingTool(s.name("c"))),
  ],
  [
    "eksDescribeCluster",
    () => AwsTasks.eksDescribeCluster((s) => missingTool(s.name("c"))),
  ],
  [
    "cloudwatchGetMetricData",
    () =>
      AwsTasks.cloudwatchGetMetricData((s) =>
        missingTool(s.expression("e", "1").window("5m"))
      ),
  ],
  [
    "metricValue",
    () =>
      AwsTasks.metricValue((s) =>
        missingTool(s.expression("e", "1").window("5m"))
      ),
  ],
  [
    "cloudwatchGetMetricStatistics",
    () =>
      AwsTasks.cloudwatchGetMetricStatistics((s) =>
        missingTool(
          s.namespace("n").metricName("m").window("1h").period(60)
            .statistics("Sum"),
        )
      ),
  ],
  [
    "cloudwatchDescribeAlarms",
    () => AwsTasks.cloudwatchDescribeAlarms(missingTool),
  ],
  ["alarmState", () => AwsTasks.alarmState("a", missingTool)],
  [
    "logsStartQuery",
    () =>
      AwsTasks.logsStartQuery((s) =>
        missingTool(s.logGroupNames("g").queryString("q").window("5m"))
      ),
  ],
  [
    "logsGetQueryResults",
    () => AwsTasks.logsGetQueryResults((s) => missingTool(s.queryId("q"))),
  ],
  [
    "logsStopQuery",
    () => AwsTasks.logsStopQuery((s) => missingTool(s.queryId("q"))),
  ],
  [
    "logsInsightsQuery",
    () =>
      AwsTasks.logsInsightsQuery((q) =>
        q.logGroupNames("g").queryString("q").window("5m").aws(missingTool)
      ),
  ],
  [
    "logsFilterLogEvents",
    () => AwsTasks.logsFilterLogEvents((s) => missingTool(s.logGroupName("g"))),
  ],
  ["logsTail", () => AwsTasks.logsTail((s) => missingTool(s.groupName("g")))],
];

for (const [task, reach] of REACH) {
  Deno.test(`AwsTasks.${task} reaches execution`, async () => {
    await assertRejects(reach, ToolNotFoundError);
  });
}

Deno.test("every AwsTasks method is reached above", () => {
  const reached = new Set(REACH.map(([task]) => task));
  const missing = Object.keys(AwsTasks).filter((task) =>
    task !== "run" && !reached.has(task)
  );
  assertEquals(missing, []);
});

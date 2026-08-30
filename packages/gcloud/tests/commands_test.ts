// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import {
  GcloudArtifactsImagesDeleteSettings,
  GcloudArtifactsImagesListSettings,
  GcloudArtifactsRepositoriesDescribeSettings,
  GcloudArtifactsRepositoriesListSettings,
  GcloudAuthActivateServiceAccountSettings,
  GcloudAuthConfigureDockerSettings,
  GcloudAuthListSettings,
  GcloudAuthPrintAccessTokenSettings,
  GcloudAuthPrintIdentityTokenSettings,
  GcloudAuthRevokeSettings,
  GcloudBuildsDescribeSettings,
  GcloudBuildsListSettings,
  GcloudBuildsLogSettings,
  GcloudBuildsSubmitSettings,
  GcloudClustersDescribeSettings,
  GcloudClustersGetCredentialsSettings,
  GcloudClustersListSettings,
  GcloudConfigGetValueSettings,
  GcloudConfigListSettings,
  GcloudConfigSetSettings,
  GcloudConfigUnsetSettings,
  GcloudFunctionsDeploySettings,
  GcloudFunctionsDescribeSettings,
  GcloudRunDeploySettings,
  GcloudRunServicesDescribeSettings,
  GcloudRunServicesListSettings,
  GcloudRunUpdateTrafficSettings,
  GcloudSecretsVersionsAccessSettings,
  GcloudStorageCpSettings,
  GcloudStorageLsSettings,
  GcloudStorageRmSettings,
  GcloudStorageRsyncSettings,
} from "../mod.ts";

// Every argv asserted here was run through Google Cloud SDK 582.0.0 before
// being written down. gcloud parses its arguments before it authenticates, so
// an unknown or misplaced flag exits 2 at parse time while a well-formed
// command gets as far as complaining about credentials — which is what makes
// these command lines the real CLI accepts rather than only ones this wrapper
// happens to produce.

Deno.test("auth: activate, print tokens, configure-docker, list, revoke", () => {
  assertEquals(
    new GcloudAuthActivateServiceAccountSettings()
      .serviceAccount("svc@p.iam.gserviceaccount.com").keyFile("k.json").argv(),
    [
      "gcloud",
      "auth",
      "activate-service-account",
      "svc@p.iam.gserviceaccount.com",
      "--key-file",
      "k.json",
    ],
  );
  assertEquals(
    new GcloudAuthPrintAccessTokenSettings().forAccount("a@b.c").argv(),
    ["gcloud", "auth", "print-access-token", "a@b.c"],
  );
  // Audiences are one comma-joined value, which is the form gcloud takes.
  assertEquals(
    new GcloudAuthPrintIdentityTokenSettings()
      .audiences("https://x", "https://y").includeEmail().argv(),
    [
      "gcloud",
      "auth",
      "print-identity-token",
      "--audiences",
      "https://x,https://y",
      "--include-email",
    ],
  );
  assertEquals(
    new GcloudAuthConfigureDockerSettings()
      .registries("us-central1-docker.pkg.dev", "europe-docker.pkg.dev")
      .noPrompt().argv(),
    [
      "gcloud",
      "auth",
      "configure-docker",
      "us-central1-docker.pkg.dev,europe-docker.pkg.dev",
      "--quiet",
    ],
  );
  assertEquals(
    new GcloudAuthListSettings().filterAccount("a@b.c").argv(),
    ["gcloud", "auth", "list", "--filter-account", "a@b.c"],
  );
  assertEquals(
    new GcloudAuthRevokeSettings().accounts("a@b.c").argv(),
    ["gcloud", "auth", "revoke", "a@b.c"],
  );
});

Deno.test("auth: the operands each command cannot do without", () => {
  assertThrows(
    () => new GcloudAuthActivateServiceAccountSettings().argv(),
    Error,
    "no key file",
  );
  // gcloud revokes the active account when given nothing, which is rarely what
  // a build means; make it say so.
  assertThrows(
    () => new GcloudAuthRevokeSettings().argv(),
    Error,
    "no accounts named",
  );
});

Deno.test("config: set, unset, get-value, list", () => {
  assertEquals(
    new GcloudConfigSetSettings().property("project").value("my-proj").argv(),
    ["gcloud", "config", "set", "project", "my-proj"],
  );
  assertEquals(
    new GcloudConfigUnsetSettings().property("project").argv(),
    ["gcloud", "config", "unset", "project"],
  );
  assertEquals(
    new GcloudConfigGetValueSettings().property("run/region").argv(),
    ["gcloud", "config", "get-value", "run/region"],
  );
  assertEquals(
    new GcloudConfigListSettings().all().argv(),
    ["gcloud", "config", "list", "--all"],
  );
  assertThrows(
    () => new GcloudConfigSetSettings().property("project").argv(),
    Error,
    "a property and a value",
  );
  assertThrows(
    () => new GcloudConfigGetValueSettings().argv(),
    Error,
    "no property named",
  );
});

Deno.test("builds submit: every flag, and the three ways to say what to build", () => {
  assertEquals(
    new GcloudBuildsSubmitSettings()
      .source(".").tag("gcr.io/p/i").timeout("600s")
      .machineType("e2-highcpu-8").substitutions("_A=1", "_B=2").async()
      .gcsSourceStagingDir("gs://staging").ignoreFile(".gcloudignore")
      .region("us-central1").argv(),
    [
      "gcloud",
      "builds",
      "submit",
      ".",
      "--tag",
      "gcr.io/p/i",
      "--timeout",
      "600s",
      "--machine-type",
      "e2-highcpu-8",
      "--substitutions",
      "_A=1,_B=2",
      "--async",
      "--gcs-source-staging-dir",
      "gs://staging",
      "--ignore-file",
      ".gcloudignore",
      "--region",
      "us-central1",
    ],
  );
  // gcloud: "argument --config: At most one of --config | --pack | --tag".
  assertThrows(
    () =>
      new GcloudBuildsSubmitSettings().tag("t").config("cloudbuild.yaml")
        .argv(),
    Error,
    "at most one of --config, --pack and --tag",
  );
  assertThrows(
    () => new GcloudBuildsSubmitSettings().pack("image=i").tag("t").argv(),
    Error,
    "at most one of",
  );
});

Deno.test("builds: list, describe, log, and the limit gcloud rejects", () => {
  assertEquals(
    new GcloudBuildsListSettings().limit(5).filter("status=SUCCESS").ongoing()
      .region("us-central1").argv(),
    [
      "gcloud",
      "builds",
      "list",
      "--limit",
      "5",
      "--filter",
      "status=SUCCESS",
      "--region",
      "us-central1",
      "--ongoing",
    ],
  );
  assertEquals(
    new GcloudBuildsDescribeSettings().build("b1").region("us-central1").argv(),
    ["gcloud", "builds", "describe", "b1", "--region", "us-central1"],
  );
  assertEquals(
    new GcloudBuildsLogSettings().build("b1").stream().argv(),
    ["gcloud", "builds", "log", "b1", "--stream"],
  );
  // gcloud: "argument --limit: Value must be greater than or equal to 1".
  assertThrows(
    () => new GcloudBuildsListSettings().limit(0).argv(),
    Error,
    "at least 1",
  );
  assertThrows(
    () => new GcloudBuildsListSettings().limit(-1).argv(),
    Error,
    "at least 1",
  );
  assertThrows(
    () => new GcloudBuildsListSettings().limit(1.5).argv(),
    Error,
    "at least 1",
  );
  assertThrows(
    () => new GcloudBuildsDescribeSettings().argv(),
    Error,
    "no build named",
  );
  assertThrows(
    () => new GcloudBuildsLogSettings().argv(),
    Error,
    "no build named",
  );
});

Deno.test("run deploy: every flag, in the order the argv builds them", () => {
  assertEquals(
    new GcloudRunDeploySettings()
      .service("api").image("gcr.io/p/i").region("us-central1")
      .platform("managed").allowUnauthenticated()
      .serviceAccount("sa@p.iam.gserviceaccount.com")
      .setEnvVars("A=1", "B=2").setSecrets("S=s:latest").memory("512Mi")
      .cpu("1").concurrency(80).maxInstances(10).minInstances(1).port(8080)
      .timeout("300").tag("candidate").noTraffic().argv(),
    [
      "gcloud",
      "run",
      "deploy",
      "api",
      "--image",
      "gcr.io/p/i",
      "--region",
      "us-central1",
      "--platform",
      "managed",
      "--allow-unauthenticated",
      "--service-account",
      "sa@p.iam.gserviceaccount.com",
      "--set-env-vars",
      "A=1,B=2",
      "--set-secrets",
      "S=s:latest",
      "--memory",
      "512Mi",
      "--cpu",
      "1",
      "--concurrency",
      "80",
      "--max-instances",
      "10",
      "--min-instances",
      "1",
      "--port",
      "8080",
      "--timeout",
      "300",
      "--tag",
      "candidate",
      "--no-traffic",
    ],
  );
  assertEquals(
    new GcloudRunDeploySettings().service("api").source(".")
      .noAllowUnauthenticated().argv(),
    [
      "gcloud",
      "run",
      "deploy",
      "api",
      "--source",
      ".",
      "--no-allow-unauthenticated",
    ],
  );
});

Deno.test("run deploy: the contradictions worth refusing", () => {
  assertThrows(
    () => new GcloudRunDeploySettings().argv(),
    Error,
    "no service named",
  );
  assertThrows(
    () =>
      new GcloudRunDeploySettings().service("api").image("i").source(".")
        .argv(),
    Error,
    "keep one",
  );
  // gcloud accepts both spellings without complaint. The difference is whether
  // the service is reachable by anyone on the internet, so it is not left to
  // whichever the CLI happens to honour.
  assertThrows(
    () =>
      new GcloudRunDeploySettings().service("api").allowUnauthenticated()
        .noAllowUnauthenticated().argv(),
    Error,
    "publicly invokable",
  );
});

Deno.test("run services: describe, list, and the traffic destinations", () => {
  assertEquals(
    new GcloudRunServicesDescribeSettings().service("api")
      .region("us-central1").platform("managed").argv(),
    [
      "gcloud",
      "run",
      "services",
      "describe",
      "api",
      "--region",
      "us-central1",
      "--platform",
      "managed",
    ],
  );
  assertEquals(
    new GcloudRunServicesListSettings().region("us-central1").platform(
      "managed",
    )
      .filter("x").argv(),
    [
      "gcloud",
      "run",
      "services",
      "list",
      "--region",
      "us-central1",
      "--platform",
      "managed",
      "--filter",
      "x",
    ],
  );
  assertEquals(
    new GcloudRunUpdateTrafficSettings().service("api").region("us-central1")
      .toRevisions("r1=50", "r2=50").argv(),
    [
      "gcloud",
      "run",
      "services",
      "update-traffic",
      "api",
      "--region",
      "us-central1",
      "--to-revisions",
      "r1=50,r2=50",
    ],
  );
  assertEquals(
    new GcloudRunUpdateTrafficSettings().service("api").toTags("t=100").argv(),
    [
      "gcloud",
      "run",
      "services",
      "update-traffic",
      "api",
      "--to-tags",
      "t=100",
    ],
  );
});

Deno.test("run update-traffic: one destination, and at least one", () => {
  // gcloud: "At most one of --to-latest | --to-revisions | --to-tags".
  assertThrows(
    () =>
      new GcloudRunUpdateTrafficSettings().service("api").toLatest()
        .toRevisions("r=100").argv(),
    Error,
    "at most one of --to-latest",
  );
  assertThrows(
    () => new GcloudRunUpdateTrafficSettings().service("api").argv(),
    Error,
    "no destination",
  );
});

Deno.test("artifacts: images and repositories", () => {
  assertEquals(
    new GcloudArtifactsImagesListSettings()
      .repository("us-docker.pkg.dev/p/r").includeTags().limit(10).filter("x")
      .argv(),
    [
      "gcloud",
      "artifacts",
      "docker",
      "images",
      "list",
      "us-docker.pkg.dev/p/r",
      "--include-tags",
      "--limit",
      "10",
      "--filter",
      "x",
    ],
  );
  assertEquals(
    new GcloudArtifactsImagesDeleteSettings()
      .image("us-docker.pkg.dev/p/r/i:t").deleteTags().noPrompt().argv(),
    [
      "gcloud",
      "artifacts",
      "docker",
      "images",
      "delete",
      "us-docker.pkg.dev/p/r/i:t",
      "--delete-tags",
      "--quiet",
    ],
  );
  assertEquals(
    new GcloudArtifactsRepositoriesListSettings().location("us").limit(5)
      .argv(),
    [
      "gcloud",
      "artifacts",
      "repositories",
      "list",
      "--location",
      "us",
      "--limit",
      "5",
    ],
  );
  assertEquals(
    new GcloudArtifactsRepositoriesDescribeSettings().repository("images")
      .location("us").argv(),
    [
      "gcloud",
      "artifacts",
      "repositories",
      "describe",
      "images",
      "--location",
      "us",
    ],
  );
  // The same limit rule, shared by both listings rather than written twice.
  assertThrows(
    () =>
      new GcloudArtifactsImagesListSettings().repository("r").limit(0)
        .argv(),
    Error,
    "at least 1",
  );
  assertThrows(
    () => new GcloudArtifactsRepositoriesListSettings().limit(0).argv(),
    Error,
    "at least 1",
  );
  assertThrows(
    () => new GcloudArtifactsImagesListSettings().argv(),
    Error,
    "no repository named",
  );
  assertThrows(
    () => new GcloudArtifactsImagesDeleteSettings().argv(),
    Error,
    "no image named",
  );
});

Deno.test("storage: cp, rsync, ls, rm", () => {
  assertEquals(
    new GcloudStorageCpSettings().sources("dist", "extra")
      .destination("gs://b/p").recursive().noClobber()
      .contentType("text/html").cacheControl("no-cache").argv(),
    [
      "gcloud",
      "storage",
      "cp",
      "dist",
      "extra",
      "gs://b/p",
      "--recursive",
      "--no-clobber",
      "--content-type",
      "text/html",
      "--cache-control",
      "no-cache",
    ],
  );
  assertEquals(
    new GcloudStorageRsyncSettings().source("dist").destination("gs://b/p")
      .recursive().deleteUnmatchedDestinationObjects().exclude("\\.map$")
      .argv(),
    [
      "gcloud",
      "storage",
      "rsync",
      "dist",
      "gs://b/p",
      "--recursive",
      "--delete-unmatched-destination-objects",
      "--exclude",
      "\\.map$",
    ],
  );
  assertEquals(
    new GcloudStorageLsSettings().paths("gs://b").recursive().long().argv(),
    ["gcloud", "storage", "ls", "gs://b", "--recursive", "--long"],
  );
  assertEquals(
    new GcloudStorageRmSettings().paths("gs://b/o").recursive().argv(),
    ["gcloud", "storage", "rm", "gs://b/o", "--recursive"],
  );
});

Deno.test("storage: both ends of a transfer, and no blind delete", () => {
  assertThrows(
    () => new GcloudStorageCpSettings().sources("dist").argv(),
    Error,
    "both ends",
  );
  assertThrows(
    () => new GcloudStorageRsyncSettings().source("dist").argv(),
    Error,
    "both ends",
  );
  assertThrows(
    () => new GcloudStorageRmSettings().argv(),
    Error,
    "no paths given",
  );
});

Deno.test("clusters: credentials, list, describe", () => {
  assertEquals(
    new GcloudClustersGetCredentialsSettings().cluster("prod")
      .region("us-central1").internalIp().argv(),
    [
      "gcloud",
      "container",
      "clusters",
      "get-credentials",
      "prod",
      "--region",
      "us-central1",
      "--internal-ip",
    ],
  );
  assertEquals(
    new GcloudClustersGetCredentialsSettings().cluster("prod")
      .zone("us-central1-a").dnsEndpoint().argv(),
    [
      "gcloud",
      "container",
      "clusters",
      "get-credentials",
      "prod",
      "--zone",
      "us-central1-a",
      "--dns-endpoint",
    ],
  );
  assertEquals(
    new GcloudClustersListSettings().region("us-central1").filter("x").argv(),
    [
      "gcloud",
      "container",
      "clusters",
      "list",
      "--region",
      "us-central1",
      "--filter",
      "x",
    ],
  );
  assertEquals(
    new GcloudClustersDescribeSettings().cluster("prod").location("us-central1")
      .argv(),
    [
      "gcloud",
      "container",
      "clusters",
      "describe",
      "prod",
      "--location",
      "us-central1",
    ],
  );
});

Deno.test("clusters: one location flag, on every command that takes them", () => {
  // gcloud: "At most one of --location | --region | --zone can be specified."
  // The rule is shared, so each command that offers the flags enforces it.
  assertThrows(
    () =>
      new GcloudClustersGetCredentialsSettings().cluster("c")
        .region("r").zone("z").argv(),
    Error,
    "at most one of --location, --region and --zone",
  );
  assertThrows(
    () => new GcloudClustersListSettings().location("l").zone("z").argv(),
    Error,
    "at most one of",
  );
  assertThrows(
    () =>
      new GcloudClustersDescribeSettings().cluster("c").location("l").region(
        "r",
      )
        .argv(),
    Error,
    "at most one of",
  );
  assertThrows(
    () => new GcloudClustersGetCredentialsSettings().argv(),
    Error,
    "no cluster named",
  );
});

Deno.test("functions: deploy, describe, and one trigger", () => {
  assertEquals(
    new GcloudFunctionsDeploySettings()
      .function("ingest").runtime("nodejs20").region("us-central1")
      .entryPoint("main").source(".").triggerHttp()
      .serviceAccount("sa@p.iam.gserviceaccount.com").setEnvVars("A=1")
      .memory("256Mi").timeout("60s").gen2().argv(),
    [
      "gcloud",
      "functions",
      "deploy",
      "ingest",
      "--runtime",
      "nodejs20",
      "--region",
      "us-central1",
      "--entry-point",
      "main",
      "--source",
      ".",
      "--trigger-http",
      "--service-account",
      "sa@p.iam.gserviceaccount.com",
      "--set-env-vars",
      "A=1",
      "--memory",
      "256Mi",
      "--timeout",
      "60s",
      "--gen2",
    ],
  );
  assertEquals(
    new GcloudFunctionsDeploySettings().function("ingest")
      .triggerTopic("ingest-topic").argv(),
    [
      "gcloud",
      "functions",
      "deploy",
      "ingest",
      "--trigger-topic",
      "ingest-topic",
    ],
  );
  // Each event filter is its own flag, which is the form gcloud takes.
  assertEquals(
    new GcloudFunctionsDeploySettings().function("ingest")
      .triggerEventFilters("type=google.cloud.storage.object.v1.finalized")
      .argv(),
    [
      "gcloud",
      "functions",
      "deploy",
      "ingest",
      "--trigger-event-filters",
      "type=google.cloud.storage.object.v1.finalized",
    ],
  );
  assertEquals(
    new GcloudFunctionsDescribeSettings().function("ingest")
      .region("us-central1").gen2().argv(),
    [
      "gcloud",
      "functions",
      "describe",
      "ingest",
      "--region",
      "us-central1",
      "--gen2",
    ],
  );
  assertThrows(
    () =>
      new GcloudFunctionsDeploySettings().function("f").triggerHttp()
        .triggerTopic("t").argv(),
    Error,
    "how the function is invoked",
  );
  assertThrows(
    () => new GcloudFunctionsDeploySettings().argv(),
    Error,
    "no function named",
  );
});

Deno.test("secrets: a version defaults to latest", () => {
  assertEquals(
    new GcloudSecretsVersionsAccessSettings().secret("api-key").argv(),
    [
      "gcloud",
      "secrets",
      "versions",
      "access",
      "latest",
      "--secret",
      "api-key",
    ],
  );
  assertEquals(
    new GcloudSecretsVersionsAccessSettings().version("3").secret("api-key")
      .argv(),
    ["gcloud", "secrets", "versions", "access", "3", "--secret", "api-key"],
  );
  assertThrows(
    () => new GcloudSecretsVersionsAccessSettings().argv(),
    Error,
    "no secret named",
  );
});

Deno.test("the global flags reach every new command", () => {
  // GcloudSettings emits them between the command path and any trailing flags,
  // which is the order gcloud accepts. A command that built its own argv
  // instead of going through leadingTokens would lose them.
  assertEquals(
    new GcloudRunDeploySettings().service("api").image("i")
      .project("my-proj").account("a@b.c").configuration("ci")
      .format("json").verbosity("debug").noPrompt().argv(),
    [
      "gcloud",
      "run",
      "deploy",
      "api",
      "--image",
      "i",
      "--project",
      "my-proj",
      "--account",
      "a@b.c",
      "--configuration",
      "ci",
      "--format",
      "json",
      "--verbosity",
      "debug",
      "--quiet",
    ],
  );
  assertEquals(
    new GcloudStorageLsSettings().paths("gs://b").project("p").argv(),
    ["gcloud", "storage", "ls", "gs://b", "--project", "p"],
  );
});

Deno.test("every location flag renders on every command that offers it", () => {
  // The three commands share one location rule, so each must also emit each
  // flag it accepts — a setter writing the wrong field would change these.
  assertEquals(
    new GcloudClustersGetCredentialsSettings().cluster("c").location("l")
      .argv(),
    [
      "gcloud",
      "container",
      "clusters",
      "get-credentials",
      "c",
      "--location",
      "l",
    ],
  );
  assertEquals(
    new GcloudClustersListSettings().location("l").argv(),
    ["gcloud", "container", "clusters", "list", "--location", "l"],
  );
  assertEquals(
    new GcloudClustersListSettings().zone("z").argv(),
    ["gcloud", "container", "clusters", "list", "--zone", "z"],
  );
  assertEquals(
    new GcloudClustersDescribeSettings().cluster("c").region("r").argv(),
    ["gcloud", "container", "clusters", "describe", "c", "--region", "r"],
  );
  assertEquals(
    new GcloudClustersDescribeSettings().cluster("c").zone("z").argv(),
    ["gcloud", "container", "clusters", "describe", "c", "--zone", "z"],
  );
  assertThrows(
    () => new GcloudClustersDescribeSettings().argv(),
    Error,
    "no cluster named",
  );
});

Deno.test("the remaining operands each command cannot do without", () => {
  assertThrows(
    () => new GcloudConfigUnsetSettings().argv(),
    Error,
    "no property named",
  );
  assertThrows(
    () => new GcloudArtifactsRepositoriesDescribeSettings().argv(),
    Error,
    "no repository named",
  );
  assertThrows(
    () => new GcloudRunServicesDescribeSettings().argv(),
    Error,
    "no service named",
  );
  assertThrows(
    () => new GcloudRunUpdateTrafficSettings().argv(),
    Error,
    "no service named",
  );
  assertThrows(
    () => new GcloudFunctionsDescribeSettings().argv(),
    Error,
    "no function named",
  );
});

Deno.test("the bare forms, with nothing configured", () => {
  // Each command must be usable with only its operand: a flag that rendered
  // unconditionally would show up here.
  assertEquals(new GcloudAuthListSettings().argv(), ["gcloud", "auth", "list"]);
  assertEquals(
    new GcloudAuthPrintAccessTokenSettings().argv(),
    ["gcloud", "auth", "print-access-token"],
  );
  assertEquals(
    new GcloudAuthPrintIdentityTokenSettings().argv(),
    ["gcloud", "auth", "print-identity-token"],
  );
  assertEquals(
    new GcloudAuthConfigureDockerSettings().argv(),
    ["gcloud", "auth", "configure-docker"],
  );
  assertEquals(
    new GcloudAuthActivateServiceAccountSettings().keyFile("k.json").argv(),
    ["gcloud", "auth", "activate-service-account", "--key-file", "k.json"],
  );
  assertEquals(new GcloudConfigListSettings().argv(), [
    "gcloud",
    "config",
    "list",
  ]);
  assertEquals(new GcloudBuildsListSettings().argv(), [
    "gcloud",
    "builds",
    "list",
  ]);
  assertEquals(
    new GcloudBuildsSubmitSettings().argv(),
    ["gcloud", "builds", "submit"],
  );
  assertEquals(
    new GcloudBuildsLogSettings().build("b").argv(),
    ["gcloud", "builds", "log", "b"],
  );
  assertEquals(
    new GcloudBuildsDescribeSettings().build("b").argv(),
    ["gcloud", "builds", "describe", "b"],
  );
  assertEquals(
    new GcloudRunServicesListSettings().argv(),
    ["gcloud", "run", "services", "list"],
  );
  assertEquals(
    new GcloudArtifactsRepositoriesListSettings().argv(),
    ["gcloud", "artifacts", "repositories", "list"],
  );
  assertEquals(
    new GcloudArtifactsRepositoriesDescribeSettings().repository("r").argv(),
    ["gcloud", "artifacts", "repositories", "describe", "r"],
  );
  assertEquals(
    new GcloudArtifactsImagesListSettings().repository("r").argv(),
    ["gcloud", "artifacts", "docker", "images", "list", "r"],
  );
  assertEquals(
    new GcloudArtifactsImagesDeleteSettings().image("i").argv(),
    ["gcloud", "artifacts", "docker", "images", "delete", "i"],
  );
  assertEquals(new GcloudStorageLsSettings().argv(), [
    "gcloud",
    "storage",
    "ls",
  ]);
  assertEquals(
    new GcloudStorageCpSettings().sources("a").destination("gs://b").argv(),
    ["gcloud", "storage", "cp", "a", "gs://b"],
  );
  assertEquals(
    new GcloudStorageRsyncSettings().source("a").destination("gs://b").argv(),
    ["gcloud", "storage", "rsync", "a", "gs://b"],
  );
  assertEquals(
    new GcloudStorageRmSettings().paths("gs://b/o").argv(),
    ["gcloud", "storage", "rm", "gs://b/o"],
  );
  assertEquals(
    new GcloudClustersListSettings().argv(),
    ["gcloud", "container", "clusters", "list"],
  );
  assertEquals(
    new GcloudClustersGetCredentialsSettings().cluster("c").argv(),
    ["gcloud", "container", "clusters", "get-credentials", "c"],
  );
  assertEquals(
    new GcloudFunctionsDescribeSettings().function("f").argv(),
    ["gcloud", "functions", "describe", "f"],
  );
  assertEquals(
    new GcloudFunctionsDeploySettings().function("f").triggerBucket("b").argv(),
    ["gcloud", "functions", "deploy", "f", "--trigger-bucket", "b"],
  );
  assertEquals(
    new GcloudRunDeploySettings().service("api").argv(),
    ["gcloud", "run", "deploy", "api"],
  );
});

Deno.test("a value containing a comma is refused by the flag that joins on one", () => {
  // gcloud does notice — "Bad syntax for dict arg: [2]" — but that names the
  // argument it received, not the value responsible. The code doing the joining
  // is the code that can say which value cannot be joined.
  assertThrows(
    () =>
      new GcloudRunDeploySettings().service("api").setEnvVars("A=1,2", "B=3")
        .argv(),
    Error,
    "cannot be passed this way",
  );
  assertThrows(
    () =>
      new GcloudRunDeploySettings().service("api").setSecrets("S=a,b").argv(),
    Error,
    "--set-secrets",
  );
  assertThrows(
    () => new GcloudBuildsSubmitSettings().substitutions("_A=x,y").argv(),
    Error,
    "--substitutions",
  );
  assertThrows(
    () =>
      new GcloudRunUpdateTrafficSettings().service("a").toRevisions("r=1,2")
        .argv(),
    Error,
    "--to-revisions",
  );
  assertThrows(
    () =>
      new GcloudFunctionsDeploySettings().function("f").setEnvVars("A=1,2")
        .argv(),
    Error,
    "--set-env-vars",
  );
  // The ordinary multi-value case still joins, which is the form gcloud takes.
  assertEquals(
    new GcloudRunDeploySettings().service("api").setEnvVars("A=1", "B=2")
      .argv(),
    ["gcloud", "run", "deploy", "api", "--set-env-vars", "A=1,B=2"],
  );
});

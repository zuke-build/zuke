// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The pure argv of every typed command, and each task reaching execution.
 */

import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import { missingTool } from "@zuke/core/tooling/conformance";
import {
  AzAccountGetAccessTokenSettings,
  AzAccountListSettings,
  AzAccountSetSettings,
  AzAccountShowSettings,
  AzAcrBuildSettings,
  AzAcrLoginSettings,
  AzAcrRepositoryDeleteSettings,
  AzAcrRepositoryShowTagsSettings,
  AzAksGetCredentialsSettings,
  AzAksShowSettings,
  AzContainerappIngressTrafficSetSettings,
  AzContainerappRevisionListSettings,
  AzContainerappRevisionSettings,
  AzContainerappShowSettings,
  AzContainerappUpdateSettings,
  AzDeploymentGroupCreateSettings,
  AzDeploymentGroupShowSettings,
  AzDeploymentGroupWhatIfSettings,
  AzFunctionappDeploymentSourceConfigZipSettings,
  AzGroupCreateSettings,
  AzGroupDeleteSettings,
  AzGroupExistsSettings,
  AzGroupShowSettings,
  AzKeyvaultSecretSetSettings,
  AzKeyvaultSecretShowSettings,
  AzLoginSettings,
  AzLogoutSettings,
  AzStorageBlobDownloadSettings,
  AzStorageBlobUploadBatchSettings,
  AzStorageBlobUploadSettings,
  AzTasks,
  AzWebappConfigAppsettingsSetSettings,
  AzWebappDeploymentSlotSwapSettings,
  AzWebappDeploySettings,
  AzWebappShowSettings,
} from "../mod.ts";

/** The argv after the binary. */
function args(settings: { argv(): string[] }): string[] {
  return settings.argv().slice(1);
}

Deno.test("login: a service principal with a federated token", () => {
  assertEquals(
    args(
      new AzLoginSettings().servicePrincipal().username("app-id")
        .tenant("tenant-id").federatedToken("oidc-token-value")
        .allowNoSubscriptions().subscription("prod"),
    ),
    [
      "login",
      "--service-principal",
      "--username=app-id",
      "--tenant=tenant-id",
      "--federated-token=@-",
      "--allow-no-subscriptions",
      "--subscription=prod",
    ],
  );
});

Deno.test("login: a service principal with a secret or a certificate", () => {
  assertEquals(
    args(
      new AzLoginSettings().servicePrincipal().username("a").tenant("t")
        .password("client-secret-value"),
    ),
    [
      "login",
      "--service-principal",
      "--username=a",
      "--tenant=t",
      "--password=@-",
    ],
  );
  assertEquals(
    args(
      new AzLoginSettings().servicePrincipal().username("a").tenant("t")
        .certificate("sp.pem").useCertSnIssuer(),
    ),
    [
      "login",
      "--service-principal",
      "--username=a",
      "--tenant=t",
      "--certificate=sp.pem",
      "--use-cert-sn-issuer",
    ],
  );
});

Deno.test("login: a managed identity", () => {
  assertEquals(args(new AzLoginSettings().identity()), [
    "login",
    "--identity",
  ]);
  assertEquals(
    args(
      new AzLoginSettings().identity().clientId("c").objectId("o")
        .resourceId("r"),
    ),
    [
      "login",
      "--identity",
      "--client-id=c",
      "--object-id=o",
      "--resource-id=r",
    ],
  );
});

Deno.test("login: incomplete or mixed credentials are refused", () => {
  const refusals: Array<() => unknown> = [
    () => new AzLoginSettings().argv(),
    () => new AzLoginSettings().servicePrincipal().username("a").argv(),
    () =>
      new AzLoginSettings().servicePrincipal().username("a").tenant("t")
        .argv(),
    () => new AzLoginSettings().username("a").tenant("t").password("p").argv(),
    () =>
      new AzLoginSettings().servicePrincipal().username("a").tenant("t")
        .password("p").certificate("c.pem").argv(),
  ];
  for (const refuse of refusals) {
    assertThrows(refuse, Error, "non-interactive login");
  }
  assertThrows(
    () => new AzLoginSettings().identity().password("p").argv(),
    Error,
    "--identity takes no",
  );
  assertThrows(
    () => new AzLoginSettings().identity().servicePrincipal().argv(),
    Error,
    "--identity takes no",
  );
  assertThrows(
    () => new AzLoginSettings().identity().certificate("c").argv(),
    Error,
    "--identity takes no",
  );
});

Deno.test("logout: the active account, or a named one", () => {
  assertEquals(args(new AzLogoutSettings()), ["logout"]);
  assertEquals(args(new AzLogoutSettings().username("u")), [
    "logout",
    "--username=u",
  ]);
});

Deno.test("account: show, set, list, get-access-token", () => {
  assertEquals(args(new AzAccountShowSettings()), ["account", "show"]);
  assertEquals(args(new AzAccountSetSettings().subscription("prod")), [
    "account",
    "set",
    "--subscription=prod",
  ]);
  assertEquals(args(new AzAccountListSettings()), ["account", "list"]);
  assertEquals(args(new AzAccountListSettings().all().refresh()), [
    "account",
    "list",
    "--all",
    "--refresh",
  ]);
  assertEquals(args(new AzAccountGetAccessTokenSettings()), [
    "account",
    "get-access-token",
    "--output=json",
  ]);
  assertEquals(
    args(
      new AzAccountGetAccessTokenSettings().resource("https://vault.azure.net")
        .resourceType("arm").scope("a/.default", "b/.default").tenant("t"),
    ),
    [
      "account",
      "get-access-token",
      "--resource=https://vault.azure.net",
      "--resource-type=arm",
      "--scope",
      "a/.default",
      "b/.default",
      "--tenant=t",
      "--output=json",
    ],
  );
});

Deno.test("group: create, show, delete, exists", () => {
  assertEquals(
    args(
      new AzGroupCreateSettings().name("rg").location("westeurope")
        .tag("env", "prod").tag("pr", "42").managedBy("id"),
    ),
    [
      "group",
      "create",
      "--name=rg",
      "--location=westeurope",
      "--tags",
      "env=prod",
      "pr=42",
      "--managed-by=id",
    ],
  );
  assertEquals(
    args(new AzGroupCreateSettings().name("rg").location("westeurope")),
    ["group", "create", "--name=rg", "--location=westeurope"],
  );
  assertEquals(args(new AzGroupShowSettings().name("rg")), [
    "group",
    "show",
    "--name=rg",
  ]);
  assertEquals(args(new AzGroupDeleteSettings().name("rg")), [
    "group",
    "delete",
    "--name=rg",
  ]);
  assertEquals(
    args(
      new AzGroupDeleteSettings().name("rg").yes().noWait()
        .forceDeletionTypes("Microsoft.Compute/virtualMachines"),
    ),
    [
      "group",
      "delete",
      "--name=rg",
      "--force-deletion-types=Microsoft.Compute/virtualMachines",
      "--yes",
      "--no-wait",
    ],
  );
  assertEquals(args(new AzGroupExistsSettings().name("rg")), [
    "group",
    "exists",
    "--name=rg",
  ]);
  assertThrows(
    () => new AzGroupShowSettings().argv(),
    Error,
    "no resource group",
  );
  assertThrows(
    () => new AzGroupCreateSettings().name("rg").argv(),
    Error,
    "no location",
  );
});

Deno.test("acr: login, with and without a token", () => {
  assertEquals(args(new AzAcrLoginSettings().name("reg")), [
    "acr",
    "login",
    "--name=reg",
    "--output=json",
  ]);
  assertEquals(
    args(new AzAcrLoginSettings().name("reg").exposeToken().suffix("t")),
    [
      "acr",
      "login",
      "--name=reg",
      "--expose-token",
      "--suffix=t",
      "--output=json",
    ],
  );
  assertEquals(
    args(new AzAcrLoginSettings().name("reg").username("u").password("p4ss")),
    [
      "acr",
      "login",
      "--name=reg",
      "--username=u",
      "--password=@-",
      "--output=json",
    ],
  );
  assertThrows(
    () => new AzAcrLoginSettings().name("r").exposeToken().username("u").argv(),
    Error,
    "--expose-token cannot",
  );
  assertThrows(() => new AzAcrLoginSettings().argv(), Error, "no registry");
});

Deno.test("acr: build", () => {
  assertEquals(
    args(new AzAcrBuildSettings().registry("reg").source(".")),
    ["acr", "build", "--registry=reg", "."],
  );
  assertEquals(
    args(
      new AzAcrBuildSettings().registry("reg").source("./src")
        .image("api:1").image("api:latest").file("Dockerfile.prod")
        .buildArg("VERSION", "1").secretBuildArg("NPM_TOKEN", "npm-token-1")
        .platform("linux/arm64").target("runtime").timeout(600)
        .resourceGroup("rg").noPush().noLogs().noWait(),
    ),
    [
      "acr",
      "build",
      "--registry=reg",
      "--image=api:1",
      "--image=api:latest",
      "--file=Dockerfile.prod",
      "--build-arg=VERSION=1",
      "--secret-build-arg=NPM_TOKEN=npm-token-1",
      "--platform=linux/arm64",
      "--target=runtime",
      "--timeout=600",
      "--resource-group=rg",
      "--no-push",
      "--no-logs",
      "--no-wait",
      "./src",
    ],
  );
  assertThrows(
    () => new AzAcrBuildSettings().source(".").argv(),
    Error,
    "no registry",
  );
  assertThrows(
    () => new AzAcrBuildSettings().registry("r").argv(),
    Error,
    "no build context",
  );
});

Deno.test("acr: repository show-tags and delete", () => {
  assertEquals(
    args(new AzAcrRepositoryShowTagsSettings().name("reg").repository("api")),
    ["acr", "repository", "show-tags", "--name=reg", "--repository=api"],
  );
  assertEquals(
    args(
      new AzAcrRepositoryShowTagsSettings().name("reg").repository("api")
        .top(5).orderby("time_desc").detail(),
    ),
    [
      "acr",
      "repository",
      "show-tags",
      "--name=reg",
      "--repository=api",
      "--top=5",
      "--orderby=time_desc",
      "--detail",
    ],
  );
  assertThrows(
    () => new AzAcrRepositoryShowTagsSettings().name("reg").argv(),
    Error,
    "no repository",
  );
  assertEquals(
    args(
      new AzAcrRepositoryDeleteSettings().name("reg").image("api:old").yes(),
    ),
    ["acr", "repository", "delete", "--name=reg", "--image=api:old", "--yes"],
  );
  assertEquals(
    args(new AzAcrRepositoryDeleteSettings().name("reg").repository("api")),
    ["acr", "repository", "delete", "--name=reg", "--repository=api"],
  );
  assertThrows(
    () => new AzAcrRepositoryDeleteSettings().name("reg").argv(),
    Error,
    "image or a repository",
  );
  assertThrows(
    () =>
      new AzAcrRepositoryDeleteSettings().name("reg").image("a:1")
        .repository("a").argv(),
    Error,
    "image or a repository",
  );
});

Deno.test("aks: get-credentials and show", () => {
  assertEquals(
    args(new AzAksGetCredentialsSettings().name("k").resourceGroup("rg")),
    ["aks", "get-credentials", "--name=k", "--resource-group=rg"],
  );
  assertEquals(
    args(
      new AzAksGetCredentialsSettings().name("k").resourceGroup("rg").admin()
        .file("kubeconfig").overwriteExisting().context("ctx").publicFqdn()
        .format("exec"),
    ),
    [
      "aks",
      "get-credentials",
      "--name=k",
      "--resource-group=rg",
      "--admin",
      "--file=kubeconfig",
      "--overwrite-existing",
      "--context=ctx",
      "--public-fqdn",
      "--format=exec",
    ],
  );
  assertEquals(args(new AzAksShowSettings().name("k").resourceGroup("rg")), [
    "aks",
    "show",
    "--name=k",
    "--resource-group=rg",
  ]);
  assertThrows(
    () => new AzAksShowSettings().resourceGroup("rg").argv(),
    Error,
    "no cluster named",
  );
  assertThrows(
    () => new AzAksShowSettings().name("k").argv(),
    Error,
    "no resource group",
  );
});

Deno.test("containerapp: update", () => {
  assertEquals(
    args(new AzContainerappUpdateSettings().name("api").resourceGroup("rg")),
    ["containerapp", "update", "--name=api", "--resource-group=rg"],
  );
  assertEquals(
    args(
      new AzContainerappUpdateSettings().name("api").resourceGroup("rg")
        .image("reg.azurecr.io/api:2").containerName("main")
        .revisionSuffix("v2").setEnvVar("MODE", "prod")
        .setEnvVar("DB", "secretref:db").removeEnvVars("OLD", "LEGACY")
        .cpu(0.5).memory("1.0Gi").minReplicas(1).maxReplicas(5)
        .yaml("app.yaml"),
    ),
    [
      "containerapp",
      "update",
      "--name=api",
      "--resource-group=rg",
      "--image=reg.azurecr.io/api:2",
      "--container-name=main",
      "--revision-suffix=v2",
      "--set-env-vars",
      "MODE=prod",
      "DB=secretref:db",
      "--remove-env-vars",
      "OLD",
      "LEGACY",
      "--cpu=0.5",
      "--memory=1.0Gi",
      "--min-replicas=1",
      "--max-replicas=5",
      "--yaml=app.yaml",
    ],
  );
});

Deno.test("containerapp: show, revision list, activate, deactivate", () => {
  assertEquals(
    args(new AzContainerappShowSettings().name("api").resourceGroup("rg")),
    ["containerapp", "show", "--name=api", "--resource-group=rg"],
  );
  assertEquals(
    args(
      new AzContainerappRevisionListSettings().name("api").resourceGroup("rg")
        .all(),
    ),
    [
      "containerapp",
      "revision",
      "list",
      "--name=api",
      "--resource-group=rg",
      "--all",
    ],
  );
  assertEquals(
    args(
      new AzContainerappRevisionListSettings().name("api").resourceGroup("rg"),
    ),
    ["containerapp", "revision", "list", "--name=api", "--resource-group=rg"],
  );
  for (const verb of ["activate", "deactivate"] satisfies string[]) {
    const settings = verb === "activate"
      ? new AzContainerappRevisionSettings("activate")
      : new AzContainerappRevisionSettings("deactivate");
    assertEquals(
      args(settings.name("api").resourceGroup("rg").revision("api--v2")),
      [
        "containerapp",
        "revision",
        verb,
        "--name=api",
        "--resource-group=rg",
        "--revision=api--v2",
      ],
    );
  }
  assertThrows(
    () =>
      new AzContainerappRevisionSettings("deactivate").name("a")
        .resourceGroup("rg").argv(),
    Error,
    "containerappRevisionDeactivate: no revision",
  );
  assertThrows(
    () =>
      new AzContainerappRevisionSettings("activate").name("a")
        .resourceGroup("rg").argv(),
    Error,
    "containerappRevisionActivate: no revision",
  );
});

Deno.test("containerapp: ingress traffic set by revision and by label", () => {
  assertEquals(
    args(
      new AzContainerappIngressTrafficSetSettings().name("api")
        .resourceGroup("rg").revisionWeight("api--v2", 10)
        .revisionWeight("latest", 90),
    ),
    [
      "containerapp",
      "ingress",
      "traffic",
      "set",
      "--name=api",
      "--resource-group=rg",
      "--revision-weight",
      "api--v2=10",
      "latest=90",
    ],
  );
  assertEquals(
    args(
      new AzContainerappIngressTrafficSetSettings().name("api")
        .resourceGroup("rg").labelWeight("blue", 0).labelWeight("green", 100),
    ),
    [
      "containerapp",
      "ingress",
      "traffic",
      "set",
      "--name=api",
      "--resource-group=rg",
      "--label-weight",
      "blue=0",
      "green=100",
    ],
  );
  assertThrows(
    () =>
      new AzContainerappIngressTrafficSetSettings().name("a")
        .resourceGroup("rg").argv(),
    Error,
    "no weights",
  );
  for (const weight of [-1, 101, 2.5, NaN]) {
    assertThrows(
      () =>
        new AzContainerappIngressTrafficSetSettings().revisionWeight(
          "r",
          weight,
        ),
      Error,
      "whole-number weight",
    );
  }
});

Deno.test("webapp: deploy", () => {
  assertEquals(
    args(
      new AzWebappDeploySettings().name("web").resourceGroup("rg")
        .srcPath("app.zip"),
    ),
    [
      "webapp",
      "deploy",
      "--name=web",
      "--resource-group=rg",
      "--src-path=app.zip",
    ],
  );
  assertEquals(
    args(
      new AzWebappDeploySettings().name("web").resourceGroup("rg")
        .srcUrl("https://x/app.war").type("war").targetPath(
          "/home/site/wwwroot",
        )
        .slot("staging").async().restart(false).clean(true).timeout(60000),
    ),
    [
      "webapp",
      "deploy",
      "--name=web",
      "--resource-group=rg",
      "--src-url=https://x/app.war",
      "--type=war",
      "--target-path=/home/site/wwwroot",
      "--slot=staging",
      "--async=true",
      "--restart=false",
      "--clean=true",
      "--timeout=60000",
    ],
  );
  assertThrows(
    () => new AzWebappDeploySettings().name("w").resourceGroup("rg").argv(),
    Error,
    "one artifact",
  );
});

Deno.test("webapp: show, appsettings set, slot swap", () => {
  assertEquals(
    args(new AzWebappShowSettings().name("web").resourceGroup("rg")),
    [
      "webapp",
      "show",
      "--name=web",
      "--resource-group=rg",
    ],
  );
  assertEquals(
    args(
      new AzWebappShowSettings().name("web").resourceGroup("rg").slot("s"),
    ),
    ["webapp", "show", "--name=web", "--resource-group=rg", "--slot=s"],
  );
  assertEquals(
    args(
      new AzWebappConfigAppsettingsSetSettings().name("web").resourceGroup("rg")
        .setting("MODE", "prod").keyVaultReference(
          "DB",
          "https://kv.vault.azure.net/secrets/db",
        ).slotSetting("SLOT", "blue").slot("staging"),
    ),
    [
      "webapp",
      "config",
      "appsettings",
      "set",
      "--name=web",
      "--resource-group=rg",
      "--settings",
      "MODE=prod",
      '{"DB":"@Microsoft.KeyVault(SecretUri=https://kv.vault.azure.net/secrets/db)"}',
      "--slot-settings",
      "SLOT=blue",
      "--slot=staging",
    ],
  );
  assertEquals(
    args(
      new AzWebappConfigAppsettingsSetSettings().name("w").resourceGroup("rg")
        .slotSetting("A", "1"),
    ),
    [
      "webapp",
      "config",
      "appsettings",
      "set",
      "--name=w",
      "--resource-group=rg",
      "--slot-settings",
      "A=1",
    ],
  );
  assertThrows(
    () =>
      new AzWebappConfigAppsettingsSetSettings().name("w").resourceGroup("rg")
        .argv(),
    Error,
    "no settings",
  );
  for (const uri of ["http://kv/secret", "https://kv/(x)", "https://kv/ x"]) {
    assertThrows(
      () =>
        new AzWebappConfigAppsettingsSetSettings().keyVaultReference("A", uri),
      Error,
      "Key Vault reference",
    );
  }
  assertEquals(
    args(
      new AzWebappDeploymentSlotSwapSettings().name("web").resourceGroup("rg")
        .slot("staging"),
    ),
    [
      "webapp",
      "deployment",
      "slot",
      "swap",
      "--name=web",
      "--resource-group=rg",
      "--slot=staging",
    ],
  );
  assertEquals(
    args(
      new AzWebappDeploymentSlotSwapSettings().name("web").resourceGroup("rg")
        .slot("staging").targetSlot("prod2").action("preview")
        .preserveVnet(false),
    ),
    [
      "webapp",
      "deployment",
      "slot",
      "swap",
      "--name=web",
      "--resource-group=rg",
      "--slot=staging",
      "--target-slot=prod2",
      "--action=preview",
      "--preserve-vnet=false",
    ],
  );
  assertThrows(
    () =>
      new AzWebappDeploymentSlotSwapSettings().name("w").resourceGroup("rg")
        .argv(),
    Error,
    "no slot",
  );
});

Deno.test("functionapp: deployment source config-zip", () => {
  assertEquals(
    args(
      new AzFunctionappDeploymentSourceConfigZipSettings().name("fn")
        .resourceGroup("rg").src("fn.zip"),
    ),
    [
      "functionapp",
      "deployment",
      "source",
      "config-zip",
      "--name=fn",
      "--resource-group=rg",
      "--src=fn.zip",
    ],
  );
  assertEquals(
    args(
      new AzFunctionappDeploymentSourceConfigZipSettings().name("fn")
        .resourceGroup("rg").src("fn.zip").buildRemote(true).timeout(300)
        .slot("staging"),
    ),
    [
      "functionapp",
      "deployment",
      "source",
      "config-zip",
      "--name=fn",
      "--resource-group=rg",
      "--src=fn.zip",
      "--build-remote=true",
      "--timeout=300",
      "--slot=staging",
    ],
  );
  assertThrows(
    () =>
      new AzFunctionappDeploymentSourceConfigZipSettings().name("f")
        .resourceGroup("rg").argv(),
    Error,
    "no package",
  );
});

Deno.test("keyvault: secret show and set", () => {
  assertEquals(
    args(new AzKeyvaultSecretShowSettings().vaultName("kv").name("db")),
    [
      "keyvault",
      "secret",
      "show",
      "--vault-name=kv",
      "--name=db",
      "--output=json",
    ],
  );
  assertEquals(
    args(
      new AzKeyvaultSecretShowSettings().id("https://kv/secrets/db/1")
        .version("1"),
    ),
    [
      "keyvault",
      "secret",
      "show",
      "--id=https://kv/secrets/db/1",
      "--version=1",
      "--output=json",
    ],
  );
  assertThrows(
    () => new AzKeyvaultSecretShowSettings().vaultName("kv").argv(),
    Error,
    "no secret named",
  );
  assertEquals(
    args(
      new AzKeyvaultSecretSetSettings().vaultName("kv").name("cert")
        .file("cert.pem").encoding("utf-8").contentType("pem")
        .expires(new Date("2027-01-01T00:00:00Z")).notBefore(
          "2026-10-07T00:00:00Z",
        )
        .disabled(false).tag("owner", "ci"),
    ),
    [
      "keyvault",
      "secret",
      "set",
      "--vault-name=kv",
      "--name=cert",
      "--file=cert.pem",
      "--encoding=utf-8",
      "--content-type=pem",
      "--expires=2027-01-01T00:00:00Z",
      "--not-before=2026-10-07T00:00:00Z",
      "--disabled=false",
      "--tags",
      "owner=ci",
      "--output=json",
    ],
  );
  assertEquals(
    args(
      new AzKeyvaultSecretSetSettings().vaultName("kv").name("db")
        .value("db-password-value").expires("2027-01-01T00:00:00Z")
        .notBefore(new Date("2026-10-07T00:00:00Z")),
    ),
    [
      "keyvault",
      "secret",
      "set",
      "--vault-name=kv",
      "--name=db",
      "--value=@-",
      "--expires=2027-01-01T00:00:00Z",
      "--not-before=2026-10-07T00:00:00Z",
      "--output=json",
    ],
  );
  assertThrows(
    () => new AzKeyvaultSecretSetSettings().vaultName("kv").name("db").argv(),
    Error,
    "one value",
  );
});

Deno.test("deployment group: create, what-if, show", () => {
  assertEquals(
    args(
      new AzDeploymentGroupCreateSettings().resourceGroup("rg")
        .templateFile("main.bicep"),
    ),
    [
      "deployment",
      "group",
      "create",
      "--resource-group=rg",
      "--template-file=main.bicep",
      "--no-prompt=true",
    ],
  );
  assertEquals(
    args(
      new AzDeploymentGroupCreateSettings().name("rel").resourceGroup("rg")
        .templateUri("https://x/t.json").parametersFile("p.json")
        .parameter("tag", "1.4").parameter("replicas", 3)
        .parameter("public", true).mode("Complete").noWait(),
    ),
    [
      "deployment",
      "group",
      "create",
      "--name=rel",
      "--resource-group=rg",
      "--template-uri=https://x/t.json",
      "--parameters=p.json",
      "--parameters=tag=1.4",
      "--parameters=replicas=3",
      "--parameters=public=true",
      "--mode=Complete",
      "--no-prompt=true",
      "--no-wait",
    ],
  );
  assertEquals(
    args(
      new AzDeploymentGroupWhatIfSettings().resourceGroup("rg")
        .templateSpec("/subscriptions/s/templateSpecs/t/versions/1")
        .resultFormat("ResourceIdOnly")
        .excludeChangeTypes("NoChange", "Ignore").noPrettyPrint(),
    ),
    [
      "deployment",
      "group",
      "what-if",
      "--resource-group=rg",
      "--template-spec=/subscriptions/s/templateSpecs/t/versions/1",
      "--no-prompt=true",
      "--result-format=ResourceIdOnly",
      "--exclude-change-types",
      "NoChange",
      "Ignore",
      "--no-pretty-print",
    ],
  );
  assertEquals(
    args(
      new AzDeploymentGroupWhatIfSettings().resourceGroup("rg")
        .templateFile("t.json"),
    ),
    [
      "deployment",
      "group",
      "what-if",
      "--resource-group=rg",
      "--template-file=t.json",
      "--no-prompt=true",
    ],
  );
  assertEquals(
    args(new AzDeploymentGroupShowSettings().name("rel").resourceGroup("rg")),
    ["deployment", "group", "show", "--name=rel", "--resource-group=rg"],
  );
  assertThrows(
    () => new AzDeploymentGroupCreateSettings().resourceGroup("rg").argv(),
    Error,
    "one template",
  );
  assertThrows(
    () =>
      new AzDeploymentGroupCreateSettings().resourceGroup("rg")
        .templateFile("a").templateUri("b").argv(),
    Error,
    "one template",
  );
  assertThrows(
    () => new AzDeploymentGroupCreateSettings().templateFile("a").argv(),
    Error,
    "no resource group",
  );
});

Deno.test("storage blob: upload, download, upload-batch", () => {
  assertEquals(
    args(
      new AzStorageBlobUploadSettings().containerName("c").name("b")
        .file("f.txt"),
    ),
    [
      "storage",
      "blob",
      "upload",
      "--container-name=c",
      "--name=b",
      "--file=f.txt",
    ],
  );
  assertEquals(
    args(
      new AzStorageBlobUploadSettings().accountName("st").authMode("login")
        .containerName("c").name("b").file("f.txt").overwrite(true)
        .contentType("text/plain").contentCacheControl("no-cache")
        .tag("v", "1"),
    ),
    [
      "storage",
      "blob",
      "upload",
      "--account-name=st",
      "--auth-mode=login",
      "--container-name=c",
      "--name=b",
      "--file=f.txt",
      "--overwrite=true",
      "--content-type=text/plain",
      "--content-cache-control=no-cache",
      "--tags",
      "v=1",
    ],
  );
  assertEquals(
    args(
      new AzStorageBlobDownloadSettings().accountName("st")
        .accountKey("account-key-value").containerName("c").name("b")
        .file("out").overwrite(false),
    ),
    [
      "storage",
      "blob",
      "download",
      "--account-name=st",
      "--account-key=@-",
      "--container-name=c",
      "--name=b",
      "--file=out",
      "--overwrite=false",
    ],
  );
  assertEquals(
    args(
      new AzStorageBlobDownloadSettings().containerName("c").name("b")
        .file("out"),
    ),
    [
      "storage",
      "blob",
      "download",
      "--container-name=c",
      "--name=b",
      "--file=out",
    ],
  );
  assertEquals(
    args(
      new AzStorageBlobUploadBatchSettings().sasToken("sv=2026&sig=abc")
        .source("dist").destination("$web").pattern("*.html")
        .destinationPath("v2").overwrite(true).dryrun(),
    ),
    [
      "storage",
      "blob",
      "upload-batch",
      "--sas-token=@-",
      "--source=dist",
      "--destination=$web",
      "--pattern=*.html",
      "--destination-path=v2",
      "--overwrite=true",
      "--dryrun",
    ],
  );
  assertEquals(
    args(
      new AzStorageBlobUploadBatchSettings()
        .connectionString("DefaultEndpointsProtocol=https;AccountKey=k")
        .source("dist").destination("c"),
    ),
    [
      "storage",
      "blob",
      "upload-batch",
      "--connection-string=@-",
      "--source=dist",
      "--destination=c",
    ],
  );
  assertThrows(
    () =>
      new AzStorageBlobUploadBatchSettings().accountKey("k1").sasToken("t1")
        .source("d").destination("c").argv(),
    Error,
    "one credential",
  );
  assertThrows(
    () => new AzStorageBlobUploadSettings().argv(),
    Error,
    "no container",
  );
  assertThrows(
    () => new AzStorageBlobDownloadSettings().containerName("c").argv(),
    Error,
    "no blob named",
  );
  assertThrows(
    () => new AzStorageBlobUploadBatchSettings().source("d").argv(),
    Error,
    "no destination",
  );
});

Deno.test("every typed task reaches execution", async () => {
  const tasks: Array<() => Promise<unknown>> = [
    () => AzTasks.login((s) => missingTool(s.identity())),
    () => AzTasks.logout((s) => missingTool(s)),
    () => AzTasks.accountShow((s) => missingTool(s)),
    () => AzTasks.accountSet((s) => missingTool(s.subscription("x"))),
    () => AzTasks.accountList((s) => missingTool(s)),
    () => AzTasks.accountGetAccessToken((s) => missingTool(s)),
    () => AzTasks.groupCreate((s) => missingTool(s.name("g").location("l"))),
    () => AzTasks.groupShow((s) => missingTool(s.name("g"))),
    () => AzTasks.groupDelete((s) => missingTool(s.name("g"))),
    () => AzTasks.groupExists((s) => missingTool(s.name("g"))),
    () => AzTasks.acrLogin((s) => missingTool(s.name("r"))),
    () => AzTasks.acrBuild((s) => missingTool(s.registry("r").source("."))),
    () =>
      AzTasks.acrRepositoryShowTags((s) =>
        missingTool(s.name("r").repository("a"))
      ),
    () =>
      AzTasks.acrRepositoryDelete((s) => missingTool(s.name("r").image("a:1"))),
    () =>
      AzTasks.aksGetCredentials((s) =>
        missingTool(s.name("k").resourceGroup("g"))
      ),
    () => AzTasks.aksShow((s) => missingTool(s.name("k").resourceGroup("g"))),
    () =>
      AzTasks.containerappUpdate((s) =>
        missingTool(s.name("a").resourceGroup("g"))
      ),
    () =>
      AzTasks.containerappShow((s) =>
        missingTool(s.name("a").resourceGroup("g"))
      ),
    () =>
      AzTasks.containerappRevisionList((s) =>
        missingTool(s.name("a").resourceGroup("g"))
      ),
    () =>
      AzTasks.containerappRevisionActivate((s) =>
        missingTool(s.name("a").resourceGroup("g").revision("r"))
      ),
    () =>
      AzTasks.containerappRevisionDeactivate((s) =>
        missingTool(s.name("a").resourceGroup("g").revision("r"))
      ),
    () =>
      AzTasks.containerappIngressTrafficSet((s) =>
        missingTool(
          s.name("a").resourceGroup("g").revisionWeight("latest", 100),
        )
      ),
    () =>
      AzTasks.webappDeploy((s) =>
        missingTool(s.name("w").resourceGroup("g").srcPath("a.zip"))
      ),
    () =>
      AzTasks.webappShow((s) => missingTool(s.name("w").resourceGroup("g"))),
    () =>
      AzTasks.webappConfigAppsettingsSet((s) =>
        missingTool(s.name("w").resourceGroup("g").setting("A", "1"))
      ),
    () =>
      AzTasks.webappDeploymentSlotSwap((s) =>
        missingTool(s.name("w").resourceGroup("g").slot("s"))
      ),
    () =>
      AzTasks.functionappDeploymentSourceConfigZip((s) =>
        missingTool(s.name("f").resourceGroup("g").src("a.zip"))
      ),
    () =>
      AzTasks.keyvaultSecretShow((s) =>
        missingTool(s.vaultName("kv").name("s"))
      ),
    () =>
      AzTasks.keyvaultSecretSet((s) =>
        missingTool(s.vaultName("kv").name("s").file("f"))
      ),
    () =>
      AzTasks.deploymentGroupCreate((s) =>
        missingTool(s.resourceGroup("g").templateFile("t"))
      ),
    () =>
      AzTasks.deploymentGroupShow((s) =>
        missingTool(s.name("d").resourceGroup("g"))
      ),
    () =>
      AzTasks.deploymentGroupWhatIf((s) =>
        missingTool(s.resourceGroup("g").templateFile("t"))
      ),
    () =>
      AzTasks.storageBlobUpload((s) =>
        missingTool(s.containerName("c").name("b").file("f"))
      ),
    () =>
      AzTasks.storageBlobDownload((s) =>
        missingTool(s.containerName("c").name("b").file("f"))
      ),
    () =>
      AzTasks.storageBlobUploadBatch((s) =>
        missingTool(s.source("d").destination("c"))
      ),
    () => AzTasks.monitorMetricsList((s) => missingTool(s.resource("r"))),
    () =>
      AzTasks.monitorMetricsListDefinitions((s) =>
        missingTool(s.resource("r"))
      ),
    () => AzTasks.monitorMetricsAlertList((s) => missingTool(s)),
    () =>
      AzTasks.monitorMetricsAlertShow((s) =>
        missingTool(s.name("a").resourceGroup("g"))
      ),
    () => AzTasks.monitorActivityLogList((s) => missingTool(s)),
    () =>
      AzTasks.monitorLogAnalyticsQuery((s) =>
        missingTool(s.workspace("w").analyticsQuery("q"))
      ),
  ];
  for (const task of tasks) await assertRejects(task, ToolNotFoundError);
});

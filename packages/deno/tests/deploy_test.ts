// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `DenoDeployTasks`: the argv of every `deno deploy` subcommand, its guards,
 * and that each task reaches execution. Every full argv below was given to
 * `deno deploy` 0.0.9908 (Deno 2.8.3) with `--non-interactive --json` and a
 * dummy token, and parsed: each failed with `AUTH_INVALID_TOKEN`, where an
 * unknown flag or value fails with `VALIDATION_ERROR`.
 */

import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import { missingTool } from "@zuke/core/tooling/conformance";
import {
  DenoDeployAppsGetSettings,
  DenoDeployAppsListSettings,
  DenoDeployCreateSettings,
  DenoDeployDeploymentsListSettings,
  DenoDeployEnvDeleteSettings,
  DenoDeployEnvListSettings,
  DenoDeployEnvLoadSettings,
  DenoDeployEnvUpdateContextsSettings,
  DenoDeployEnvValueSettings,
  DenoDeployLogsSettings,
  DenoDeployQuerySettings,
  DenoDeploySettings,
  DenoDeployTasks,
} from "../mod.ts";

/** The argv after the binary. */
function args(settings: { argv(): string[] }): string[] {
  return settings.argv().slice(1);
}

Deno.test("deploy: shared flags, then the command's own, root last", () => {
  assertEquals(args(new DenoDeploySettings()), ["deploy"]);
  assertEquals(
    args(
      new DenoDeploySettings().org("acme").app("api").config("deploy.json")
        .json().nonInteractive().quietOutput().prod().ignore("tmp")
        .allowNodeModules().noWait().root("-dist"),
    ),
    [
      "deploy",
      "--org=acme",
      "--app=api",
      "--config=deploy.json",
      "--json",
      "--non-interactive",
      "--quiet",
      "--prod",
      "--ignore=tmp",
      "--allow-node-modules",
      "--no-wait",
      "./-dist",
    ],
  );
});

Deno.test("deploy: the token goes to DENO_DEPLOY_TOKEN, masked, not the argv", () => {
  class Spy extends DenoDeploySettings {
    readonly marked: string[] = [];
    readonly envs: Array<Record<string, string>> = [];
    protected override markSecret(value: string): void {
      this.marked.push(value);
    }
    override env(record: Record<string, string>): this {
      this.envs.push(record);
      return super.env(record);
    }
  }
  const settings = new Spy().token("ddp_secret");
  assertEquals(settings.marked, ["ddp_secret"]);
  assertEquals(settings.envs, [{ DENO_DEPLOY_TOKEN: "ddp_secret" }]);
  assertEquals(args(settings), ["deploy"]);
});

Deno.test("env: a secret value is masked, a plain one is not", () => {
  class Spy extends DenoDeployEnvValueSettings {
    readonly marked: string[] = [];
    protected override markSecret(value: string): void {
      this.marked.push(value);
    }
  }
  assertEquals(new Spy("add").secretValue("sk-1").marked, ["sk-1"]);
  assertEquals(new Spy("add").value("prod").marked, []);
});

Deno.test("create: every flag the wrapper exposes", () => {
  assertEquals(
    args(
      new DenoDeployCreateSettings().org("acme").app("web").nonInteractive()
        .dryRun().source("github").repository("acme", "web")
        .appDirectory("apps/web").doNotUseDetectedBuildConfig()
        .frameworkPreset("fresh").installCommand("deno install")
        .buildCommand("deno task build").preDeployCommand("deno task migrate")
        .runtimeMode("dynamic").entrypoint("main.ts").argument("--port")
        .argument("8000").workingDirectory("apps/web").staticDir("dist")
        .singlePageApp().buildTimeout("10m").buildMemoryLimit(2048)
        .region("eu").noWait().root("."),
    ),
    [
      "deploy",
      "create",
      "--org=acme",
      "--app=web",
      "--non-interactive",
      "--dry-run",
      "--source=github",
      "--owner=acme",
      "--repo=web",
      "--app-directory=apps/web",
      "--do-not-use-detected-build-config",
      "--framework-preset=fresh",
      "--install-command=deno install",
      "--build-command=deno task build",
      "--pre-deploy-command=deno task migrate",
      "--runtime-mode=dynamic",
      "--entrypoint=main.ts",
      "--arguments=--port",
      "--arguments=8000",
      "--working-directory=apps/web",
      "--static-dir=dist",
      "--single-page-app",
      "--build-timeout=10m",
      "--build-memory-limit=2048",
      "--region=eu",
      "--no-wait",
      ".",
    ],
  );
  assertEquals(args(new DenoDeployCreateSettings()), ["deploy", "create"]);
});

Deno.test("env: list, add, update-value, update-contexts, delete", () => {
  assertEquals(args(new DenoDeployEnvListSettings().app("api")), [
    "deploy",
    "env",
    "list",
    "--app=api",
  ]);
  assertEquals(
    args(
      new DenoDeployEnvValueSettings("add").app("api").variable("API_KEY")
        .secretValue("sk-1"),
    ),
    ["deploy", "env", "add", "--app=api", "--secret", "API_KEY", "sk-1"],
  );
  assertEquals(
    args(new DenoDeployEnvValueSettings("add").variable("MODE").value("prod")),
    ["deploy", "env", "add", "MODE", "prod"],
  );
  // update-value has no --secret: a secret value is only masked.
  assertEquals(
    args(
      new DenoDeployEnvValueSettings("update-value").variable("API_KEY")
        .secretValue("sk-2"),
    ),
    ["deploy", "env", "update-value", "API_KEY", "sk-2"],
  );
  assertEquals(
    args(
      new DenoDeployEnvUpdateContextsSettings().variable("API_KEY")
        .context("production").context("preview"),
    ),
    ["deploy", "env", "update-contexts", "API_KEY", "production", "preview"],
  );
  assertEquals(
    args(new DenoDeployEnvDeleteSettings().variable("API_KEY")),
    ["deploy", "env", "delete", "API_KEY"],
  );
});

Deno.test("env load: file first, --non-secrets and its keys last", () => {
  assertEquals(
    args(new DenoDeployEnvLoadSettings().file(".env.production")),
    ["deploy", "env", "load", ".env.production"],
  );
  assertEquals(
    args(
      new DenoDeployEnvLoadSettings().app("api").nonSecret("MODE")
        .nonSecret("REGION").replace().skipExisting().file("-env"),
    ),
    [
      "deploy",
      "env",
      "load",
      "--app=api",
      "./-env",
      "--replace",
      "--skip-existing",
      "--non-secrets",
      "MODE",
      "REGION",
    ],
  );
});

Deno.test("env: required parts and unsafe values are refused", () => {
  assertThrows(
    () => args(new DenoDeployEnvValueSettings("add").value("x")),
    Error,
    "DenoDeployTasks.envAdd: .variable() is required.",
  );
  assertThrows(
    () => args(new DenoDeployEnvValueSettings("update-value").variable("A")),
    Error,
    "DenoDeployTasks.envUpdateValue: .value() or .secretValue() is required.",
  );
  assertThrows(
    () => new DenoDeployEnvValueSettings("add").value(""),
    Error,
    "DenoDeployTasks.envAdd: the value is empty",
  );
  assertThrows(
    () => new DenoDeployEnvValueSettings("add").value("--prod"),
    Error,
    "load it from a file",
  );
  assertThrows(
    () => new DenoDeployEnvValueSettings("add").variable("NOT A NAME"),
    Error,
    "is not an environment variable name",
  );
  assertThrows(
    () => new DenoDeployEnvLoadSettings().nonSecret("--replace"),
    Error,
    "DenoDeployTasks.envLoad:",
  );
  assertThrows(
    () => args(new DenoDeployEnvLoadSettings()),
    Error,
    "DenoDeployTasks.envLoad: .file() is required.",
  );
  assertThrows(
    () => args(new DenoDeployEnvUpdateContextsSettings()),
    Error,
    "DenoDeployTasks.envUpdateContexts: .variable() is required.",
  );
  assertThrows(
    () => new DenoDeployEnvUpdateContextsSettings().context("-x"),
    Error,
    "would be read as a flag",
  );
  assertThrows(
    () => args(new DenoDeployEnvDeleteSettings()),
    Error,
    "DenoDeployTasks.envDelete: .variable() is required.",
  );
});

Deno.test("logs, deployments, apps, orgs and whoami", () => {
  assertEquals(
    args(
      new DenoDeployLogsSettings().app("api")
        .start(new Date("2026-01-01T00:00:00Z")).end("2026-01-02T00:00:00Z")
        .once(),
    ),
    [
      "deploy",
      "logs",
      "--app=api",
      "--start=2026-01-01T00:00:00.000Z",
      "--end=2026-01-02T00:00:00Z",
      "--once",
    ],
  );
  assertEquals(
    args(
      new DenoDeployDeploymentsListSettings().app("api").limit(5)
        .cursor("abc").status("failed"),
    ),
    [
      "deploy",
      "deployments",
      "list",
      "--app=api",
      "--limit=5",
      "--cursor=abc",
      "--status=failed",
    ],
  );
  assertEquals(args(new DenoDeployAppsListSettings().org("acme").limit(50)), [
    "deploy",
    "apps",
    "list",
    "--org=acme",
    "--limit=50",
  ]);
  assertEquals(args(new DenoDeployAppsListSettings()), [
    "deploy",
    "apps",
    "list",
  ]);
  assertEquals(args(new DenoDeployAppsGetSettings().org("acme").app("api")), [
    "deploy",
    "apps",
    "get",
    "--org=acme",
    "--app=api",
  ]);
  assertEquals(args(new DenoDeployQuerySettings("orgs list")), [
    "deploy",
    "orgs",
    "list",
  ]);
  assertEquals(args(new DenoDeployQuerySettings("whoami").json()), [
    "deploy",
    "whoami",
    "--json",
  ]);
  assertThrows(
    () => args(new DenoDeployLogsSettings().end("2026-01-02T00:00:00Z")),
    Error,
    "DenoDeployTasks.logs: .end() needs a .start()",
  );
  assertThrows(
    () => new DenoDeployAppsListSettings().limit(0),
    Error,
    "DenoDeployTasks.appsList: .limit() takes a whole number from 1 up",
  );
  assertThrows(
    () => new DenoDeployDeploymentsListSettings().limit(2.5),
    Error,
    "DenoDeployTasks.deploymentsList:",
  );
});

Deno.test("DenoDeployTasks: every task reaches execution with its command", async () => {
  const seen: string[][] = [];
  const probe = <S extends { argv(): string[] }>(s: S): S => {
    seen.push(args(s));
    return s;
  };
  const tasks: Array<() => Promise<unknown>> = [
    () => DenoDeployTasks.deploy((s) => missingTool(probe(s))),
    () => DenoDeployTasks.create((s) => missingTool(probe(s))),
    () => DenoDeployTasks.envList((s) => missingTool(probe(s))),
    () =>
      DenoDeployTasks.envAdd((s) =>
        missingTool(probe(s.variable("A").value("1")))
      ),
    () =>
      DenoDeployTasks.envUpdateValue((s) =>
        missingTool(probe(s.variable("A").value("2")))
      ),
    () =>
      DenoDeployTasks.envUpdateContexts((s) =>
        missingTool(probe(s.variable("A")))
      ),
    () => DenoDeployTasks.envDelete((s) => missingTool(probe(s.variable("A")))),
    () => DenoDeployTasks.envLoad((s) => missingTool(probe(s.file(".env")))),
    () => DenoDeployTasks.logs((s) => missingTool(probe(s))),
    () => DenoDeployTasks.deploymentsList((s) => missingTool(probe(s))),
    () => DenoDeployTasks.appsList((s) => missingTool(probe(s))),
    () => DenoDeployTasks.appsGet((s) => missingTool(probe(s))),
    () => DenoDeployTasks.orgsList((s) => missingTool(probe(s))),
    () => DenoDeployTasks.whoami((s) => missingTool(probe(s))),
  ];
  for (const task of tasks) await assertRejects(task, ToolNotFoundError);
  assertEquals(seen, [
    ["deploy"],
    ["deploy", "create"],
    ["deploy", "env", "list"],
    ["deploy", "env", "add", "A", "1"],
    ["deploy", "env", "update-value", "A", "2"],
    ["deploy", "env", "update-contexts", "A"],
    ["deploy", "env", "delete", "A"],
    ["deploy", "env", "load", ".env"],
    ["deploy", "logs"],
    ["deploy", "deployments", "list"],
    ["deploy", "apps", "list"],
    ["deploy", "apps", "get"],
    ["deploy", "orgs", "list"],
    ["deploy", "whoami"],
  ]);
});

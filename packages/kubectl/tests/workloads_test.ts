// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import {
  KubectlCpSettings,
  KubectlEventsSettings,
  KubectlExplainSettings,
  KubectlExposeSettings,
  KubectlRolloutSettings,
  KubectlRunSettings,
  KubectlSetEnvSettings,
  KubectlSetResourcesSettings,
} from "../mod.ts";

Deno.test("rollout pause and resume complete the action set", () => {
  assertEquals(
    new KubectlRolloutSettings().pause().resource("deployment/api").argv()
      .slice(1),
    ["rollout", "pause", "deployment/api"],
  );
  assertEquals(
    new KubectlRolloutSettings().resume().resource("deployment/api").namespace(
      "prod",
    ).argv().slice(1),
    ["rollout", "resume", "--namespace", "prod", "deployment/api"],
  );
});

Deno.test("rollout keeps each flag to the action it belongs to", () => {
  // kubectl ignores --to-revision on anything but undo and --timeout on
  // anything but status, so a build would silently not get what it asked for.
  assertThrows(
    () =>
      new KubectlRolloutSettings().pause().resource("deployment/api")
        .toRevision(2).argv(),
    Error,
    "KubectlTasks.rollout: .toRevision(...) is what .undo() rolls back to",
  );
  assertThrows(
    () =>
      new KubectlRolloutSettings().restart().resource("deployment/api").timeout(
        "60s",
      ).argv(),
    Error,
    "KubectlTasks.rollout: .timeout(...) is how long .status() waits",
  );
  assertEquals(
    new KubectlRolloutSettings().undo().resource("deployment/api").toRevision(2)
      .argv().slice(1),
    ["rollout", "undo", "deployment/api", "--to-revision=2"],
  );
  assertEquals(
    new KubectlRolloutSettings().status().resource("deployment/api").timeout(
      "60s",
    ).argv().slice(1),
    ["rollout", "status", "deployment/api", "--timeout=60s"],
  );
});

Deno.test("set env renders its variables and its injections", () => {
  assertEquals(
    new KubectlSetEnvSettings().resource("deployment/api").set(
      "LOG_LEVEL",
      "debug",
    ).remove("OLD_FLAG").containers("api").argv().slice(1),
    [
      "set",
      "env",
      "deployment/api",
      "-c",
      "api",
      "-e",
      "LOG_LEVEL=debug",
      "-e",
      "OLD_FLAG-",
    ],
  );
  assertEquals(
    new KubectlSetEnvSettings().all().from("secret/db").keys("USER", "PASS")
      .prefix("DB_").overwrite(false).argv().slice(1),
    [
      "set",
      "env",
      "--all",
      "--from=secret/db",
      "--keys=USER,PASS",
      "--prefix=DB_",
      "--overwrite=false",
    ],
  );
  assertEquals(
    new KubectlSetEnvSettings().resource("deployment/api").list().resolve()
      .argv().slice(1),
    ["set", "env", "deployment/api", "--list", "--resolve"],
  );
});

Deno.test("set env refuses what kubectl would quietly ignore", () => {
  assertThrows(
    () => new KubectlSetEnvSettings().resource("deployment/api").argv(),
    Error,
    "KubectlTasks.setEnv: name a variable with .set(...)/.remove(...)",
  );
  assertThrows(
    () => new KubectlSetEnvSettings().set("A", "b").argv(),
    Error,
    "KubectlTasks.setEnv: name what to change with .resource(...)",
  );
  assertThrows(
    () =>
      new KubectlSetEnvSettings().resource("d/api").set("A", "b").keys("X")
        .argv(),
    Error,
    "KubectlTasks.setEnv: .keys(...) picks from the .from(...) resource",
  );
  assertThrows(
    () =>
      new KubectlSetEnvSettings().resource("d/api").set("A", "b").resolve()
        .argv(),
    Error,
    "KubectlTasks.setEnv: .resolve() shows what a listing's references",
  );
  // --local rewrites a manifest, so there has to be one.
  assertThrows(
    () => new KubectlSetEnvSettings().all().set("A", "b").local().argv(),
    Error,
    "KubectlTasks.setEnv: .local() rewrites a manifest",
  );
});

Deno.test("set resources renders its limits and requests", () => {
  assertEquals(
    new KubectlSetResourcesSettings().resource("deployment/api").limit(
      "cpu",
      "500m",
    ).limit("memory", "512Mi").request("cpu", "100m").argv().slice(1),
    [
      "set",
      "resources",
      "deployment/api",
      "--limits=cpu=500m,memory=512Mi",
      "--requests=cpu=100m",
    ],
  );
  assertThrows(
    () => new KubectlSetResourcesSettings().resource("d/api").argv(),
    Error,
    "KubectlTasks.setResources: .limit(...) or .request(...) is required",
  );
});

Deno.test("run puts its command after the separator", () => {
  assertEquals(
    new KubectlRunSettings()
      .name("migrate")
      .image("api:1.4")
      .restart("Never")
      .envVar("DATABASE_URL", "postgres://db")
      .labels("job=migrate")
      .dryRun("client")
      .command("./migrate", "--up")
      .argv()
      .slice(1),
    [
      "run",
      "migrate",
      "--image=api:1.4",
      "--restart=Never",
      "--env=DATABASE_URL=postgres://db",
      "--labels=job=migrate",
      "--dry-run=client",
      "--command",
      "--",
      "./migrate",
      "--up",
    ],
  );
  assertThrows(
    () => new KubectlRunSettings().image("api:1.4").argv(),
    Error,
    "KubectlTasks.run: .name(...) is required",
  );
  assertThrows(
    () => new KubectlRunSettings().name("migrate").argv(),
    Error,
    "KubectlTasks.run: .image(...) is required",
  );
  // --expose builds a service for a port, so kubectl needs one.
  assertThrows(
    () => new KubectlRunSettings().name("x").image("i").expose().argv(),
    Error,
    "KubectlTasks.run: .expose() creates a service for a port",
  );
  assertEquals(
    new KubectlRunSettings().name("probe").image("busybox").port(8080).expose()
      .overrides('{"spec":{"nodeName":"w1"}}').argv().slice(1),
    [
      "run",
      "probe",
      "--image=busybox",
      "--port=8080",
      "--expose",
      '--overrides={"spec":{"nodeName":"w1"}}',
    ],
  );
});

Deno.test("expose spells selector and labels in full, because -l means labels here", () => {
  // Every other kubectl command reads -l as --selector; expose reads it as
  // --labels. Spelling both out is what keeps them from swapping.
  assertEquals(
    new KubectlExposeSettings()
      .resource("deployment/api")
      .port(80)
      .targetPort(8080)
      .type("LoadBalancer")
      .name("api-svc")
      .protocol("TCP")
      .selector("app=api")
      .labels("tier=web")
      .sessionAffinity("ClientIP")
      .argv()
      .slice(1),
    [
      "expose",
      "deployment/api",
      "--port=80",
      "--target-port=8080",
      "--type=LoadBalancer",
      "--name=api-svc",
      "--protocol=TCP",
      "--selector=app=api",
      "--labels=tier=web",
      "--session-affinity=ClientIP",
    ],
  );
  assertThrows(
    () => new KubectlExposeSettings().argv(),
    Error,
    "KubectlTasks.expose: name what to expose with .resource(...)",
  );
  assertThrows(
    () => new KubectlExposeSettings().resource("d/api").file("svc.yaml").argv(),
    Error,
    "KubectlTasks.expose: .resource(...) and .file(...) are two ways",
  );
  assertEquals(
    new KubectlExposeSettings().file("k8s/api.yaml").port(80).dryRun().argv()
      .slice(1),
    ["expose", "-f", "k8s/api.yaml", "--port=80", "--dry-run=client"],
  );
});

Deno.test("cp copies between a pod and the local filesystem, one way or the other", () => {
  assertEquals(
    new KubectlCpSettings().from("prod/api-0:/out/report.xml").to("reports/")
      .container("api").retries(3).argv().slice(1),
    [
      "cp",
      "prod/api-0:/out/report.xml",
      "reports/",
      "-c",
      "api",
      "--retries=3",
    ],
  );
  assertEquals(
    new KubectlCpSettings().from("fixtures/").to("api-0:/data").noPreserve()
      .argv().slice(1),
    ["cp", "fixtures/", "api-0:/data", "--no-preserve"],
  );
  assertThrows(
    () => new KubectlCpSettings().from("a").argv(),
    Error,
    "KubectlTasks.cp: .from(...) and .to(...) are both required",
  );
  // kubectl copies between a pod and the local filesystem — never local to
  // local, and never pod to pod.
  assertThrows(
    () => new KubectlCpSettings().from("a/").to("b/").argv(),
    Error,
    "KubectlTasks.cp: one side has to name a pod",
  );
  assertThrows(
    () => new KubectlCpSettings().from("p1:/a").to("p2:/b").argv(),
    Error,
    "KubectlTasks.cp: kubectl copies between a pod and the local filesystem",
  );
});

Deno.test("events renders its filters", () => {
  assertEquals(
    new KubectlEventsSettings().namespace("prod").forResource("deploy/api")
      .types("Warning").allNamespaces().watch().noHeaders().output("json")
      .argv().slice(1),
    [
      "events",
      "--namespace",
      "prod",
      "--for=deploy/api",
      "--types=Warning",
      "-A",
      "--watch",
      "--no-headers",
      "-o",
      "json",
    ],
  );
  assertEquals(new KubectlEventsSettings().argv().slice(1), ["events"]);
});

Deno.test("the set commands take a manifest, a selector, or a dry run", () => {
  assertEquals(
    new KubectlSetEnvSettings().file("k8s/api.yaml").local().set("A", "b")
      .selector("app=api").dryRun("server").argv().slice(1),
    [
      "set",
      "env",
      "-f",
      "k8s/api.yaml",
      "-l",
      "app=api",
      "--local",
      "-e",
      "A=b",
      "--dry-run=server",
    ],
  );
  assertEquals(
    new KubectlSetResourcesSettings().all().request("memory", "64Mi").dryRun()
      .argv().slice(1),
    ["set", "resources", "--all", "--requests=memory=64Mi", "--dry-run=client"],
  );
});

Deno.test("explain caps its recursion only when it recurses", () => {
  assertEquals(
    new KubectlExplainSettings().type("deployments.spec").recursive().maxDepth(
      3,
    ).apiVersion("apps/v1").output("plaintext").argv().slice(1),
    [
      "explain",
      "deployments.spec",
      "-R",
      "--max-depth=3",
      "--api-version=apps/v1",
      "-o",
      "plaintext",
    ],
  );
  assertThrows(
    () => new KubectlExplainSettings().argv(),
    Error,
    "KubectlTasks.explain: .type(...) is required",
  );
  // kubectl rejects a positive --max-depth without --recursive.
  assertThrows(
    () => new KubectlExplainSettings().type("pods").maxDepth(3).argv(),
    Error,
    "KubectlTasks.explain: .maxDepth(...) caps the recursion",
  );
  assertEquals(
    new KubectlExplainSettings().type("pods").maxDepth(0).argv().slice(1),
    ["explain", "pods", "--max-depth=0"],
  );
});

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
  defaultComposeProbe,
  DockerComposeBuildSettings,
  DockerComposeConfigSettings,
  DockerComposeDownSettings,
  DockerComposeExecSettings,
  DockerComposeLogsSettings,
  DockerComposePsSettings,
  DockerComposePullSettings,
  DockerComposePushSettings,
  DockerComposeRestartSettings,
  DockerComposeRmSettings,
  DockerComposeRunSettings,
  DockerComposeStartSettings,
  DockerComposeStopSettings,
  DockerComposeTasks,
  DockerComposeUpSettings,
  resetComposeInvocationCache_,
  resolveComposeInvocation,
} from "../src/docker_compose.ts";

Deno.test("the default invocation is the v2 plugin", () => {
  assertEquals(new DockerComposePsSettings().argv(), [
    "docker",
    "compose",
    "ps",
  ]);
});

Deno.test("useStandalone/usePlugin pin the invocation form", () => {
  assertEquals(new DockerComposePsSettings().useStandalone().argv(), [
    "docker-compose",
    "ps",
  ]);
  assertEquals(new DockerComposePsSettings().usePlugin().argv(), [
    "docker",
    "compose",
    "ps",
  ]);
});

Deno.test("global options precede the subcommand", () => {
  const argv = new DockerComposeUpSettings()
    .file("a.yml").file("b.yml").projectName("proj").profile("dev")
    .projectDirectory("/work").envFile(".env").detach().argv();
  assertEquals(argv, [
    "docker",
    "compose",
    "-f",
    "a.yml",
    "-f",
    "b.yml",
    "-p",
    "proj",
    "--profile",
    "dev",
    "--project-directory",
    "/work",
    "--env-file",
    ".env",
    "up",
    "-d",
  ]);
});

Deno.test("up: all flags, scale, and services", () => {
  const argv = new DockerComposeUpSettings()
    .detach().build().forceRecreate().removeOrphans().wait()
    .abortOnContainerExit().exitCodeFrom("web")
    .scale("web", 3).services("web", "db").argv();
  assertEquals(argv, [
    "docker",
    "compose",
    "up",
    "-d",
    "--build",
    "--force-recreate",
    "--remove-orphans",
    "--wait",
    "--abort-on-container-exit",
    "--exit-code-from",
    "web",
    "--scale",
    "web=3",
    "web",
    "db",
  ]);
  assertEquals(new DockerComposeUpSettings().argv(), [
    "docker",
    "compose",
    "up",
  ]);
});

Deno.test("down: volumes, orphans, rmi, timeout", () => {
  assertEquals(
    new DockerComposeDownSettings().volumes().removeOrphans().rmi("all")
      .timeout(5).argv(),
    [
      "docker",
      "compose",
      "down",
      "-v",
      "--remove-orphans",
      "--rmi",
      "all",
      "-t",
      "5",
    ],
  );
  assertEquals(new DockerComposeDownSettings().argv(), [
    "docker",
    "compose",
    "down",
  ]);
});

Deno.test("build: no-cache, pull, build-arg, services", () => {
  assertEquals(
    new DockerComposeBuildSettings().noCache().pull().buildArg("V", "1")
      .services("web").argv(),
    [
      "docker",
      "compose",
      "build",
      "--no-cache",
      "--pull",
      "--build-arg",
      "V=1",
      "web",
    ],
  );
  assertEquals(new DockerComposeBuildSettings().argv(), [
    "docker",
    "compose",
    "build",
  ]);
});

Deno.test("pull/push build their argv", () => {
  assertEquals(
    new DockerComposePullSettings().ignorePullFailures().quietOutput()
      .services("web").argv(),
    [
      "docker",
      "compose",
      "pull",
      "--ignore-pull-failures",
      "-q",
      "web",
    ],
  );
  assertEquals(new DockerComposePullSettings().argv(), [
    "docker",
    "compose",
    "pull",
  ]);
  assertEquals(
    new DockerComposePushSettings().ignorePushFailures().services("web").argv(),
    ["docker", "compose", "push", "--ignore-push-failures", "web"],
  );
  assertEquals(new DockerComposePushSettings().argv(), [
    "docker",
    "compose",
    "push",
  ]);
});

Deno.test("run: flags, env, and command", () => {
  const argv = new DockerComposeRunSettings()
    .service("web").rm().detach().noDeps().name("c").envVar("K", "v")
    .commandArgs("echo", 1).argv();
  assertEquals(argv, [
    "docker",
    "compose",
    "run",
    "--rm",
    "-d",
    "--no-deps",
    "--name",
    "c",
    "-e",
    "K=v",
    "web",
    "echo",
    "1",
  ]);
  assertEquals(new DockerComposeRunSettings().service("web").argv(), [
    "docker",
    "compose",
    "run",
    "web",
  ]);
});

Deno.test("exec: flags, env, workdir, and command", () => {
  const argv = new DockerComposeExecSettings()
    .service("web").detach().noTty().envVar("K", "v").workdir("/app")
    .commandArgs("sh", "-c", "echo hi").argv();
  assertEquals(argv, [
    "docker",
    "compose",
    "exec",
    "-d",
    "-T",
    "-w",
    "/app",
    "-e",
    "K=v",
    "web",
    "sh",
    "-c",
    "echo hi",
  ]);
  assertEquals(new DockerComposeExecSettings().service("web").argv(), [
    "docker",
    "compose",
    "exec",
    "web",
  ]);
});

Deno.test("logs: follow, timestamps, tail, services", () => {
  assertEquals(
    new DockerComposeLogsSettings().follow().timestamps().tail(100)
      .services("web").argv(),
    [
      "docker",
      "compose",
      "logs",
      "-f",
      "-t",
      "--tail",
      "100",
      "web",
    ],
  );
  assertEquals(new DockerComposeLogsSettings().tail("all").argv(), [
    "docker",
    "compose",
    "logs",
    "--tail",
    "all",
  ]);
  assertEquals(new DockerComposeLogsSettings().argv(), [
    "docker",
    "compose",
    "logs",
  ]);
});

Deno.test("ps: all, quiet, services-only, and service filter", () => {
  assertEquals(
    new DockerComposePsSettings().all().quietOutput().servicesOnly()
      .services("web").argv(),
    [
      "docker",
      "compose",
      "ps",
      "-a",
      "-q",
      "--services",
      "web",
    ],
  );
  assertEquals(new DockerComposePsSettings().argv(), [
    "docker",
    "compose",
    "ps",
  ]);
});

Deno.test("config: quiet, services, volumes, format", () => {
  assertEquals(
    new DockerComposeConfigSettings().quietOutput().servicesOnly().volumesOnly()
      .format("json").argv(),
    [
      "docker",
      "compose",
      "config",
      "-q",
      "--services",
      "--volumes",
      "--format",
      "json",
    ],
  );
  assertEquals(new DockerComposeConfigSettings().argv(), [
    "docker",
    "compose",
    "config",
  ]);
});

Deno.test("start/stop/restart/rm build their argv", () => {
  assertEquals(new DockerComposeStartSettings().services("web").argv(), [
    "docker",
    "compose",
    "start",
    "web",
  ]);
  assertEquals(new DockerComposeStartSettings().argv(), [
    "docker",
    "compose",
    "start",
  ]);
  assertEquals(
    new DockerComposeStopSettings().timeout(3).services("web").argv(),
    ["docker", "compose", "stop", "-t", "3", "web"],
  );
  assertEquals(new DockerComposeStopSettings().argv(), [
    "docker",
    "compose",
    "stop",
  ]);
  assertEquals(
    new DockerComposeRestartSettings().timeout(2).services("web").argv(),
    ["docker", "compose", "restart", "-t", "2", "web"],
  );
  assertEquals(new DockerComposeRestartSettings().argv(), [
    "docker",
    "compose",
    "restart",
  ]);
  assertEquals(
    new DockerComposeRmSettings().force().stop().volumes().services("web")
      .argv(),
    ["docker", "compose", "rm", "-f", "-s", "-v", "web"],
  );
  assertEquals(new DockerComposeRmSettings().argv(), [
    "docker",
    "compose",
    "rm",
  ]);
});

Deno.test("run/exec require a service", () => {
  assertThrows(
    () => new DockerComposeRunSettings().argv(),
    Error,
    "service() is required",
  );
  assertThrows(
    () => new DockerComposeExecSettings().argv(),
    Error,
    "service() is required",
  );
});

Deno.test("resolveComposeInvocation prefers the v2 plugin", async () => {
  resetComposeInvocationCache_();
  const seen: string[][] = [];
  const probe = (argv: readonly string[]) => {
    seen.push([...argv]);
    return Promise.resolve(true);
  };
  assertEquals(await resolveComposeInvocation(probe), ["docker", "compose"]);
  // Only the first candidate is probed when it succeeds.
  assertEquals(seen, [["docker", "compose"]]);
});

Deno.test("resolveComposeInvocation falls back to the v1 binary", async () => {
  resetComposeInvocationCache_();
  const probe = (argv: readonly string[]) =>
    Promise.resolve(argv[0] === "docker-compose");
  assertEquals(await resolveComposeInvocation(probe), ["docker-compose"]);
});

Deno.test("resolveComposeInvocation throws when neither is present", async () => {
  resetComposeInvocationCache_();
  await assertRejects(
    () => resolveComposeInvocation(() => Promise.resolve(false)),
    ToolNotFoundError,
  );
  // A failed detection is not cached: a later probe is consulted afresh.
  assertEquals(
    await resolveComposeInvocation(() => Promise.resolve(true)),
    ["docker", "compose"],
  );
});

Deno.test("resolveComposeInvocation caches the first success", async () => {
  resetComposeInvocationCache_();
  let calls = 0;
  const probe = () => {
    calls++;
    return Promise.resolve(true);
  };
  await resolveComposeInvocation(probe);
  await resolveComposeInvocation(probe);
  assertEquals(calls, 1);
});

Deno.test("defaultComposeProbe reports presence by exit code", async () => {
  // The running `deno` is always present. The probe appends "version" to the
  // argv, so `deno eval "0" version` evaluates `0` (exit zero) and ignores the
  // trailing positional — a hermetic stand-in for a working `... version`.
  assertEquals(
    await defaultComposeProbe([Deno.execPath(), "eval", "0"]),
    true,
  );
  // A bogus binary is reported missing rather than throwing.
  assertEquals(await defaultComposeProbe(["zz-no-such-binary-zz"]), false);
});

Deno.test("every DockerComposeTasks function reaches execution", async () => {
  // Seed the cache so the detection path resolves without touching the host.
  resetComposeInvocationCache_();
  await resolveComposeInvocation((argv) =>
    Promise.resolve(argv[0] === "docker-compose")
  );
  const calls: Array<() => Promise<unknown>> = [
    () => DockerComposeTasks.up(missingTool),
    () => DockerComposeTasks.down(missingTool),
    () => DockerComposeTasks.build(missingTool),
    () => DockerComposeTasks.pull(missingTool),
    () => DockerComposeTasks.push(missingTool),
    () => DockerComposeTasks.run((s) => missingTool(s).service("web")),
    () => DockerComposeTasks.exec((s) => missingTool(s).service("web")),
    () => DockerComposeTasks.logs(missingTool),
    () => DockerComposeTasks.ps(missingTool),
    () => DockerComposeTasks.config(missingTool),
    () => DockerComposeTasks.start(missingTool),
    () => DockerComposeTasks.stop(missingTool),
    () => DockerComposeTasks.restart(missingTool),
    () => DockerComposeTasks.rm(missingTool),
  ];
  for (const call of calls) {
    await assertRejects(call, ToolNotFoundError);
  }
  resetComposeInvocationCache_();
});

Deno.test("a pinned invocation skips detection", async () => {
  // No cache seeded: usePlugin/useStandalone must not consult the resolver.
  resetComposeInvocationCache_();
  await assertRejects(
    () => DockerComposeTasks.up((s) => missingTool(s).usePlugin()),
    ToolNotFoundError,
  );
  await assertRejects(
    () => DockerComposeTasks.down((s) => missingTool(s).useStandalone()),
    ToolNotFoundError,
  );
});

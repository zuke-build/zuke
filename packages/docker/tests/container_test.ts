// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import {
  DockerCreateSettings,
  DockerExecSettings,
  DockerKillSettings,
  DockerPauseSettings,
  DockerRenameSettings,
  DockerRestartSettings,
  DockerRunSettings,
  DockerStopSettings,
  DockerUnpauseSettings,
  DockerUpdateSettings,
  DockerWaitSettings,
} from "../mod.ts";

Deno.test("the global options precede the subcommand, where docker needs them", () => {
  // `docker ps --context x` is an error; `docker --context x ps` is not, so
  // the base renders them in front rather than appending like other CLIs.
  assertEquals(
    new DockerWaitSettings().dockerContext("remote").host("ssh://build@host")
      .logLevel("warn").config(".docker").debug().containers("app")
      .argv().slice(1),
    [
      "--config",
      ".docker",
      "--context",
      "remote",
      "--host",
      "ssh://build@host",
      "--log-level",
      "warn",
      "--debug",
      "wait",
      "app",
    ],
  );
});

Deno.test("run and create share one container configuration", () => {
  // `docker run` is `create` plus starting it, so the flags render the same
  // way for both — one implementation, not two that drift.
  const configure = <T extends DockerRunSettings | DockerCreateSettings>(
    settings: T,
  ): T =>
    settings.rm().detach().name("app").network("test-net")
      .entrypoint("/bin/sh").platform("linux/amd64").pull("always")
      .restart("unless-stopped").label("role", "test")
      .envVar("CI", "1").workdir("/src").user("1000:1000")
      .publish(8080, 80).volume("./out", "/out")
      .image("app:latest").commandArgs("-c", "echo hi") as T;

  const expected = [
    "--rm",
    "-d",
    "--name",
    "app",
    "--network",
    "test-net",
    "--entrypoint",
    "/bin/sh",
    "--platform",
    "linux/amd64",
    "--pull=always",
    "--restart",
    "unless-stopped",
    "--label",
    "role=test",
    "-e",
    "CI=1",
    "-w",
    "/src",
    "-u",
    "1000:1000",
    "-p",
    "8080:80",
    "-v",
    "./out:/out",
    "app:latest",
    "-c",
    "echo hi",
  ];
  assertEquals(configure(new DockerRunSettings()).argv().slice(1), [
    "run",
    ...expected,
  ]);
  assertEquals(configure(new DockerCreateSettings()).argv().slice(1), [
    "create",
    ...expected,
  ]);
});

Deno.test("run and create both require an image, naming their own task", () => {
  assertThrows(
    () => new DockerRunSettings().argv(),
    Error,
    "DockerTasks.run: .image() is required",
  );
  assertThrows(
    () => new DockerCreateSettings().argv(),
    Error,
    "DockerTasks.create: .image() is required",
  );
});

Deno.test("exec renders the process flags it shares with run", () => {
  assertEquals(
    new DockerExecSettings().detach().interactive().tty().privileged()
      .envVar("CI", "1").envFile(".env").workdir("/src").user("root")
      .container("app").commandArgs("sh", "-c", "ls").argv().slice(1),
    [
      "exec",
      "-d",
      "-i",
      "-t",
      "--privileged",
      "-e",
      "CI=1",
      "--env-file",
      ".env",
      "-w",
      "/src",
      "-u",
      "root",
      "app",
      "sh",
      "-c",
      "ls",
    ],
  );
});

Deno.test("the lifecycle commands share one container list and its refusal", () => {
  assertEquals(
    new DockerRestartSettings().signal("SIGTERM").timeout(5)
      .containers("app", "db").argv().slice(1),
    ["restart", "--signal", "SIGTERM", "-t", "5", "app", "db"],
  );
  assertEquals(
    new DockerKillSettings().signal("SIGHUP").containers("app").argv().slice(1),
    ["kill", "--signal", "SIGHUP", "app"],
  );
  assertEquals(new DockerPauseSettings().containers("app").argv().slice(1), [
    "pause",
    "app",
  ]);
  assertEquals(new DockerUnpauseSettings().containers("app").argv().slice(1), [
    "unpause",
    "app",
  ]);
  assertEquals(new DockerWaitSettings().containers("app").argv().slice(1), [
    "wait",
    "app",
  ]);
  // Every one of them reports the same thing rather than letting docker print
  // its usage — including the three that predate the shared base.
  for (
    const [task, build] of [
      ["restart", () => new DockerRestartSettings().argv()],
      ["kill", () => new DockerKillSettings().argv()],
      ["pause", () => new DockerPauseSettings().argv()],
      ["unpause", () => new DockerUnpauseSettings().argv()],
      ["wait", () => new DockerWaitSettings().argv()],
      ["stop", () => new DockerStopSettings().argv()],
      ["update", () => new DockerUpdateSettings().argv()],
    ] as const
  ) {
    assertThrows(
      build,
      Error,
      `DockerTasks.${task}: at least one container is required.`,
    );
  }
});

Deno.test("rename needs both names, and update renders its limits", () => {
  assertEquals(
    new DockerRenameSettings().container("old").newName("new").argv().slice(1),
    ["rename", "old", "new"],
  );
  assertThrows(
    () => new DockerRenameSettings().container("old").argv(),
    Error,
    "DockerTasks.rename: .container(...) and .newName(...) are both required",
  );
  assertEquals(
    new DockerUpdateSettings().memory("512m").cpus("1.5")
      .restart("no").containers("app").argv().slice(1),
    ["update", "--memory", "512m", "--cpus", "1.5", "--restart", "no", "app"],
  );
});

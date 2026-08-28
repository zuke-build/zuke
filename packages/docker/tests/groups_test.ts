// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import {
  DockerContextSettings,
  DockerHistorySettings,
  DockerImagePruneSettings,
  DockerImagesSettings,
  DockerImportSettings,
  DockerInfoSettings,
  DockerLogoutSettings,
  DockerNetworkSettings,
  DockerSearchSettings,
  DockerSystemSettings,
  DockerTasks,
  DockerVersionSettings,
  DockerVolumeSettings,
} from "../mod.ts";

Deno.test("the image commands render their new options", () => {
  assertEquals(
    new DockerImagesSettings().digests().format("{{json .}}").argv().slice(1),
    ["images", "--digests", "--format", "{{json .}}"],
  );
  assertEquals(
    new DockerHistorySettings().noTrunc().quietOutput().format("{{.ID}}")
      .image("app:latest").argv().slice(1),
    ["history", "--no-trunc", "--quiet", "--format", "{{.ID}}", "app:latest"],
  );
  assertThrows(
    () => new DockerHistorySettings().argv(),
    Error,
    "DockerTasks.history: .image() is required",
  );
  assertEquals(
    new DockerImportSettings().message("imported").change("CMD /app")
      .platform("linux/arm64").source("rootfs.tar").reference("app:imported")
      .argv().slice(1),
    [
      "import",
      "--message",
      "imported",
      "--change",
      "CMD /app",
      "--platform",
      "linux/arm64",
      "rootfs.tar",
      "app:imported",
    ],
  );
  assertThrows(
    () => new DockerImportSettings().argv(),
    Error,
    "DockerTasks.import: .source() is required",
  );
  assertEquals(
    new DockerImagePruneSettings().all().force().filter("until=24h")
      .argv().slice(1),
    ["image", "prune", "--all", "--force", "--filter", "until=24h"],
  );
});

Deno.test("logout and search render their arguments", () => {
  assertEquals(new DockerLogoutSettings().argv().slice(1), ["logout"]);
  assertEquals(
    new DockerLogoutSettings().registry("ghcr.io").argv().slice(1),
    ["logout", "ghcr.io"],
  );
  assertEquals(
    new DockerSearchSettings().limit(5).filter("is-official=true").noTrunc()
      .format("{{.Name}}").term("alpine").argv().slice(1),
    [
      "search",
      "--limit",
      "5",
      "--filter",
      "is-official=true",
      "--no-trunc",
      "--format",
      "{{.Name}}",
      "alpine",
    ],
  );
  assertThrows(
    () => new DockerSearchSettings().argv(),
    Error,
    "DockerTasks.search: .term() is required",
  );
});

Deno.test("system picks a subcommand and keeps prune options to prune", () => {
  assertEquals(
    new DockerSystemSettings().prune().all().volumes().force()
      .filter("until=24h").argv().slice(1),
    [
      "system",
      "prune",
      "--all",
      "--volumes",
      "--force",
      "--filter",
      "until=24h",
    ],
  );
  assertEquals(
    new DockerSystemSettings().df().verbose().argv().slice(1),
    ["system", "df", "--verbose"],
  );
  assertEquals(new DockerSystemSettings().info().argv().slice(1), [
    "system",
    "info",
  ]);
  assertThrows(
    () => new DockerSystemSettings().argv(),
    Error,
    "DockerTasks.system: no subcommand",
  );
  // Dropping `--all` silently would run a much smaller prune than asked for.
  assertThrows(
    () => new DockerSystemSettings().df().all().argv(),
    Error,
    "DockerTasks.system: .all()/.volumes()/.force() describe a prune",
  );
});

Deno.test("info and version render their format", () => {
  assertEquals(
    new DockerInfoSettings().format("{{json .}}").argv().slice(1),
    ["info", "--format", "{{json .}}"],
  );
  assertEquals(
    new DockerVersionSettings().format("{{.Server.Version}}").argv().slice(1),
    ["version", "--format", "{{.Server.Version}}"],
  );
});

Deno.test("volume renders each subcommand", () => {
  assertEquals(new DockerVolumeSettings().argv().slice(1), ["volume", "ls"]);
  assertEquals(
    new DockerVolumeSettings().create("cache").driver("local")
      .label("role", "build").opt("type", "tmpfs").argv().slice(1),
    [
      "volume",
      "create",
      "--driver",
      "local",
      "--label",
      "role=build",
      "--opt",
      "type=tmpfs",
      "cache",
    ],
  );
  assertEquals(new DockerVolumeSettings().create().argv().slice(1), [
    "volume",
    "create",
  ]);
  assertEquals(
    new DockerVolumeSettings().ls().quietOutput().filter("dangling=true")
      .argv().slice(1),
    ["volume", "ls", "--filter", "dangling=true", "--quiet"],
  );
  assertEquals(
    new DockerVolumeSettings().remove("cache").force().argv().slice(1),
    ["volume", "rm", "--force", "cache"],
  );
  assertEquals(
    new DockerVolumeSettings().inspect("cache").format("{{.Mountpoint}}")
      .argv().slice(1),
    ["volume", "inspect", "--format", "{{.Mountpoint}}", "cache"],
  );
  assertEquals(
    new DockerVolumeSettings().prune().all().force().argv().slice(1),
    ["volume", "prune", "--all", "--force"],
  );
  assertThrows(
    () => new DockerVolumeSettings().remove().argv(),
    Error,
    "DockerTasks.volume: .remove(...) needs at least one volume name",
  );
  assertThrows(
    () => new DockerVolumeSettings().inspect().argv(),
    Error,
    "DockerTasks.volume: .inspect(...) needs at least one volume name",
  );
});

Deno.test("network renders each subcommand, and keeps --alias to connect", () => {
  assertEquals(new DockerNetworkSettings().argv().slice(1), ["network", "ls"]);
  assertEquals(
    new DockerNetworkSettings().create("test-net").driver("bridge")
      .subnet("10.5.0.0/16").gateway("10.5.0.1").label("ci", "1")
      .argv().slice(1),
    [
      "network",
      "create",
      "--driver",
      "bridge",
      "--subnet",
      "10.5.0.0/16",
      "--gateway",
      "10.5.0.1",
      "--label",
      "ci=1",
      "test-net",
    ],
  );
  assertEquals(
    new DockerNetworkSettings().connect("test-net", "db").alias("database")
      .argv().slice(1),
    ["network", "connect", "--alias", "database", "test-net", "db"],
  );
  assertEquals(
    new DockerNetworkSettings().disconnect("test-net", "db").force()
      .argv().slice(1),
    ["network", "disconnect", "--force", "test-net", "db"],
  );
  assertEquals(
    new DockerNetworkSettings().remove("test-net").argv().slice(1),
    ["network", "rm", "test-net"],
  );
  assertEquals(
    new DockerNetworkSettings().inspect("test-net").argv().slice(1),
    ["network", "inspect", "test-net"],
  );
  assertEquals(
    new DockerNetworkSettings().prune().force().argv().slice(1),
    ["network", "prune", "--force"],
  );
  assertThrows(
    () => new DockerNetworkSettings().remove().argv(),
    Error,
    "DockerTasks.network: .remove(...) needs at least one network name",
  );
  assertThrows(
    () => new DockerNetworkSettings().create("n").alias("db").argv(),
    Error,
    "DockerTasks.network: .alias(...) names a container on a network",
  );
});

Deno.test("context renders each subcommand", () => {
  assertEquals(new DockerContextSettings().argv().slice(1), ["context", "ls"]);
  assertEquals(
    new DockerContextSettings().create("remote")
      .dockerHost("ssh://build@host").description("CI builder")
      .argv().slice(1),
    [
      "context",
      "create",
      "--docker",
      "host=ssh://build@host",
      "--description",
      "CI builder",
      "remote",
    ],
  );
  assertEquals(new DockerContextSettings().use("remote").argv().slice(1), [
    "context",
    "use",
    "remote",
  ]);
  assertEquals(new DockerContextSettings().show().argv().slice(1), [
    "context",
    "show",
  ]);
  assertEquals(
    new DockerContextSettings().inspect("remote").format("{{json .}}")
      .argv().slice(1),
    ["context", "inspect", "--format", "{{json .}}", "remote"],
  );
  assertEquals(
    new DockerContextSettings().remove("remote").force().argv().slice(1),
    ["context", "rm", "--force", "remote"],
  );
  assertEquals(
    new DockerContextSettings().create("copy").from("remote").argv().slice(1),
    ["context", "create", "--from", "remote", "copy"],
  );
  assertEquals(
    new DockerContextSettings().ls().quietOutput().argv().slice(1),
    ["context", "ls", "--quiet"],
  );
  assertThrows(
    () => new DockerContextSettings().remove().argv(),
    Error,
    "DockerTasks.context: .remove(...) needs at least one context name",
  );
});

/** Every new task, with the minimum its settings demand. */
const TASKS: Array<[string, () => Promise<unknown>]> = [
  ["create", () => DockerTasks.create((s) => missingTool(s).image("app"))],
  ["restart", () => DockerTasks.restart((s) => missingTool(s).containers("a"))],
  ["kill", () => DockerTasks.kill((s) => missingTool(s).containers("a"))],
  ["pause", () => DockerTasks.pause((s) => missingTool(s).containers("a"))],
  ["unpause", () => DockerTasks.unpause((s) => missingTool(s).containers("a"))],
  ["wait", () => DockerTasks.wait((s) => missingTool(s).containers("a"))],
  [
    "rename",
    () => DockerTasks.rename((s) => missingTool(s).container("a").newName("b")),
  ],
  ["update", () => DockerTasks.update((s) => missingTool(s).containers("a"))],
  ["logs", () => DockerTasks.logs((s) => missingTool(s).container("a"))],
  ["inspect", () => DockerTasks.inspect((s) => missingTool(s).targets("a"))],
  ["top", () => DockerTasks.top((s) => missingTool(s).container("a"))],
  ["stats", () => DockerTasks.stats((s) => missingTool(s))],
  ["port", () => DockerTasks.port((s) => missingTool(s).container("a"))],
  ["diff", () => DockerTasks.diff((s) => missingTool(s).container("a"))],
  ["cp", () => DockerTasks.cp((s) => missingTool(s).from("a:/x").to("y"))],
  ["commit", () => DockerTasks.commit((s) => missingTool(s).container("a"))],
  ["export", () => DockerTasks.export((s) => missingTool(s).container("a"))],
  ["history", () => DockerTasks.history((s) => missingTool(s).image("a"))],
  ["import", () => DockerTasks.import((s) => missingTool(s).source("a.tar"))],
  ["imagePrune", () => DockerTasks.imagePrune((s) => missingTool(s))],
  ["logout", () => DockerTasks.logout((s) => missingTool(s))],
  ["search", () => DockerTasks.search((s) => missingTool(s).term("alpine"))],
  ["info", () => DockerTasks.info((s) => missingTool(s))],
  ["version", () => DockerTasks.version((s) => missingTool(s))],
  ["system", () => DockerTasks.system((s) => missingTool(s).prune().force())],
  ["volume", () => DockerTasks.volume((s) => missingTool(s))],
  ["network", () => DockerTasks.network((s) => missingTool(s))],
  ["context", () => DockerTasks.context((s) => missingTool(s))],
];

for (const [name, invoke] of TASKS) {
  Deno.test(`DockerTasks.${name} reaches execution`, async () => {
    await assertRejects(invoke, ToolNotFoundError);
  });
}

Deno.test("the new settings classes conform to the wrapper contract", async () => {
  for (
    const make of [
      () => new DockerVolumeSettings(),
      () => new DockerNetworkSettings(),
      () => new DockerSystemSettings().prune(),
      () => new DockerContextSettings(),
    ]
  ) {
    await assertWrapperConformance(make, "docker", { resolution: "path" });
  }
});

Deno.test("the listing groups render their remaining options", () => {
  assertEquals(
    new DockerNetworkSettings().ls().quietOutput().filter("driver=bridge")
      .format("{{.Name}}").argv().slice(1),
    [
      "network",
      "ls",
      "--filter",
      "driver=bridge",
      "--quiet",
      "--format",
      "{{.Name}}",
    ],
  );
  assertEquals(
    new DockerNetworkSettings().prune().filter("until=1h").argv().slice(1),
    ["network", "prune", "--filter", "until=1h"],
  );
  assertEquals(
    new DockerVolumeSettings().ls().format("{{.Name}}").argv().slice(1),
    ["volume", "ls", "--format", "{{.Name}}"],
  );
  assertEquals(
    new DockerVolumeSettings().prune().filter("label!=keep").argv().slice(1),
    ["volume", "prune", "--filter", "label!=keep"],
  );
  assertEquals(
    new DockerContextSettings().inspect().argv().slice(1),
    ["context", "inspect"],
  );
});

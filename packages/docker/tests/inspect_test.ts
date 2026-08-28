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
  DockerCommitSettings,
  DockerCpSettings,
  DockerDiffSettings,
  DockerExportSettings,
  DockerInspectSettings,
  DockerLogsSettings,
  DockerPortSettings,
  DockerPsSettings,
  DockerStatsSettings,
  DockerTasks,
  DockerTopSettings,
} from "../mod.ts";
import { parseContainerEntries } from "../src/container_info.ts";
import { parseImageEntries } from "../src/image.ts";
import { parseJsonLines, parseLines } from "../src/json_lines.ts";

Deno.test("ps renders its selectors and format", () => {
  assertEquals(
    new DockerPsSettings().all().quietOutput().latest().noTrunc().size()
      .filter("status=running").format("{{json .}}").argv().slice(1),
    [
      "ps",
      "-a",
      "-q",
      "--latest",
      "--no-trunc",
      "--size",
      "--filter",
      "status=running",
      "--format",
      "{{json .}}",
    ],
  );
});

Deno.test("logs renders its window, and requires a container", () => {
  assertEquals(
    new DockerLogsSettings().follow().timestamps().details().tail(100)
      .since("10m").until("1m").container("app").argv().slice(1),
    [
      "logs",
      "--follow",
      "--timestamps",
      "--details",
      "--tail",
      "100",
      "--since",
      "10m",
      "--until",
      "1m",
      "app",
    ],
  );
  assertEquals(
    new DockerLogsSettings().tail("all").container("app").argv().slice(1),
    ["logs", "--tail", "all", "app"],
  );
  assertThrows(
    () => new DockerLogsSettings().argv(),
    Error,
    "DockerTasks.logs: .container() is required",
  );
});

Deno.test("inspect, top, port, and diff render their targets", () => {
  assertEquals(
    new DockerInspectSettings().type("container").size()
      .format("{{.State.Status}}").targets("app", "db").argv().slice(1),
    [
      "inspect",
      "--type",
      "container",
      "--size",
      "--format",
      "{{.State.Status}}",
      "app",
      "db",
    ],
  );
  assertThrows(
    () => new DockerInspectSettings().argv(),
    Error,
    "DockerTasks.inspect: .targets(...) is required",
  );
  assertEquals(
    new DockerTopSettings().container("app").psArgs("-eo", "pid,cmd")
      .argv().slice(1),
    ["top", "app", "-eo", "pid,cmd"],
  );
  assertEquals(
    new DockerPortSettings().container("app").port("8080/tcp").argv().slice(1),
    ["port", "app", "8080/tcp"],
  );
  assertEquals(new DockerPortSettings().container("app").argv().slice(1), [
    "port",
    "app",
  ]);
  assertEquals(new DockerDiffSettings().container("app").argv().slice(1), [
    "diff",
    "app",
  ]);
});

Deno.test("stats never streams, because a target that never returns is a hang", () => {
  assertEquals(
    new DockerStatsSettings().all().format("{{json .}}").containers("app")
      .argv().slice(1),
    ["stats", "--no-stream", "--all", "--format", "{{json .}}", "app"],
  );
});

Deno.test("cp needs both ends, and export writes where it is told", () => {
  assertEquals(
    new DockerCpSettings().archive().followLink()
      .from("app:/out/report.xml").to("reports/").argv().slice(1),
    ["cp", "--archive", "--follow-link", "app:/out/report.xml", "reports/"],
  );
  assertThrows(
    () => new DockerCpSettings().from("app:/out").argv(),
    Error,
    "DockerTasks.cp: .from(...) and .to(...) are both required",
  );
  assertEquals(
    new DockerExportSettings().output("app.tar").container("app")
      .argv().slice(1),
    ["export", "--output", "app.tar", "app"],
  );
});

Deno.test("commit renders its metadata and pause override", () => {
  assertEquals(
    new DockerCommitSettings().message("snapshot").author("CI")
      .change("CMD /app").noPause().container("app").reference("app:snap")
      .argv().slice(1),
    [
      "commit",
      "--message",
      "snapshot",
      "--author",
      "CI",
      "--change",
      "CMD /app",
      "--pause=false",
      "app",
      "app:snap",
    ],
  );
  assertThrows(
    () => new DockerCommitSettings().argv(),
    Error,
    "DockerTasks.commit: .container() is required",
  );
});

Deno.test("parseJsonLines reads docker's one-object-per-line format", () => {
  const stdout = '{"ID":"abc","Names":"app"}\n{"ID":"def","Names":"db"}\n';
  assertEquals(parseJsonLines(stdout).length, 2);
  // docker interleaves warnings into the same stream; one must not lose the
  // whole listing.
  const noisy = "DEPRECATED: the legacy builder is deprecated\n" +
    '{"ID":"abc"}\n' +
    "\n";
  assertEquals(parseJsonLines(noisy).length, 1);
  assertEquals(parseJsonLines(""), []);
  // A truncated line, and a JSON array rather than an object.
  assertEquals(parseJsonLines('{"ID":"ab'), []);
  assertEquals(parseJsonLines("[1,2]"), []);
});

Deno.test("parseContainerEntries maps docker's capitalised keys", () => {
  const stdout = JSON.stringify({
    ID: "abc123",
    Image: "app:latest",
    Names: "app",
    Command: '"/bin/sh"',
    Status: "Up 3 minutes",
    State: "running",
    Ports: "0.0.0.0:8080->80/tcp",
  }) + "\n";
  assertEquals(parseContainerEntries(stdout), [{
    id: "abc123",
    image: "app:latest",
    names: "app",
    command: '"/bin/sh"',
    status: "Up 3 minutes",
    state: "running",
    ports: "0.0.0.0:8080->80/tcp",
  }]);
  // An older docker omits `State`; the entry still stands without it.
  assertEquals(
    parseContainerEntries(JSON.stringify({ ID: "abc", Names: "app" })),
    [{ id: "abc", names: "app" }],
  );
  // A field docker reports as a non-string is not that field.
  assertEquals(parseContainerEntries(JSON.stringify({ ID: 7 })), [{}]);
});

Deno.test("parseImageEntries maps the image listing's keys", () => {
  const stdout = JSON.stringify({
    ID: "sha256:abc",
    Repository: "app",
    Tag: "latest",
    CreatedSince: "2 days ago",
    Size: "12.3MB",
    Digest: "<none>",
  });
  assertEquals(parseImageEntries(stdout), [{
    id: "sha256:abc",
    repository: "app",
    tag: "latest",
    createdSince: "2 days ago",
    size: "12.3MB",
    digest: "<none>",
  }]);
  assertEquals(parseImageEntries(""), []);
});

Deno.test("parseLines drops the blanks a name-only listing leaves", () => {
  assertEquals(parseLines("build-cache\ntest-net\n"), [
    "build-cache",
    "test-net",
  ]);
  assertEquals(parseLines("\n\n"), []);
  assertEquals(parseLines(""), []);
});

Deno.test("the reading tasks fail on a missing docker rather than reporting nothing", async () => {
  await assertRejects(
    () => DockerTasks.psEntries((s) => missingTool(s)),
    ToolNotFoundError,
  );
  await assertRejects(
    () => DockerTasks.imageEntries((s) => missingTool(s)),
    ToolNotFoundError,
  );
  await assertRejects(
    () => DockerTasks.volumeNames((s) => missingTool(s)),
    ToolNotFoundError,
  );
  await assertRejects(
    () => DockerTasks.networkNames((s) => missingTool(s)),
    ToolNotFoundError,
  );
});

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Argv tests for the Compose subcommands added on top of the original
 * fourteen. Every expected argv here was run through `docker compose
 * --dry-run` (v5.1.1) before being written down, so these are argvs the real
 * CLI accepts rather than only argvs this wrapper happens to produce.
 */

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import {
  DockerComposeCommitSettings,
  DockerComposeCpSettings,
  DockerComposeCreateSettings,
  DockerComposeEventsSettings,
  DockerComposeExportSettings,
  DockerComposeImagesSettings,
  DockerComposeKillSettings,
  DockerComposeLsSettings,
  DockerComposePauseSettings,
  DockerComposePortSettings,
  DockerComposeScaleSettings,
  DockerComposeTopSettings,
  DockerComposeUnpauseSettings,
  DockerComposeVersionSettings,
  DockerComposeVolumesSettings,
  DockerComposeWaitSettings,
} from "../mod.ts";

/** Drop the `docker` binary and the `compose` word the base always prepends. */
function args(settings: { argv(): string[] }): string[] {
  return settings.argv().slice(2);
}

Deno.test("create: every flag, with the services trailing", () => {
  const settings = new DockerComposeCreateSettings()
    .usePlugin()
    .build()
    .forceRecreate()
    .removeOrphans()
    .quietPull()
    .pull("always")
    .scale("db", 2)
    .yes()
    .services("db");
  assertEquals(args(settings), [
    "create",
    "--build",
    "--force-recreate",
    "--remove-orphans",
    "--quiet-pull",
    "--pull",
    "always",
    "--scale",
    "db=2",
    "--yes",
    "db",
  ]);
});

Deno.test("create: the two recreate answers, and the two build answers", () => {
  assertEquals(
    args(new DockerComposeCreateSettings().usePlugin().noBuild().noRecreate()),
    ["create", "--no-build", "--no-recreate"],
  );
  const build = assertThrows(
    () =>
      new DockerComposeCreateSettings().usePlugin().build().noBuild().argv(),
    Error,
  );
  assertEquals(build.message.includes("pick one"), true);
  const recreate = assertThrows(
    () =>
      new DockerComposeCreateSettings()
        .usePlugin()
        .forceRecreate()
        .noRecreate()
        .argv(),
    Error,
  );
  assertEquals(recreate.message.includes("pick one"), true);
});

Deno.test("kill: signal and orphan removal precede the services", () => {
  assertEquals(
    args(
      new DockerComposeKillSettings()
        .usePlugin()
        .signal("SIGTERM")
        .removeOrphans()
        .services("db", "cache"),
    ),
    ["kill", "--signal", "SIGTERM", "--remove-orphans", "db", "cache"],
  );
  assertEquals(args(new DockerComposeKillSettings().usePlugin()), ["kill"]);
});

Deno.test("pause and unpause differ only in the verb", () => {
  assertEquals(
    args(new DockerComposePauseSettings().usePlugin().services("db")),
    ["pause", "db"],
  );
  assertEquals(
    args(new DockerComposeUnpauseSettings().usePlugin().services("db")),
    ["unpause", "db"],
  );
  assertEquals(args(new DockerComposePauseSettings().usePlugin()), ["pause"]);
});

Deno.test("scale: each service is one operand, and one is required", () => {
  assertEquals(
    args(
      new DockerComposeScaleSettings()
        .usePlugin()
        .noDeps()
        .scale("worker", 3)
        .scale("db", 1),
    ),
    ["scale", "--no-deps", "worker=3", "db=1"],
  );
  const error = assertThrows(
    () => new DockerComposeScaleSettings().usePlugin().argv(),
    Error,
  );
  assertEquals(error.message.includes(".scale(service, replicas)"), true);
});

Deno.test("wait: services are required, since compose waits on named ones", () => {
  assertEquals(
    args(
      new DockerComposeWaitSettings().usePlugin().downProject().services(
        "tests",
      ),
    ),
    ["wait", "--down-project", "tests"],
  );
  const error = assertThrows(
    () => new DockerComposeWaitSettings().usePlugin().argv(),
    Error,
  );
  assertEquals(error.message.includes(".services()"), true);
});

Deno.test("cp: one end names a service, the other is local", () => {
  assertEquals(
    args(
      new DockerComposeCpSettings()
        .usePlugin()
        .all()
        .archive()
        .followLink()
        .index(1)
        .fromService("tests", "/reports")
        .toLocal("./reports"),
    ),
    [
      "cp",
      "--all",
      "--archive",
      "--follow-link",
      "--index",
      "1",
      "tests:/reports",
      "./reports",
    ],
  );
  assertEquals(
    args(
      new DockerComposeCpSettings()
        .usePlugin()
        .fromLocal("./seed.sql")
        .toService("db", "/seed.sql"),
    ),
    ["cp", "./seed.sql", "db:/seed.sql"],
  );
});

Deno.test("cp: two services, two local paths, or one end missing are refused", () => {
  const services = assertThrows(
    () =>
      new DockerComposeCpSettings()
        .usePlugin()
        .fromService("a", "/x")
        .toService("b", "/y")
        .argv(),
    Error,
  );
  assertEquals(services.message.includes("two services"), true);

  const locals = assertThrows(
    () =>
      new DockerComposeCpSettings().usePlugin().fromLocal("./x").toLocal("./y")
        .argv(),
    Error,
  );
  assertEquals(locals.message.includes("two local paths"), true);

  const missing = assertThrows(
    () => new DockerComposeCpSettings().usePlugin().fromLocal("./x").argv(),
    Error,
  );
  assertEquals(missing.message.includes("both ends are required"), true);
});

Deno.test("top: bare and service-scoped", () => {
  assertEquals(args(new DockerComposeTopSettings().usePlugin()), ["top"]);
  assertEquals(
    args(new DockerComposeTopSettings().usePlugin().services("db")),
    ["top", "db"],
  );
});

Deno.test("export: the service is required and trails the flags", () => {
  assertEquals(
    args(
      new DockerComposeExportSettings()
        .usePlugin()
        .output("out.tar")
        .index(1)
        .service("db"),
    ),
    ["export", "--output", "out.tar", "--index", "1", "db"],
  );
  const error = assertThrows(
    () => new DockerComposeExportSettings().usePlugin().argv(),
    Error,
  );
  assertEquals(error.message.includes(".service() is required"), true);
});

Deno.test("commit: the reference follows the service, and pause is opt-out", () => {
  assertEquals(
    args(
      new DockerComposeCommitSettings()
        .usePlugin()
        .author("A")
        .message("m")
        .change("ENV X=1", "LABEL y=2")
        .index(1)
        .noPause()
        .service("db")
        .reference("snapshot:test"),
    ),
    [
      "commit",
      "--author",
      "A",
      "--message",
      "m",
      "--change",
      "ENV X=1",
      "--change",
      "LABEL y=2",
      "--index",
      "1",
      "--pause=false",
      "db",
      "snapshot:test",
    ],
  );
  assertEquals(
    args(new DockerComposeCommitSettings().usePlugin().service("db")),
    ["commit", "db"],
  );
  const error = assertThrows(
    () => new DockerComposeCommitSettings().usePlugin().argv(),
    Error,
  );
  assertEquals(error.message.includes(".service() is required"), true);
});

Deno.test("the listing commands share one rendering of format and quiet", () => {
  assertEquals(
    args(
      new DockerComposeImagesSettings().usePlugin().json().quietOutput()
        .services("db"),
    ),
    ["images", "--format", "json", "--quiet", "db"],
  );
  assertEquals(
    args(new DockerComposeVolumesSettings().usePlugin().format("table")),
    ["volumes", "--format", "table"],
  );
  assertEquals(
    args(
      new DockerComposeLsSettings()
        .usePlugin()
        .all()
        .filter("name=x")
        .json()
        .quietOutput(),
    ),
    ["ls", "--all", "--filter", "name=x", "--format", "json", "--quiet"],
  );
});

Deno.test("version: json and short are separate answers", () => {
  assertEquals(args(new DockerComposeVersionSettings().usePlugin()), [
    "version",
  ]);
  assertEquals(args(new DockerComposeVersionSettings().usePlugin().json()), [
    "version",
    "--format",
    "json",
  ]);
  assertEquals(args(new DockerComposeVersionSettings().usePlugin().short()), [
    "version",
    "--short",
  ]);
});

Deno.test("port: both operands are required", () => {
  assertEquals(
    args(
      new DockerComposePortSettings()
        .usePlugin()
        .protocol("udp")
        .index(2)
        .service("db")
        .privatePort(5432),
    ),
    ["port", "--protocol", "udp", "--index", "2", "db", "5432"],
  );
  const noPort = assertThrows(
    () => new DockerComposePortSettings().usePlugin().service("db").argv(),
    Error,
  );
  assertEquals(noPort.message.includes(".privatePort()"), true);
  const noService = assertThrows(
    () => new DockerComposePortSettings().usePlugin().privatePort(80).argv(),
    Error,
  );
  assertEquals(noService.message.includes(".service()"), true);
});

Deno.test("events: the window flags precede the services", () => {
  assertEquals(
    args(
      new DockerComposeEventsSettings()
        .usePlugin()
        .json()
        .since("2026-01-01")
        .until("2026-01-02")
        .services("db"),
    ),
    [
      "events",
      "--json",
      "--since",
      "2026-01-01",
      "--until",
      "2026-01-02",
      "db",
    ],
  );
});

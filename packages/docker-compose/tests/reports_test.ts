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
  DockerComposeTasks,
  resetComposeInvocationCache_,
  resolveComposeInvocation,
} from "../mod.ts";
// The readers are internal to the package: the public surface is the
// task-shaped `DockerComposeTasks.version`/`servicePort`/`waitExitCode`, so
// these are imported from their module rather than re-exported by `mod.ts`.
import {
  type ComposeRunOutcome,
  parseComposeVersion,
  parsePublishedPort,
  waitStatus,
} from "../src/reports.ts";

/**
 * Seed the invocation cache from a fake probe so detection never touches the
 * host. Without it these tests depend on whether the machine happens to have
 * Docker installed — which is not hermetic, and makes them pass on a runner
 * that has it and fail on one that does not.
 */
async function withDetectedCompose(body: () => Promise<void>): Promise<void> {
  resetComposeInvocationCache_();
  await resolveComposeInvocation((argv) =>
    Promise.resolve(argv[0] === "docker-compose")
  );
  try {
    await body();
  } finally {
    resetComposeInvocationCache_();
  }
}

/** One finished compose run, as the readers see it. */
function output(code: number, stdout = "", stderr = ""): ComposeRunOutcome {
  return { code, stdout, stderr };
}

Deno.test("waitStatus: every exit code a container stopped with is an answer", () => {
  assertEquals(waitStatus(output(0)), 0);
  assertEquals(waitStatus(output(1)), 1);
  assertEquals(waitStatus(output(137)), 137);
  // compose prints the status on stdout, which is the shape that says a
  // container really was waited on.
  assertEquals(waitStatus(output(2, "2\n")), 2);
});

Deno.test("parsePublishedPort: IPv4, IPv6, a hostname and a bare port", () => {
  assertEquals(parsePublishedPort("0.0.0.0:32768\n"), 32768);
  assertEquals(parsePublishedPort("[::]:32768\n"), 32768);
  assertEquals(parsePublishedPort("[::1]:5432"), 5432);
  assertEquals(parsePublishedPort("127.0.0.1:5432"), 5432);
  assertEquals(parsePublishedPort("localhost:8080"), 8080);
  assertEquals(parsePublishedPort(":5432"), 5432);
  assertEquals(parsePublishedPort("0.0.0.0:65535"), 65535);
});

Deno.test("parsePublishedPort: an unpublished port and a malformed line", () => {
  const empty = assertThrows(() => parsePublishedPort("  \n"), Error);
  assertEquals(empty.message.includes("printed no binding"), true);
  const malformed = assertThrows(
    () => parsePublishedPort("not-a-binding"),
    Error,
  );
  assertEquals(malformed.message.includes("not a host and port"), true);
});

Deno.test("parsePublishedPort: several bindings are refused, not guessed at", () => {
  // Taking the last line would hand a build a port it never asked about.
  const error = assertThrows(
    () => parsePublishedPort("0.0.0.0:32768\n0.0.0.0:32769\n"),
    Error,
  );
  assertEquals(error.message.includes("more than one"), true);
});

Deno.test("parsePublishedPort: a line that merely ends in digits is not a binding", () => {
  // Compose writes diagnostics too, and one ending in a number would have
  // parsed as a port when only the tail after the last colon was read.
  const error = assertThrows(
    () => parsePublishedPort("error: cannot connect:123"),
    Error,
  );
  assertEquals(error.message.includes("not a host and port"), true);
});

Deno.test("parsePublishedPort: a port outside 1-65535 is refused", () => {
  for (const line of [":0", "0.0.0.0:0", ":99999"]) {
    const error = assertThrows(() => parsePublishedPort(line), Error);
    assertEquals(
      error.message.includes("1-65535") ||
        error.message.includes("not a host and port"),
      true,
    );
  }
});

Deno.test("parseComposeVersion: the shape compose actually emits", () => {
  // Verified against `docker compose version --format json` on v5.1.1.
  assertEquals(parseComposeVersion('{"version":"v5.1.1"}'), {
    version: "v5.1.1",
  });
});

Deno.test("parseComposeVersion: non-JSON and a missing version field", () => {
  const notJson = assertThrows(
    () => parseComposeVersion("docker: not found"),
    Error,
  );
  assertEquals(notJson.message.includes("did not emit JSON"), true);
  for (const emitted of ["[]", "null", "42", '{"v":"1"}', '{"version":1}']) {
    const error = assertThrows(() => parseComposeVersion(emitted), Error);
    assertEquals(error.message.includes("string version field"), true);
  }
});

Deno.test("every new DockerComposeTasks function reaches execution", async () => {
  const reaches: Array<[string, () => Promise<unknown>]> = [
    ["create", () => DockerComposeTasks.create(missingTool)],
    ["kill", () => DockerComposeTasks.kill(missingTool)],
    ["pause", () => DockerComposeTasks.pause(missingTool)],
    ["unpause", () => DockerComposeTasks.unpause(missingTool)],
    [
      "scale",
      () => DockerComposeTasks.scale((s) => missingTool(s).scale("a", 1)),
    ],
    [
      "wait",
      () => DockerComposeTasks.wait((s) => missingTool(s).services("a")),
    ],
    [
      "cp",
      () =>
        DockerComposeTasks.cp((s) =>
          missingTool(s).fromService("a", "/x").toLocal("./y")
        ),
    ],
    ["top", () => DockerComposeTasks.top(missingTool)],
    [
      "export",
      () => DockerComposeTasks.export((s) => missingTool(s).service("a")),
    ],
    [
      "commit",
      () => DockerComposeTasks.commit((s) => missingTool(s).service("a")),
    ],
    ["images", () => DockerComposeTasks.images(missingTool)],
    ["volumes", () => DockerComposeTasks.volumes(missingTool)],
    ["ls", () => DockerComposeTasks.ls(missingTool)],
    ["version", () => DockerComposeTasks.version(missingTool)],
    [
      "port",
      () =>
        DockerComposeTasks.port((s) =>
          missingTool(s).service("a").privatePort(80)
        ),
    ],
    ["events", () => DockerComposeTasks.events(missingTool)],
    [
      "servicePort",
      () =>
        DockerComposeTasks.servicePort((s) =>
          missingTool(s).service("a").privatePort(80)
        ),
    ],
    ["composeVersion", () => DockerComposeTasks.composeVersion(missingTool)],
  ];
  await withDetectedCompose(async () => {
    for (const [name, reach] of reaches) {
      try {
        await assertRejects(reach, ToolNotFoundError);
      } catch (error) {
        throw new Error(
          `DockerComposeTasks.${name} did not reach tool resolution`,
          { cause: error },
        );
      }
    }
  });
});

Deno.test("waitExitCode fails loudly when compose is missing", async () => {
  // noThrow lets a container's non-zero status through, but a missing binary
  // is not a container status — the reader must still fail.
  await withDetectedCompose(async () => {
    await assertRejects(
      () =>
        DockerComposeTasks.waitExitCode((s) => missingTool(s).services("a")),
      ToolNotFoundError,
    );
  });
});

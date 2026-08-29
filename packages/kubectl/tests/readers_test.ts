// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { CommandOutput } from "@zuke/core/shell";
import { ToolNotFoundError } from "@zuke/core/tooling";
import { missingTool } from "@zuke/core/tooling/conformance";
import {
  KubectlTasks,
  parseEvents,
  parseResources,
  parseVersion,
} from "../mod.ts";
import { answerFromExitCode } from "../src/exit_code.ts";

Deno.test("an exit code that is one of the two answers is a value, not a failure", () => {
  // kubectl diff exits 1 for "there are differences" and auth can-i exits
  // non-zero for "not allowed". Neither is the command failing.
  assertEquals(answerFromExitCode("t", new CommandOutput(0, "", ""), 1), true);
  assertEquals(answerFromExitCode("t", new CommandOutput(1, "", ""), 1), false);
});

Deno.test("an exit code that is neither answer fails, carrying kubectl's own words", () => {
  // 2 and above mean kubectl or its differ broke; swallowing that would turn a
  // broken cluster connection into a confident "no differences".
  const failed = new CommandOutput(2, "", "error: unable to reach the server");
  assertThrows(
    () => answerFromExitCode("diffHasChanges", failed, 1),
    Error,
    "KubectlTasks.diffHasChanges: kubectl exited 2",
  );
  assertThrows(
    () => answerFromExitCode("diffHasChanges", failed, 1),
    Error,
    "unable to reach the server",
  );
  // stdout stands in when the failure said nothing on stderr.
  assertThrows(
    () => answerFromExitCode("canI", new CommandOutput(7, "broke", ""), 1),
    Error,
    "broke",
  );
  // A failure that said nothing at all still names the code.
  assertThrows(
    () => answerFromExitCode("canI", new CommandOutput(7, "", ""), 1),
    Error,
    "kubectl exited 7",
  );
});

Deno.test("canI refuses a listing, which always exits zero", async () => {
  // `auth can-i --list` prints every allowed action and succeeds whatever it
  // found, so reading its exit code as a boolean would always answer "yes".
  await assertRejects(
    () => KubectlTasks.canI((s) => missingTool(s).list()),
    Error,
    "KubectlTasks.canI: .list() prints every allowed action",
  );
});

Deno.test("parseResources reads the metadata every kind carries", () => {
  const json = JSON.stringify({
    items: [
      {
        kind: "Pod",
        metadata: {
          name: "api-0",
          namespace: "prod",
          labels: { app: "api", tier: 1 },
          creationTimestamp: "2026-08-29T10:00:00Z",
        },
      },
      { kind: "Node", metadata: { name: "worker-1" } },
    ],
  });
  assertEquals(parseResources(json), [
    {
      name: "api-0",
      kind: "Pod",
      namespace: "prod",
      // A non-string label value is dropped rather than coerced.
      labels: { app: "api" },
      createdAt: "2026-08-29T10:00:00Z",
    },
    { name: "worker-1", kind: "Node", labels: {} },
  ]);
  // A single object, not a List, parses the same way.
  assertEquals(parseResources('{"kind":"Pod","metadata":{"name":"a"}}'), [
    { name: "a", kind: "Pod", labels: {} },
  ]);
  // An item with no name is not a resource.
  assertEquals(parseResources('{"items":[{"kind":"Pod"}]}'), []);
  assertEquals(parseResources("  "), []);
});

Deno.test("parseEvents reads both spellings the server may use", () => {
  // The events API says `regarding` and `series.count`; the older core/v1
  // Event says `involvedObject` and `count`. A build reads the same shape.
  assertEquals(
    parseEvents(JSON.stringify({
      items: [{
        type: "Warning",
        reason: "FailedScheduling",
        note: "0/3 nodes are available",
        regarding: { kind: "Pod", name: "api-0" },
        series: { count: 4, lastObservedTime: "2026-08-29T10:00:00Z" },
      }],
    })),
    [{
      type: "Warning",
      reason: "FailedScheduling",
      message: "0/3 nodes are available",
      regarding: "Pod/api-0",
      count: 4,
      lastSeen: "2026-08-29T10:00:00Z",
    }],
  );
  assertEquals(
    parseEvents(JSON.stringify({
      items: [{
        type: "Normal",
        reason: "Pulled",
        message: "Container image already present",
        involvedObject: { kind: "Pod", name: "api-1" },
        count: 1,
        lastTimestamp: "2026-08-29T09:00:00Z",
      }],
    })),
    [{
      type: "Normal",
      reason: "Pulled",
      message: "Container image already present",
      regarding: "Pod/api-1",
      count: 1,
      lastSeen: "2026-08-29T09:00:00Z",
    }],
  );
  // Neither a reason nor a message means there is nothing to report.
  assertEquals(parseEvents('{"items":[{"type":"Normal"}]}'), []);
  assertEquals(parseEvents(""), []);
  // An item that is not an object at all is skipped, not coerced.
  assertEquals(parseEvents('{"items":[null,"Warning",7]}'), []);
  assertEquals(parseResources('{"items":[null,"Pod"]}'), []);
  // A reason with no message, a subject with no kind, and the eventTime
  // spelling: each is the arm the other cases do not take.
  assertEquals(
    parseEvents(
      '{"items":[{"reason":"Killing","regarding":{"name":"api-0"},"eventTime":"2026-08-29T11:00:00Z"}]}',
    ),
    [{
      type: "",
      reason: "Killing",
      message: "",
      regarding: "api-0",
      lastSeen: "2026-08-29T11:00:00Z",
    }],
  );
});

Deno.test("parseVersion reads the two versions, and shrugs at anything else", () => {
  assertEquals(
    parseVersion(
      '{"clientVersion":{"gitVersion":"v1.31.2"},"serverVersion":{"gitVersion":"v1.30.5"}}',
    ),
    { client: "v1.31.2", server: "v1.30.5" },
  );
  // --client asks for one of them; the other is simply absent.
  assertEquals(parseVersion('{"clientVersion":{"gitVersion":"v1.31.2"}}'), {
    client: "v1.31.2",
  });
  // The versions are advisory, so a payload that is not an object is empty
  // rather than a thrown error.
  assertEquals(parseVersion("[]"), {});
  assertEquals(parseVersion('"v1"'), {});
  assertEquals(parseVersion(""), {});
});

Deno.test("every new task reaches execution", async () => {
  const reaches: Array<[string, () => Promise<unknown>]> = [
    ["diff", () => KubectlTasks.diff((s) => missingTool(s).file("k8s/"))],
    [
      "diffHasChanges",
      () => KubectlTasks.diffHasChanges((s) => missingTool(s).file("k8s/")),
    ],
    [
      "replace",
      () => KubectlTasks.replace((s) => missingTool(s).file("a.yaml")),
    ],
    [
      "getEntries",
      () => KubectlTasks.getEntries((s) => missingTool(s).resource("pods")),
    ],
    ["explain", () => KubectlTasks.explain((s) => missingTool(s).type("pods"))],
    [
      "setEnv",
      () =>
        KubectlTasks.setEnv((s) =>
          missingTool(s).resource("deploy/api").set("A", "b")
        ),
    ],
    [
      "setResources",
      () =>
        KubectlTasks.setResources((s) =>
          missingTool(s).resource("deploy/api").limit("cpu", "1")
        ),
    ],
    [
      "run",
      () => KubectlTasks.run((s) => missingTool(s).name("j").image("i")),
    ],
    [
      "expose",
      () => KubectlTasks.expose((s) => missingTool(s).resource("deploy/api")),
    ],
    ["cp", () => KubectlTasks.cp((s) => missingTool(s).from("p:/a").to("b"))],
    ["events", () => KubectlTasks.events((s) => missingTool(s))],
    ["eventEntries", () => KubectlTasks.eventEntries((s) => missingTool(s))],
    [
      "currentContext",
      () => KubectlTasks.currentContext((s) => missingTool(s)),
    ],
    ["contexts", () => KubectlTasks.contexts((s) => missingTool(s))],
    [
      "useContext",
      () => KubectlTasks.useContext((s) => missingTool(s).contextName("p")),
    ],
    [
      "setContext",
      () => KubectlTasks.setContext((s) => missingTool(s).current()),
    ],
    ["configView", () => KubectlTasks.configView((s) => missingTool(s))],
    ["version", () => KubectlTasks.version((s) => missingTool(s))],
    ["versionInfo", () => KubectlTasks.versionInfo((s) => missingTool(s))],
    ["clusterInfo", () => KubectlTasks.clusterInfo((s) => missingTool(s))],
    ["apiResources", () => KubectlTasks.apiResources((s) => missingTool(s))],
    ["apiVersions", () => KubectlTasks.apiVersions((s) => missingTool(s))],
    [
      "authCanI",
      () => KubectlTasks.authCanI((s) => missingTool(s).verb("get")),
    ],
    ["canI", () => KubectlTasks.canI((s) => missingTool(s).verb("get"))],
    ["kustomize", () => KubectlTasks.kustomize((s) => missingTool(s))],
    ["cordon", () => KubectlTasks.cordon((s) => missingTool(s).node("w1"))],
    ["drain", () => KubectlTasks.drain((s) => missingTool(s).node("w1"))],
    [
      "taint",
      () =>
        KubectlTasks.taint((s) =>
          missingTool(s).node("w1").taint("k", "v", "NoSchedule")
        ),
    ],
  ];
  assertEquals(reaches.length, 28);
  for (const [name, reach] of reaches) {
    // Naming the task in the wrapper keeps a regression legible: without it
    // the failure only says one of twenty-eight stopped reaching kubectl.
    await assertRejects(
      async () => {
        try {
          await reach();
        } catch (error) {
          if (error instanceof ToolNotFoundError) throw error;
          throw new Error(
            `${name} did not reach kubectl: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      },
      ToolNotFoundError,
    );
  }
});

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertThrows,
} from "../../../packages/core/tests/_assert.ts";
import { sdkCommand } from "../src/config.ts";
import {
  isRecord,
  parseExec,
  parseHello,
  parseManifest,
} from "../src/protocol.ts";

const HELLO = {
  sdk: "zuke-test",
  protocol: 1,
  token: "t",
  env: { PATH: "/bin" },
  cwd: "/work",
};

Deno.test("parseHello accepts a well-formed greeting with the right token", () => {
  assertEquals(parseHello(HELLO, "t"), {
    sdk: "zuke-test",
    token: "t",
    env: { PATH: "/bin" },
    cwd: "/work",
  });
});

Deno.test("parseHello rejects a wrong token, protocol, or shape", () => {
  assertThrows(() => parseHello(HELLO, "other"), Error, "token mismatch");
  assertThrows(
    () => parseHello({ ...HELLO, protocol: 2 }, "t"),
    Error,
    "protocol 1 only",
  );
  assertThrows(() => parseHello("hi", "t"), Error, "expected an object");
  assertThrows(
    () => parseHello({ ...HELLO, sdk: undefined }, "t"),
    Error,
    'missing field "sdk"',
  );
  assertThrows(
    () => parseHello({ ...HELLO, cwd: 1 }, "t"),
    Error,
    '"cwd" must be a string',
  );
  assertThrows(
    () => parseHello({ ...HELLO, env: { A: 1 } }, "t"),
    Error,
    '"env" must map strings to strings',
  );
  assertThrows(
    () => parseHello({ ...HELLO, env: [] }, "t"),
    Error,
    '"env" must map strings to strings',
  );
});

Deno.test("parseManifest fills defaults and validates every target", () => {
  assertEquals(
    parseManifest({
      name: "B",
      targets: [{ name: "a" }, {
        name: "b",
        description: "d",
        dependsOn: ["a"],
        extra: true,
      }],
    }),
    {
      name: "B",
      targets: [
        { name: "a", description: "", dependsOn: [] },
        { name: "b", description: "d", dependsOn: ["a"] },
      ],
    },
  );
  assertThrows(() => parseManifest(null), Error, "manifest: expected");
  assertThrows(
    () => parseManifest({ name: "B", targets: {} }),
    Error,
    '"targets" must be an array',
  );
  assertThrows(
    () => parseManifest({ name: "B", targets: [1] }),
    Error,
    "manifest.targets[0]: expected an object",
  );
  assertThrows(
    () =>
      parseManifest({ name: "B", targets: [{ name: "a", dependsOn: [1] }] }),
    Error,
    '"dependsOn" must be an array of strings',
  );
  assertThrows(
    () => parseManifest({ targets: [] }),
    Error,
    'missing field "name"',
  );
});

Deno.test("parseExec requires a target and a non-empty argv", () => {
  assertEquals(parseExec({ target: "t", argv: ["ls"] }), {
    target: "t",
    argv: ["ls"],
    cwd: undefined,
    env: undefined,
    stdin: undefined,
  });
  assertEquals(
    parseExec({
      target: "t",
      argv: ["cat"],
      cwd: "/x",
      env: { A: "1" },
      stdin: "in",
    }),
    { target: "t", argv: ["cat"], cwd: "/x", env: { A: "1" }, stdin: "in" },
  );
  assertThrows(
    () => parseExec({ target: "t", argv: [] }),
    Error,
    "argv must not be empty",
  );
  assertThrows(
    () => parseExec({ argv: ["ls"] }),
    Error,
    'missing field "target"',
  );
});

Deno.test("isRecord tells plain objects from arrays and primitives", () => {
  assertEquals(isRecord({}), true);
  assertEquals(isRecord([]), false);
  assertEquals(isRecord(null), false);
  assertEquals(isRecord("x"), false);
});

Deno.test("sdkCommand reads sdk.command and explains what is missing", () => {
  assertEquals(
    sdkCommand('{"name":"B","sdk":{"command":["uv","run","b.py"]}}', "z"),
    ["uv", "run", "b.py"],
  );
  for (
    const text of [
      '{"name":"B"}',
      '{"sdk":{}}',
      '{"sdk":{"command":[]}}',
      '{"sdk":{"command":"uv"}}',
      '{"sdk":{"command":["uv",1]}}',
    ]
  ) {
    assertThrows(() => sdkCommand(text, "z"), Error, 'z needs an "sdk"');
  }
});

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertThrows,
} from "../../../packages/core/tests/_assert.ts";
import { sdkCommand } from "../src/config.ts";
import {
  isRecord,
  parseCacheKey,
  parseCondition,
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

const BARE_TARGET = {
  name: "a",
  description: "",
  dependsOn: [],
  unlisted: false,
  inputs: [],
  outputs: [],
  produces: [],
  retry: { times: 0, delayMs: 0 },
  timeoutMs: undefined,
  before: [],
  after: [],
  triggers: [],
  proceedAfterFailure: false,
  always: false,
  dryRunnable: false,
  requires: [],
  onCancel: undefined,
  onFailure: undefined,
  condition: false,
  cacheKey: false,
};

const NO_HOOKS = {
  onStart: false,
  onTargetStart: false,
  onTargetEnd: false,
  onFinish: false,
};

Deno.test("parseManifest fills every default, so a phase 0 manifest still parses", () => {
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
      targets: [BARE_TARGET, {
        ...BARE_TARGET,
        name: "b",
        description: "d",
        dependsOn: ["a"],
      }],
      parameters: [],
      groups: [],
      hooks: NO_HOOKS,
      config: { deadline: undefined, unforceable: [] },
    },
  );
});

Deno.test("parseManifest carries every target setting, parameter kind, group and config field", () => {
  const full = parseManifest({
    name: "B",
    targets: [{
      name: "a",
      unlisted: true,
      inputs: ["src/**"],
      outputs: ["out"],
      produces: ["dist.tgz"],
      retry: { times: 2, delayMs: 50 },
      timeoutMs: 1000,
      before: ["b"],
      after: ["c"],
      triggers: ["d"],
      proceedAfterFailure: true,
      always: true,
      dryRunnable: true,
      requires: ["tag"],
      onCancel: "undo",
      onFailure: "cancel-run",
      condition: true,
      cacheKey: true,
    }],
    hooks: { onStart: true, onFinish: true },
    parameters: [
      { name: "tag", description: "t", default: "dev", options: ["dev"] },
      { name: "n", kind: "number", default: 3, required: true },
      { name: "v", kind: "boolean", default: true, flag: "verbose" },
      { name: "s", secret: true, env: "S", array: true },
    ],
    groups: [{ name: "g", members: ["a"] }],
    config: { deadline: "45m", unforceable: ["a"] },
  });
  assertEquals(full.targets[0], {
    name: "a",
    description: "",
    dependsOn: [],
    unlisted: true,
    inputs: ["src/**"],
    outputs: ["out"],
    produces: ["dist.tgz"],
    retry: { times: 2, delayMs: 50 },
    timeoutMs: 1000,
    before: ["b"],
    after: ["c"],
    triggers: ["d"],
    proceedAfterFailure: true,
    always: true,
    dryRunnable: true,
    requires: ["tag"],
    onCancel: "undo",
    onFailure: "cancel-run",
    condition: true,
    cacheKey: true,
  });
  assertEquals(full.hooks, { ...NO_HOOKS, onStart: true, onFinish: true });
  assertEquals(full.parameters.map((p) => [p.kind, p.default]), [
    ["string", "dev"],
    ["number", 3],
    ["boolean", true],
    ["string", undefined],
  ]);
  const [tag, n, v, s] = full.parameters;
  assertEquals(tag?.kind === "string" ? tag.options : [], ["dev"]);
  assertEquals([n?.required, v?.flag, s?.secret, s?.env, s?.array], [
    true,
    "verbose",
    true,
    "S",
    true,
  ]);
  assertEquals(full.groups, [{ name: "g", members: ["a"] }]);
  assertEquals(full.config, { deadline: "45m", unforceable: ["a"] });
});

Deno.test("parseManifest names the malformed field", () => {
  const target = (extra: Record<string, unknown>) => ({
    name: "B",
    targets: [{ name: "a", ...extra }],
  });
  const param = (extra: Record<string, unknown>) => ({
    name: "B",
    targets: [],
    parameters: [{ name: "p", ...extra }],
  });
  const cases: Array<[unknown, string]> = [
    [null, "manifest: expected an object"],
    [{ targets: [] }, 'manifest: missing field "name"'],
    [{ name: "B", targets: {} }, '"targets" must be an array'],
    [{ name: "B", targets: [1] }, "manifest.targets[0]: expected an object"],
    [target({ dependsOn: [1] }), '"dependsOn" must be an array of strings'],
    [target({ description: 1 }), '"description" must be a string'],
    [target({ unlisted: "yes" }), '"unlisted" must be a boolean'],
    [target({ retry: { times: -1 } }), '"times" must be a non-negative number'],
    [target({ retry: 3 }), "manifest.targets[0].retry: expected an object"],
    [target({ timeoutMs: "1s" }), '"timeoutMs" must be a non-negative number'],
    [target({ onCancel: 1 }), '"onCancel" must be a string'],
    [target({ condition: "yes" }), '"condition" must be a boolean'],
    [target({ cacheKey: "k" }), '"cacheKey" must be a boolean'],
    [
      { name: "B", targets: [], hooks: { onStart: 1 } },
      'manifest.hooks: field "onStart" must be a boolean',
    ],
    [
      { name: "B", targets: [], hooks: [] },
      "manifest.hooks: expected an object",
    ],
    [param({ kind: "date" }), '"kind" must be "string", "number" or "boolean"'],
    [param({ default: 1 }), '"default" must be a string'],
    [param({ kind: "number", default: "1" }), '"default" must be a number'],
    [param({ kind: "boolean", default: "y" }), '"default" must be a boolean'],
    [param({ array: true, default: "a" }), "be absent on an array parameter"],
    [
      param({ kind: "boolean", array: true }),
      "be false on a boolean parameter",
    ],
    [param({ options: "a" }), '"options" must be an array of strings'],
    [
      { name: "B", targets: [], groups: [{ name: "g" }] },
      'missing field "members"',
    ],
    [{ name: "B", targets: [], config: { deadline: true } }, "duration string"],
    [{ name: "B", targets: [], config: { unforceable: "a" } }, '"unforceable"'],
  ];
  for (const [input, message] of cases) {
    assertThrows(() => parseManifest(input), Error, message);
  }
});

Deno.test("parseCondition and parseCacheKey accept one type and name the target", () => {
  assertEquals(parseCondition(true, "a"), true);
  assertEquals(parseCacheKey("k", "a"), "k");
  assertThrows(
    () => parseCondition("yes", "a"),
    Error,
    'target.condition: "a" must answer a boolean',
  );
  assertThrows(
    () => parseCacheKey(1, "a"),
    Error,
    'target.cacheKey: "a" must answer a string',
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

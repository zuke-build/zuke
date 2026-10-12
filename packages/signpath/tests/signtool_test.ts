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
import { SigntoolTasks, SigntoolVerifySettings } from "../mod.ts";

Deno.test("signtool: verify /pa /v renders the usual post-sign check", () => {
  assertEquals(
    new SigntoolVerifySettings().authenticodePolicy().verbose()
      .file("dist/zuke.exe").argv(),
    ["signtool", "verify", "/pa", "/v", "dist/zuke.exe"],
  );
});

Deno.test("signtool: every flag renders in order, files last", () => {
  assertEquals(
    new SigntoolVerifySettings().kernelPolicy()
      .policy("{F750E6C3-38EE-11D1-85E5-00C04FC295EE}").allSignatures()
      .signatureIndex(1).hash("SHA256").catalog("C:\\cat\\x.cat")
      .rootSubjectName("Microsoft").timestampWarning().description().debug()
      .file("a.exe", "b.msi").argv(),
    [
      "signtool",
      "verify",
      "/kp",
      "/pg",
      "{F750E6C3-38EE-11D1-85E5-00C04FC295EE}",
      "/all",
      "/ds",
      "1",
      "/hash",
      "SHA256",
      "/c",
      "C:\\cat\\x.cat",
      "/r",
      "Microsoft",
      "/tw",
      "/d",
      "/debug",
      "a.exe",
      "b.msi",
    ],
  );
});

Deno.test("signtool: a file operand cannot be read as an option", () => {
  assertEquals(
    new SigntoolVerifySettings().file("-x.exe").argv().at(-1),
    "./-x.exe",
  );
  assertThrows(
    () => new SigntoolVerifySettings().file("/pa"),
    Error,
    'starts with "/"',
  );
});

Deno.test("signtool: verify needs a file", () => {
  assertThrows(
    () => new SigntoolVerifySettings().authenticodePolicy().argv(),
    Error,
    "no file to verify",
  );
});

Deno.test("signtool: the task reaches execution", async () => {
  let argv: string[] = [];
  await assertRejects(
    () =>
      SigntoolTasks.verify((s) => {
        const configured = missingTool(s).authenticodePolicy().file("a.exe");
        argv = configured.argv();
        return configured;
      }),
    ToolNotFoundError,
  );
  assertEquals(argv.slice(1), ["verify", "/pa", "a.exe"]);
});

Deno.test("signtool resolves its binary from PATH", async () => {
  await assertWrapperConformance(
    () => new SigntoolVerifySettings().file("a.exe"),
    "signtool",
    { resolution: "path" },
  );
});

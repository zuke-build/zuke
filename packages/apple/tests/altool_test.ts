// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT
// cspell:ignore efgh ijkl mnop

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
import { AltoolSettings, AltoolTasks } from "../mod.ts";

Deno.test("altool resolves xcrun from PATH", async () => {
  await assertWrapperConformance(
    () =>
      new AltoolSettings("--upload-app").file("a.ipa").type("ios").apiKey(
        "K",
        "I",
      ),
    "xcrun",
    { resolution: "path" },
  );
});

Deno.test("altool: upload with an API key, JSON output", () => {
  assertEquals(
    new AltoolSettings("--upload-app").file("-App.ipa").type("ios")
      .apiKey("ABC123", "issuer-uuid").argv().slice(1),
    [
      "altool",
      "--upload-app",
      "--file",
      "./-App.ipa",
      "--type",
      "ios",
      "--apiKey",
      "ABC123",
      "--apiIssuer",
      "issuer-uuid",
      "--output-format",
      "json",
    ],
  );
});

Deno.test("altool: the password rides an environment variable, masked", () => {
  class Spy extends AltoolSettings {
    readonly marked: string[] = [];
    readonly envs: Array<Record<string, string>> = [];
    protected override markSecret(value: string): void {
      this.marked.push(value);
    }
    override env(record: Record<string, string>): this {
      this.envs.push(record);
      return super.env(record);
    }
  }
  const settings = new Spy("--validate-app").file("App.pkg").type("macos")
    .appleId("dev@example.com", "abcd-efgh-ijkl-mnop")
    .apiPrivateKeysDir("keys");
  assertEquals(settings.marked, ["abcd-efgh-ijkl-mnop"]);
  assertEquals(settings.envs, [
    { ZUKE_ALTOOL_PASSWORD: "abcd-efgh-ijkl-mnop" },
    { API_PRIVATE_KEYS_DIR: "keys" },
  ]);
  const argv = settings.argv();
  assertEquals(argv.includes("abcd-efgh-ijkl-mnop"), false);
  assertEquals(argv.slice(7, 11), [
    "--username",
    "dev@example.com",
    "--password",
    "@env:ZUKE_ALTOOL_PASSWORD",
  ]);
});

Deno.test("altool: file, type and credentials are required", () => {
  assertThrows(
    () =>
      new AltoolSettings("--upload-app").type("ios").apiKey("K", "I").argv(),
    Error,
    "altool --upload-app: .file() and .type() are required.",
  );
  assertThrows(
    () => new AltoolSettings("--upload-app").file("a").type("ios").argv(),
    Error,
    "authenticate with .apiKey() or .appleId()",
  );
});

Deno.test("AltoolTasks: both tasks reach execution", async () => {
  for (const task of [AltoolTasks.uploadApp, AltoolTasks.validateApp]) {
    await assertRejects(
      () =>
        task((s) => missingTool(s.file("a.ipa").type("ios").apiKey("K", "I"))),
      ToolNotFoundError,
    );
  }
});

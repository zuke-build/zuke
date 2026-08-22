// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects, assertThrows } from "./_assert.ts";
import { ToolNotFoundError } from "../src/tooling.ts";
import { missingTool } from "../src/tooling_conformance.ts";
import { BrowserOpenSettings, BrowserTasks } from "../src/browser.ts";

const URL_ = "https://github.com/zuke-build/zuke";

/** Settings pinned to `os`, so each platform branch is testable anywhere. */
function onOs(os: typeof Deno.build.os): BrowserOpenSettings {
  const settings = new BrowserOpenSettings(URL_);
  settings.os_ = os;
  return settings;
}

Deno.test("open uses xdg-open on Linux", () => {
  assertEquals(onOs("linux").argv(), ["xdg-open", URL_]);
});

Deno.test("open uses open on macOS", () => {
  assertEquals(onOs("darwin").argv(), ["open", URL_]);
});

Deno.test("open uses rundll32's protocol handler on Windows", () => {
  assertEquals(onOs("windows").argv(), [
    "rundll32",
    "url.dll,FileProtocolHandler",
    URL_,
  ]);
});

Deno.test("open rejects a string that is not a URL", () => {
  assertThrows(
    () => new BrowserOpenSettings("not a url"),
    Error,
    "not a valid URL",
  );
});

Deno.test("open rejects a non-http(s) scheme", () => {
  assertThrows(
    () => new BrowserOpenSettings("file:///etc/passwd"),
    Error,
    "only http: and https:",
  );
  assertThrows(
    () => new BrowserOpenSettings("javascript:alert(1)"),
    Error,
    "only http: and https:",
  );
});

Deno.test("BrowserTasks.open reaches execution", async () => {
  await assertRejects(
    () => BrowserTasks.open(URL_, (s) => missingTool(s)),
    ToolNotFoundError,
  );
});

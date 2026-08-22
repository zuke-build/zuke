// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import { GhApiSettings } from "../src/api_command.ts";
import { GhTasks } from "../src/gh.ts";

Deno.test("gh api: the minimal call is just the endpoint", () => {
  assertEquals(new GhApiSettings("user").argv(), ["gh", "api", "user"]);
});

Deno.test("gh api: starring a repository is a PUT with no body", () => {
  const argv = new GhApiSettings("user/starred/zuke-build/zuke")
    .method("PUT")
    .silent()
    .argv();
  assertEquals(argv, [
    "gh",
    "api",
    "user/starred/zuke-build/zuke",
    "--method",
    "PUT",
    "--silent",
  ]);
});

Deno.test("gh api: fields, headers, and jq render in call order", () => {
  const argv = new GhApiSettings("repos/acme/app/issues")
    .method("POST")
    .rawField("title", "Bug")
    .field("draft", true)
    .header("Accept", "application/vnd.github+json")
    .jq(".number")
    .argv();
  assertEquals(argv, [
    "gh",
    "api",
    "repos/acme/app/issues",
    "--method",
    "POST",
    "--raw-field",
    "title=Bug",
    "--field",
    "draft=true",
    "--header",
    "Accept:application/vnd.github+json",
    "--jq",
    ".number",
  ]);
});

Deno.test("gh api conforms as a PATH-resolved gh wrapper", async () => {
  await assertWrapperConformance(() => new GhApiSettings("user"), "gh", {
    resolution: "path",
  });
});

Deno.test("GhTasks.api reaches execution", async () => {
  await assertRejects(
    () =>
      GhTasks.api(
        "user/starred/zuke-build/zuke",
        (s) => missingTool(s.method("PUT")),
      ),
    ToolNotFoundError,
  );
});

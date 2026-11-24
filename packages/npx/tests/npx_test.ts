// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "../../core/tests/_testing.ts";
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
import { NpxSettings, NpxTasks } from "../src/npx.ts";

test("the default binary is npx", () => {
  assertEquals(new NpxSettings().command("x").argv()[0], "npx");
});

test("npx: command required (or a call)", () => {
  assertThrows(
    () => new NpxSettings().argv(),
    Error,
    "NpxTasks.npx: .command() or .call() is required",
  );
});

test("npx: bare command", () => {
  assertEquals(new NpxSettings().command("cowsay").argv().slice(1), ["cowsay"]);
});

test("npx: packages, --yes, --ignore-existing, forwarded args", () => {
  assertEquals(
    new NpxSettings()
      .package("cowsay@1", "left-pad")
      .yes()
      .ignoreExisting()
      .command("cowsay")
      .execArgs("hello", 1)
      .argv()
      .slice(1),
    [
      "--package=cowsay@1",
      "--package=left-pad",
      "--yes",
      "--ignore-existing",
      "cowsay",
      "hello",
      "1",
    ],
  );
});

test("npx: --no suppresses auto-install", () => {
  assertEquals(new NpxSettings().no().command("tsc").argv().slice(1), [
    "--no",
    "tsc",
  ]);
});

test("npx: --call runs a string without a command", () => {
  assertEquals(
    new NpxSettings().package("cowsay").call("cowsay hi").argv().slice(1),
    ["--package=cowsay", "--call", "cowsay hi"],
  );
});

test("NpxTasks.npx reaches execution", async () => {
  await assertRejects(
    () => NpxTasks.npx((s) => missingTool(s).command("x")),
    ToolNotFoundError,
  );
});

test("npx: conforms to the wrapper contract", async () => {
  await assertWrapperConformance(
    () => new NpxSettings().command("tsc"),
    "npx",
    {
      resolution: "path",
    },
  );
});

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import {
  ArgoRolloutsPromoteSettings,
  ArgoRolloutsRestartSettings,
  ArgoRolloutsSetImageSettings,
  ArgoRolloutsStatusSettings,
  ArgoRolloutsUndoSettings,
} from "../mod.ts";

Deno.test("setImage renders the rollout and one CONTAINER=IMAGE pair", () => {
  assertEquals(
    new ArgoRolloutsSetImageSettings()
      .name("api")
      .image("api", "acme/api:1.4.0")
      .namespace("prod")
      .argv()
      .slice(1),
    ["set", "image", "api", "api=acme/api:1.4.0", "--namespace", "prod"],
  );
  assertEquals(
    new ArgoRolloutsSetImageSettings().name("api").image("*", "x:1").argv()
      .slice(1),
    ["set", "image", "api", "*=x:1"],
  );
});

Deno.test("setImage requires a name and an image", () => {
  assertThrows(
    () => new ArgoRolloutsSetImageSettings().image("api", "x:1").argv(),
    Error,
    "ArgoRolloutsTasks.setImage: .name() is required.",
  );
  assertThrows(
    () => new ArgoRolloutsSetImageSettings().name("api").argv(),
    Error,
    "ArgoRolloutsTasks.setImage: .image() is required.",
  );
});

Deno.test("promote: bare and --full", () => {
  assertEquals(
    new ArgoRolloutsPromoteSettings().name("api").argv().slice(1),
    ["promote", "api"],
  );
  assertEquals(
    new ArgoRolloutsPromoteSettings().name("api").full().argv().slice(1),
    ["promote", "api", "--full"],
  );
  assertThrows(
    () => new ArgoRolloutsPromoteSettings().argv(),
    Error,
    "ArgoRolloutsTasks.promote: .name() is required.",
  );
});

Deno.test("status: bare, with a timeout, and without watching", () => {
  assertEquals(
    new ArgoRolloutsStatusSettings().name("api").argv().slice(1),
    ["status", "api"],
  );
  assertEquals(
    new ArgoRolloutsStatusSettings().name("api").timeout("10m").noWatch()
      .argv().slice(1),
    ["status", "api", "--timeout", "10m", "--watch=false"],
  );
  assertThrows(
    () => new ArgoRolloutsStatusSettings().argv(),
    Error,
    "ArgoRolloutsTasks.status: .name() is required.",
  );
});

Deno.test("undo: bare and to a revision", () => {
  assertEquals(
    new ArgoRolloutsUndoSettings().name("api").argv().slice(1),
    ["undo", "api"],
  );
  assertEquals(
    new ArgoRolloutsUndoSettings().name("api").toRevision(3).argv().slice(1),
    ["undo", "api", "--to-revision=3"],
  );
  assertThrows(
    () => new ArgoRolloutsUndoSettings().argv(),
    Error,
    "ArgoRolloutsTasks.undo: .name() is required.",
  );
});

Deno.test("restart: now and after a delay", () => {
  assertEquals(
    new ArgoRolloutsRestartSettings().name("api").argv().slice(1),
    ["restart", "api"],
  );
  assertEquals(
    new ArgoRolloutsRestartSettings().name("api").in("30s").argv().slice(1),
    ["restart", "api", "--in", "30s"],
  );
  assertThrows(
    () => new ArgoRolloutsRestartSettings().argv(),
    Error,
    "ArgoRolloutsTasks.restart: .name() is required.",
  );
});

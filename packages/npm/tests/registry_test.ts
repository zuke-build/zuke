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
  NpmAccessSettings,
  NpmOwnerSettings,
  NpmPingSettings,
  NpmTasks,
  NpmTokenSettings,
  NpmViewSettings,
  NpmWhoamiSettings,
} from "../mod.ts";

Deno.test("view puts its fields after the spec, and refuses them without one", () => {
  assertEquals(
    new NpmViewSettings().spec("react").field("dist-tags.latest")
      .argv().slice(1),
    ["view", "react", "dist-tags.latest"],
  );
  // Without a spec npm would read the first field as the package name.
  assertThrows(
    () => new NpmViewSettings().field("version").argv(),
    Error,
    "NpmTasks.view: a field follows the package spec",
  );
});

Deno.test("ping and whoami are bare commands", () => {
  assertEquals(new NpmPingSettings().argv().slice(1), ["ping"]);
  assertEquals(new NpmWhoamiSettings().argv().slice(1), ["whoami"]);
  assertEquals(
    new NpmPingSettings().registry("https://r.example.test/").argv().slice(1),
    ["ping", "--registry=https://r.example.test/"],
  );
});

Deno.test("access renders each of npm's forms", () => {
  assertEquals(new NpmAccessSettings().argv().slice(1), [
    "access",
    "get",
    "status",
  ]);
  assertEquals(
    new NpmAccessSettings().setStatus("public", "app").argv().slice(1),
    ["access", "set", "status=public", "app"],
  );
  assertEquals(
    new NpmAccessSettings().setMfa("automation").otp("123456").argv().slice(1),
    ["access", "set", "mfa=automation", "--otp=123456"],
  );
  assertEquals(
    new NpmAccessSettings().listPackages("@scope").argv().slice(1),
    ["access", "list", "packages", "@scope"],
  );
  assertEquals(
    new NpmAccessSettings().listCollaborators("app").argv().slice(1),
    ["access", "list", "collaborators", "app"],
  );
  assertEquals(
    new NpmAccessSettings().grant("read-write", "scope:team", "app")
      .argv().slice(1),
    ["access", "grant", "read-write", "scope:team", "app"],
  );
  assertEquals(
    new NpmAccessSettings().revoke("scope:team").argv().slice(1),
    ["access", "revoke", "scope:team"],
  );
});

Deno.test("owner requires a subcommand and renders each", () => {
  assertThrows(
    () => new NpmOwnerSettings().argv(),
    Error,
    "NpmTasks.owner: no subcommand",
  );
  assertEquals(
    new NpmOwnerSettings().add("someone", "app").argv().slice(1),
    ["owner", "add", "someone", "app"],
  );
  assertEquals(
    new NpmOwnerSettings().rm("someone", "app").otp("123456").argv().slice(1),
    ["owner", "rm", "someone", "app", "--otp=123456"],
  );
  assertEquals(new NpmOwnerSettings().ls("app").argv().slice(1), [
    "owner",
    "ls",
    "app",
  ]);
});

Deno.test("token lists by default, and keeps create-only flags to create", () => {
  assertEquals(new NpmTokenSettings().argv().slice(1), ["token", "list"]);
  assertEquals(
    new NpmTokenSettings().create().readOnly().cidr("10.0.0.0/8")
      .argv().slice(1),
    ["token", "create", "--read-only", "--cidr=10.0.0.0/8"],
  );
  assertEquals(
    new NpmTokenSettings().revoke("abc123").argv().slice(1),
    ["token", "revoke", "abc123"],
  );
  // Dropping the flag silently would revoke a token while the caller thought
  // they were minting a read-only one.
  assertThrows(
    () => new NpmTokenSettings().revoke("abc123").readOnly().argv(),
    Error,
    "NpmTasks.token: .readOnly()/.cidr(...) describe a token being made",
  );
});

Deno.test("whoamiName reports a missing login as undefined, not a failure", async () => {
  // Hermetic: the running `deno` stands in for npm — it exits non-zero on a
  // subcommand it does not have, exactly as `npm whoami` does when logged out.
  const name = await NpmTasks.whoamiName((s) =>
    s.toolPath(Deno.execPath()).quiet()
  );
  assertEquals(name, undefined);
});

Deno.test("the registry tasks reach execution", async () => {
  await assertRejects(() => NpmTasks.view(missingTool), ToolNotFoundError);
  await assertRejects(() => NpmTasks.ping(missingTool), ToolNotFoundError);
  await assertRejects(() => NpmTasks.whoami(missingTool), ToolNotFoundError);
  await assertRejects(() => NpmTasks.access(missingTool), ToolNotFoundError);
  await assertRejects(
    () => NpmTasks.owner((s) => missingTool(s).ls("app")),
    ToolNotFoundError,
  );
  await assertRejects(() => NpmTasks.token(missingTool), ToolNotFoundError);
  await assertRejects(
    () => NpmTasks.whoamiName((s) => missingTool(s)),
    ToolNotFoundError,
  );
});

Deno.test("the access forms that take an optional package render it", () => {
  // Each form has a bare and a package-scoped shape; both reach npm's own
  // grammar, so both are asserted rather than assumed.
  assertEquals(
    new NpmAccessSettings().getStatus("app").argv().slice(1),
    ["access", "get", "status", "app"],
  );
  assertEquals(
    new NpmAccessSettings().setStatus("private").argv().slice(1),
    ["access", "set", "status=private"],
  );
  assertEquals(
    new NpmAccessSettings().setMfa("publish", "app").argv().slice(1),
    ["access", "set", "mfa=publish", "app"],
  );
  assertEquals(
    new NpmAccessSettings().listPackages("@scope", "app").argv().slice(1),
    ["access", "list", "packages", "@scope", "app"],
  );
  assertEquals(
    new NpmAccessSettings().listPackages().argv().slice(1),
    ["access", "list", "packages"],
  );
  assertEquals(
    new NpmAccessSettings().listCollaborators("app", "someone").argv().slice(1),
    ["access", "list", "collaborators", "app", "someone"],
  );
  assertEquals(
    new NpmAccessSettings().listCollaborators().argv().slice(1),
    ["access", "list", "collaborators"],
  );
  assertEquals(
    new NpmAccessSettings().grant("read-only", "scope:team").argv().slice(1),
    ["access", "grant", "read-only", "scope:team"],
  );
  assertEquals(
    new NpmAccessSettings().revoke("scope:team", "app").argv().slice(1),
    ["access", "revoke", "scope:team", "app"],
  );
});

Deno.test("token.list is explicit as well as the default", () => {
  assertEquals(new NpmTokenSettings().list().argv().slice(1), [
    "token",
    "list",
  ]);
});

Deno.test("view lists a workspace's own package when given no spec", () => {
  assertEquals(new NpmViewSettings().workspace("app").argv().slice(1), [
    "view",
    "--workspace=app",
  ]);
});

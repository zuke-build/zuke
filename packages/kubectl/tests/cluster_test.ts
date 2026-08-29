// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import {
  KubectlApiResourcesSettings,
  KubectlApiVersionsSettings,
  KubectlAuthCanISettings,
  KubectlClusterInfoSettings,
  KubectlConfigCurrentContextSettings,
  KubectlConfigGetContextsSettings,
  KubectlConfigSetContextSettings,
  KubectlConfigUseContextSettings,
  KubectlConfigViewSettings,
  KubectlKustomizeSettings,
  KubectlVersionSettings,
} from "../mod.ts";

Deno.test("the config commands render their arguments", () => {
  assertEquals(
    new KubectlConfigCurrentContextSettings().argv().slice(1),
    ["config", "current-context"],
  );
  assertEquals(
    new KubectlConfigGetContextsSettings().namesOnly().noHeaders().argv()
      .slice(1),
    ["config", "get-contexts", "-o", "name", "--no-headers"],
  );
  assertEquals(
    new KubectlConfigUseContextSettings().contextName("staging").argv().slice(
      1,
    ),
    ["config", "use-context", "staging"],
  );
  assertEquals(
    new KubectlConfigViewSettings().minify().flatten().output("json").argv()
      .slice(1),
    ["config", "view", "--minify", "--flatten", "-o", "json"],
  );
});

Deno.test("use-context distinguishes the context it switches to from the one it runs under", () => {
  // `.context(...)` is the global flag picking a context for one command;
  // `.contextName(...)` is the operand naming the context to switch to. Both
  // render, and they mean different things.
  assertEquals(
    new KubectlConfigUseContextSettings().context("admin").contextName("prod")
      .argv().slice(1),
    ["config", "use-context", "--context", "admin", "prod"],
  );
  assertThrows(
    () => new KubectlConfigUseContextSettings().argv(),
    Error,
    "KubectlTasks.useContext: .contextName(...) is required",
  );
});

Deno.test("set-context names a context or takes the current one", () => {
  assertEquals(
    new KubectlConfigSetContextSettings().contextName("prod").cluster("east")
      .user("deployer").namespace("apps").argv().slice(1),
    [
      "config",
      "set-context",
      "--namespace",
      "apps",
      "prod",
      "--cluster=east",
      "--user=deployer",
    ],
  );
  assertEquals(
    new KubectlConfigSetContextSettings().current().namespace("apps").argv()
      .slice(1),
    ["config", "set-context", "--namespace", "apps", "--current"],
  );
  assertThrows(
    () => new KubectlConfigSetContextSettings().cluster("east").argv(),
    Error,
    "KubectlTasks.setContext: name the context with .contextName(...)",
  );
  assertThrows(
    () =>
      new KubectlConfigSetContextSettings().contextName("prod").current()
        .argv(),
    Error,
    "KubectlTasks.setContext: .contextName(...) names a context",
  );
});

Deno.test("version, cluster-info and the api listings render their flags", () => {
  assertEquals(
    new KubectlVersionSettings().clientOnly().output("json").argv().slice(1),
    ["version", "--client", "-o", "json"],
  );
  assertEquals(
    new KubectlClusterInfoSettings().context("prod").argv().slice(1),
    ["cluster-info", "--context", "prod"],
  );
  assertEquals(new KubectlApiVersionsSettings().argv().slice(1), [
    "api-versions",
  ]);
  assertEquals(
    new KubectlApiResourcesSettings()
      .apiGroup("apps")
      .namespaced(false)
      .verbs("get", "list")
      .categories("all")
      .sortBy("kind")
      .output("name")
      .noHeaders()
      .cached()
      .argv()
      .slice(1),
    [
      "api-resources",
      "--api-group=apps",
      "--namespaced=false",
      "--verbs=get,list",
      "--categories=all",
      "--sort-by=kind",
      "-o",
      "name",
      "--no-headers",
      "--cached",
    ],
  );
});

Deno.test("auth can-i names the action, or asks for the whole list", () => {
  assertEquals(
    new KubectlAuthCanISettings().verb("create").resource("deployments")
      .namespace("prod").argv().slice(1),
    ["auth", "can-i", "--namespace", "prod", "create", "deployments"],
  );
  assertEquals(
    new KubectlAuthCanISettings().verb("get").resource("pods").subresource(
      "log",
    ).allNamespaces().quietAnswer().argv().slice(1),
    [
      "auth",
      "can-i",
      "get",
      "pods",
      "--subresource=log",
      "--all-namespaces",
      "--quiet",
    ],
  );
  assertEquals(
    new KubectlAuthCanISettings().list().allNamespaces().argv().slice(1),
    ["auth", "can-i", "--list", "--all-namespaces"],
  );
  assertThrows(
    () => new KubectlAuthCanISettings().argv(),
    Error,
    "KubectlTasks.authCanI: .verb(...) is required",
  );
  // --list prints everything, so narrowing it to one verb means nothing.
  assertThrows(
    () => new KubectlAuthCanISettings().list().verb("create").argv(),
    Error,
    "KubectlTasks.authCanI: .list() prints every allowed action",
  );
});

Deno.test("kubectl's --quiet stays distinct from Zuke's own", () => {
  // ToolSettings.quiet() suppresses Zuke's echo of the command; kubectl's
  // --quiet suppresses can-i's answer. Shadowing the first would have broken
  // every other wrapper's contract, so the second is named apart.
  assertEquals(
    new KubectlAuthCanISettings().verb("create").quiet().argv().slice(1),
    ["auth", "can-i", "create"],
  );
  assertEquals(
    new KubectlAuthCanISettings().verb("create").quietAnswer().argv().slice(1),
    ["auth", "can-i", "create", "--quiet"],
  );
});

Deno.test("kustomize renders its directory and flags", () => {
  assertEquals(
    new KubectlKustomizeSettings().dir("overlays/prod").output("out.yaml")
      .enableHelm().loadRestrictor("LoadRestrictionsNone").argv().slice(1),
    [
      "kustomize",
      "overlays/prod",
      "-o",
      "out.yaml",
      "--enable-helm",
      "--load-restrictor=LoadRestrictionsNone",
    ],
  );
  // kubectl assumes the working directory when none is given.
  assertEquals(new KubectlKustomizeSettings().argv().slice(1), ["kustomize"]);
});

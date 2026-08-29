// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import {
  CACHE_LIST_FIELDS,
  GhCacheDeleteSettings,
  GhCacheListSettings,
  GhSecretDeleteSettings,
  GhSecretListSettings,
  GhSecretSetSettings,
  GhVariableDeleteSettings,
  GhVariableGetSettings,
  GhVariableListSettings,
  GhVariableSetSettings,
  SECRET_LIST_FIELDS,
  VARIABLE_LIST_FIELDS,
} from "../mod.ts";
import { parseSecrets } from "../src/secret.ts";
import { parseVariables } from "../src/variable.ts";
import { parseCaches } from "../src/cache.ts";

Deno.test("secret set renders its value and its scope", () => {
  assertEquals(
    new GhSecretSetSettings().name("NPM_TOKEN").body("token-value").repo(
      "acme/app",
    )
      .argv().slice(1),
    [
      "secret",
      "set",
      "NPM_TOKEN",
      "--repo",
      "acme/app",
      "--body",
      "token-value",
    ],
  );
  assertEquals(
    new GhSecretSetSettings().name("NPM_TOKEN").app("dependabot").org("acme")
      .visibility("selected").repositories("acme/app", "acme/lib").argv()
      .slice(1),
    [
      "secret",
      "set",
      "NPM_TOKEN",
      "--app",
      "dependabot",
      "--org",
      "acme",
      "--visibility",
      "selected",
      "--repos",
      "acme/app,acme/lib",
    ],
  );
  // Omitting the value is the form that keeps it out of the argv: gh reads
  // standard input instead.
  assertEquals(
    new GhSecretSetSettings().name("NPM_TOKEN").argv().slice(1),
    ["secret", "set", "NPM_TOKEN"],
  );
  assertEquals(
    new GhSecretSetSettings().envFile(".env.ci").noStore().argv().slice(1),
    ["secret", "set", "--env-file", ".env.ci", "--no-store"],
  );
});

Deno.test("secret set refuses the scopes gh would resolve for itself", () => {
  assertThrows(
    () => new GhSecretSetSettings().body("a").envFile(".env").argv(),
    Error,
    "GhTasks.secretSet: .body(...) and .envFile(...) are two sources",
  );
  assertThrows(
    () => new GhSecretSetSettings().argv(),
    Error,
    "GhTasks.secretSet: .name(...) is required",
  );
  assertThrows(
    () => new GhSecretSetSettings().name("A").envFile(".env").argv(),
    Error,
    "GhTasks.secretSet: .envFile(...) carries its own names",
  );
  assertThrows(
    () =>
      new GhSecretSetSettings().name("A").org("acme").environment("prod")
        .argv(),
    Error,
    "GhTasks.secretSet: .org(...) sets an organization value",
  );
  assertThrows(
    () => new GhSecretSetSettings().name("A").repositories("acme/app").argv(),
    Error,
    "GhTasks.secretSet: .repositories(...) shares an organization value",
  );
  assertThrows(
    () =>
      new GhSecretSetSettings().name("A").org("acme").visibility("all")
        .repositories("acme/app").argv(),
    Error,
    "GhTasks.secretSet: .repositories(...) only applies to",
  );
  assertThrows(
    () => new GhSecretSetSettings().name("A").user().org("acme").argv(),
    Error,
    "GhTasks.secretSet: .user() scopes the secret to your account",
  );
});

Deno.test("secret list and delete render their scope", () => {
  assertEquals(
    new GhSecretListSettings().app("actions").org("acme").json("name").argv()
      .slice(1),
    ["secret", "list", "--app", "actions", "--org", "acme", "--json", "name"],
  );
  assertEquals(
    new GhSecretListSettings().user().environment("prod").argv().slice(1),
    ["secret", "list", "--env", "prod", "--user"],
  );
  assertEquals(
    new GhSecretDeleteSettings().name("OLD_TOKEN").environment("prod").argv()
      .slice(1),
    ["secret", "delete", "OLD_TOKEN", "--env", "prod"],
  );
  assertThrows(
    () => new GhSecretDeleteSettings().argv(),
    Error,
    "GhTasks.secretDelete: .name(...) is required",
  );
});

Deno.test("variable set, get, list and delete render their flags", () => {
  assertEquals(
    new GhVariableSetSettings().name("REGION").body("eu-central-1").org("acme")
      .visibility("all").argv().slice(1),
    [
      "variable",
      "set",
      "REGION",
      "--body",
      "eu-central-1",
      "--org",
      "acme",
      "--visibility",
      "all",
    ],
  );
  assertEquals(
    new GhVariableGetSettings().name("REGION").environment("prod").argv()
      .slice(1),
    ["variable", "get", "REGION", "--env", "prod"],
  );
  assertEquals(
    new GhVariableListSettings().org("acme").json("name", "value").argv()
      .slice(1),
    ["variable", "list", "--org", "acme", "--json", "name,value"],
  );
  assertEquals(
    new GhVariableDeleteSettings().name("REGION").org("acme").argv().slice(1),
    ["variable", "delete", "REGION", "--org", "acme"],
  );
});

Deno.test("variable commands insist on the name they act on", () => {
  assertThrows(
    () => new GhVariableSetSettings().body("x").argv(),
    Error,
    "GhTasks.variableSet: .name(...) is required",
  );
  assertThrows(
    () => new GhVariableGetSettings().argv(),
    Error,
    "GhTasks.variableGet: .name(...) is required",
  );
  assertThrows(
    () => new GhVariableDeleteSettings().argv(),
    Error,
    "GhTasks.variableDelete: .name(...) is required",
  );
  assertThrows(
    () => new GhVariableSetSettings().name("A").envFile(".env").argv(),
    Error,
    "GhTasks.variableSet: .envFile(...) carries its own names",
  );
});

Deno.test("the org and environment scopes render on every variable command", () => {
  assertEquals(
    new GhVariableGetSettings().name("REGION").org("acme").argv().slice(1),
    ["variable", "get", "REGION", "--org", "acme"],
  );
  assertEquals(
    new GhVariableListSettings().environment("prod").argv().slice(1),
    ["variable", "list", "--env", "prod"],
  );
  assertEquals(
    new GhVariableDeleteSettings().name("REGION").environment("prod").argv()
      .slice(1),
    ["variable", "delete", "REGION", "--env", "prod"],
  );
});

Deno.test("a user secret renders --user, and an org one can share with nobody", () => {
  assertEquals(
    new GhSecretSetSettings().name("TOKEN").user().argv().slice(1),
    ["secret", "set", "TOKEN", "--user"],
  );
  assertEquals(
    new GhSecretSetSettings().name("TOKEN").org("acme").noReposSelected()
      .argv().slice(1),
    ["secret", "set", "TOKEN", "--org", "acme", "--no-repos-selected"],
  );
});

Deno.test("cache list renders its filters", () => {
  assertEquals(
    new GhCacheListSettings().key("deno-").ref("refs/heads/master").sort(
      "size_in_bytes",
    ).order("desc").limit(50).json("id").argv().slice(1),
    [
      "cache",
      "list",
      "--key",
      "deno-",
      "--ref",
      "refs/heads/master",
      "--sort",
      "size_in_bytes",
      "--order",
      "desc",
      "--limit",
      "50",
      "--json",
      "id",
    ],
  );
});

Deno.test("cache delete names one cache or asks for all of them", () => {
  assertEquals(
    new GhCacheDeleteSettings().selector("deno-lock-abc").argv().slice(1),
    ["cache", "delete", "deno-lock-abc"],
  );
  assertEquals(
    new GhCacheDeleteSettings().all().ref("refs/pull/1/merge")
      .succeedOnNoCaches().argv().slice(1),
    [
      "cache",
      "delete",
      "--all",
      "--ref",
      "refs/pull/1/merge",
      "--succeed-on-no-caches",
    ],
  );
  assertThrows(
    () => new GhCacheDeleteSettings().argv(),
    Error,
    "GhTasks.cacheDelete: name a cache with .selector(...)",
  );
  assertThrows(
    () => new GhCacheDeleteSettings().selector(1).all().argv(),
    Error,
    "GhTasks.cacheDelete: .selector(...) deletes one cache",
  );
  // gh rejects the flag without --all, so the build would fail on gh's own
  // error rather than the exit code it asked for.
  assertThrows(
    () => new GhCacheDeleteSettings().selector(1).succeedOnNoCaches().argv(),
    Error,
    "GhTasks.cacheDelete: gh accepts --succeed-on-no-caches only with",
  );
});

Deno.test("the readers parse gh's JSON arrays", () => {
  assertEquals(
    parseSecrets(
      '[{"name":"NPM_TOKEN","updatedAt":"2026-08-01T00:00:00Z","visibility":"all"}]',
    ),
    [{
      name: "NPM_TOKEN",
      updatedAt: "2026-08-01T00:00:00Z",
      visibility: "all",
    }],
  );
  assertEquals(
    parseVariables(
      '[{"name":"REGION","value":"eu-central-1","updatedAt":"2026-08-01T00:00:00Z","visibility":"all"}]',
    ),
    [{
      name: "REGION",
      value: "eu-central-1",
      updatedAt: "2026-08-01T00:00:00Z",
      visibility: "all",
    }],
  );
  assertEquals(
    parseCaches(
      '[{"id":7,"key":"deno-abc","ref":"refs/heads/master","sizeInBytes":1024,"createdAt":"2026-08-01T00:00:00Z","lastAccessedAt":"2026-08-02T00:00:00Z"}]',
    ),
    [{
      id: 7,
      key: "deno-abc",
      ref: "refs/heads/master",
      sizeInBytes: 1024,
      createdAt: "2026-08-01T00:00:00Z",
      lastAccessedAt: "2026-08-02T00:00:00Z",
    }],
  );
});

Deno.test("the readers treat anything but an array of objects as empty", () => {
  for (const parse of [parseSecrets, parseVariables, parseCaches]) {
    assertEquals(parse("[]"), []);
    assertEquals(parse(""), []);
    assertEquals(parse("no results"), []);
    assertEquals(parse('{"name":"A"}'), []);
    assertEquals(parse("[null]"), []);
  }
  // A field gh reports as the wrong type is not that field.
  assertEquals(parseSecrets('[{"name":42}]'), [{}]);
  assertEquals(parseCaches('[{"sizeInBytes":"1024"}]'), [{}]);
});

Deno.test("the pinned field sets are what the entries document", () => {
  assertEquals(SECRET_LIST_FIELDS.length, 3);
  assertEquals(VARIABLE_LIST_FIELDS.includes("value"), true);
  assertEquals(VARIABLE_LIST_FIELDS.length, 4);
  assertEquals(CACHE_LIST_FIELDS.includes("sizeInBytes"), true);
  assertEquals(CACHE_LIST_FIELDS.length, 6);
});

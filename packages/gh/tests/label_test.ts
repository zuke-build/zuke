// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import {
  GhLabelCloneSettings,
  GhLabelCreateSettings,
  GhLabelDeleteSettings,
  GhLabelEditSettings,
  GhLabelListSettings,
  LABEL_LIST_FIELDS,
} from "../mod.ts";
import { parseLabels } from "../src/label.ts";

Deno.test("label list renders its filters", () => {
  assertEquals(
    new GhLabelListSettings().repo("acme/app").search("bug").sort("name").order(
      "desc",
    ).limit(100).json("name").web().argv().slice(1),
    [
      "label",
      "list",
      "--repo",
      "acme/app",
      "--search",
      "bug",
      "--sort",
      "name",
      "--order",
      "desc",
      "--limit",
      "100",
      "--json",
      "name",
      "--web",
    ],
  );
});

Deno.test("label create and edit render their colour and description", () => {
  assertEquals(
    new GhLabelCreateSettings().name("flaky").color("d73a4a").description(
      "a test that fails at random",
    ).force().argv().slice(1),
    [
      "label",
      "create",
      "flaky",
      "--color",
      "d73a4a",
      "--description",
      "a test that fails at random",
      "--force",
    ],
  );
  // gh spells the rename --name, with the current name as the operand.
  assertEquals(
    new GhLabelEditSettings().name("flaky").newName("flake").color("0e8a16")
      .description("updated").argv().slice(1),
    [
      "label",
      "edit",
      "flaky",
      "--name",
      "flake",
      "--color",
      "0e8a16",
      "--description",
      "updated",
    ],
  );
  assertThrows(
    () => new GhLabelCreateSettings().color("d73a4a").argv(),
    Error,
    "GhTasks.labelCreate: .name(...) is required",
  );
  assertThrows(
    () => new GhLabelEditSettings().newName("flake").argv(),
    Error,
    "GhTasks.labelEdit: .name(...) is required",
  );
});

Deno.test("label delete makes the build mean the deletion", () => {
  assertEquals(
    new GhLabelDeleteSettings().name("wontfix").yes().argv().slice(1),
    ["label", "delete", "wontfix", "--yes"],
  );
  assertThrows(
    () => new GhLabelDeleteSettings().name("wontfix").argv(),
    Error,
    "GhTasks.labelDelete: gh prompts before deleting",
  );
  assertThrows(
    () => new GhLabelDeleteSettings().yes().argv(),
    Error,
    "GhTasks.labelDelete: .name(...) is required",
  );
});

Deno.test("label clone names the repository it copies from", () => {
  assertEquals(
    new GhLabelCloneSettings().source("acme/template").repo("acme/app").force()
      .argv().slice(1),
    ["label", "clone", "acme/template", "--repo", "acme/app", "--force"],
  );
  assertThrows(
    () => new GhLabelCloneSettings().argv(),
    Error,
    "GhTasks.labelClone: .source(...) is required",
  );
});

Deno.test("parseLabels reads gh's JSON array", () => {
  assertEquals(
    parseLabels(
      '[{"name":"bug","color":"d73a4a","description":"Something is broken"}]',
    ),
    [{ name: "bug", color: "d73a4a", description: "Something is broken" }],
  );
  // A label with no description is still a label.
  assertEquals(parseLabels('[{"name":"ci","color":"0e8a16"}]'), [{
    name: "ci",
    color: "0e8a16",
  }]);
});

Deno.test("parseLabels treats anything but an array of objects as empty", () => {
  assertEquals(parseLabels("[]"), []);
  assertEquals(parseLabels("no labels found"), []);
  assertEquals(parseLabels('{"name":"bug"}'), []);
  assertEquals(parseLabels('[{"color":123}]'), [{}]);
});

Deno.test("the pinned label field set is what the entry documents", () => {
  assertEquals(LABEL_LIST_FIELDS.includes("color"), true);
  assertEquals(LABEL_LIST_FIELDS.length, 3);
});

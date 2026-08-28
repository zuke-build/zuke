// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import {
  NpmDeprecateSettings,
  NpmDistTagSettings,
  NpmExecSettings,
  NpmPackSettings,
  NpmPublishSettings,
  NpmTestSettings,
  NpmUnpublishSettings,
  NpmVersionSettings,
} from "../mod.ts";

Deno.test("publish renders provenance alongside the existing options", () => {
  assertEquals(
    new NpmPublishSettings().access("public").provenance().tag("next")
      .argv().slice(1),
    ["publish", "--tag=next", "--access=public", "--provenance"],
  );
});

Deno.test("pack renders its destination and specs", () => {
  assertEquals(
    new NpmPackSettings().dryRun().packDestination("dist")
      .packages("app").argv().slice(1),
    ["pack", "--dry-run", "--pack-destination=dist", "app"],
  );
});

Deno.test("version renders the prerelease identifier and same-version escape", () => {
  assertEquals(
    new NpmVersionSettings().bump("preminor").preid("rc").allowSameVersion()
      .argv().slice(1),
    ["version", "preminor", "--preid=rc", "--allow-same-version"],
  );
});

Deno.test("unpublish renders force and dry-run before the spec", () => {
  assertEquals(
    new NpmUnpublishSettings().force().dryRun().spec("app@1.2.3")
      .argv().slice(1),
    ["unpublish", "--dry-run", "--force", "app@1.2.3"],
  );
});

Deno.test("deprecate needs both the spec and the message", () => {
  assertEquals(
    new NpmDeprecateSettings().spec("app@<2").message("upgrade to 2.x")
      .otp("123456").argv().slice(1),
    ["deprecate", "--otp=123456", "app@<2", "upgrade to 2.x"],
  );
  // An empty message is how npm *un*-deprecates, so it must be deliberate
  // rather than the result of leaving the message out.
  assertEquals(
    new NpmDeprecateSettings().spec("app@1.0.0").message("").argv().slice(1),
    ["deprecate", "app@1.0.0", ""],
  );
  assertThrows(
    () => new NpmDeprecateSettings().spec("app").argv(),
    Error,
    "NpmTasks.deprecate: .spec(...) and .message(...) are both required",
  );
});

Deno.test("dist-tag renders each subcommand, listing by default", () => {
  assertEquals(new NpmDistTagSettings().argv().slice(1), ["dist-tag", "ls"]);
  assertEquals(
    new NpmDistTagSettings().add("app@1.2.3", "next").argv().slice(1),
    ["dist-tag", "add", "app@1.2.3", "next"],
  );
  assertEquals(
    new NpmDistTagSettings().rm("app", "next").argv().slice(1),
    ["dist-tag", "rm", "app", "next"],
  );
  assertEquals(
    new NpmDistTagSettings().ls("app").workspace("pkg").argv().slice(1),
    ["dist-tag", "ls", "--workspace=pkg", "app"],
  );
});

Deno.test("test forwards its arguments after a -- separator", () => {
  assertEquals(new NpmTestSettings().argv().slice(1), ["test"]);
  assertEquals(
    new NpmTestSettings().workspace("app").testArgs("--coverage")
      .argv().slice(1),
    ["test", "--workspace=app", "--", "--coverage"],
  );
});

Deno.test("the publish-family commands render their workspace selection", () => {
  assertEquals(
    new NpmPublishSettings().workspaces().argv().slice(1),
    ["publish", "--workspaces"],
  );
  assertEquals(
    new NpmPackSettings().workspaces().argv().slice(1),
    ["pack", "--workspaces"],
  );
  assertEquals(
    new NpmVersionSettings().bump("patch").workspaces().argv().slice(1),
    ["version", "patch", "--workspaces"],
  );
  assertEquals(
    new NpmUnpublishSettings().workspaces().argv().slice(1),
    ["unpublish", "--workspaces"],
  );
});

Deno.test("dist-tag.ls with no spec lists the current package's tags", () => {
  assertEquals(new NpmDistTagSettings().ls().argv().slice(1), [
    "dist-tag",
    "ls",
  ]);
});

Deno.test("exec can refuse to install what is missing", () => {
  assertEquals(
    new NpmExecSettings().no().command("tsc").argv().slice(1),
    ["exec", "--no", "tsc"],
  );
  // A hermetic step wants one or the other, never both.
  assertThrows(
    () => new NpmExecSettings().yes().no().command("tsc").argv(),
    Error,
    "NpmTasks.exec: .yes() installs what is missing and .no() refuses to",
  );
});

// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import {
  GhReleaseCreateSettings,
  GhReleaseDeleteSettings,
  GhReleaseDownloadSettings,
  GhReleaseEditSettings,
  GhReleaseListSettings,
  GhReleaseUploadSettings,
  GhReleaseViewSettings,
  RELEASE_LIST_FIELDS,
} from "../mod.ts";
import { parseReleases } from "../src/release.ts";

Deno.test("release create renders the tag, its assets, and its flags", () => {
  assertEquals(
    new GhReleaseCreateSettings()
      .repo("acme/app")
      .tag("v1.2.3")
      .files("dist/app.tgz", "dist/app.tgz.sig#signature")
      .title("v1.2.3")
      .notes("what changed")
      .generateNotes()
      .notesFromTag()
      .notesStartTag("v1.2.2")
      .prerelease()
      .latest()
      .target("master")
      .discussionCategory("Announcements")
      .verifyTag()
      .failOnNoCommits()
      .argv()
      .slice(1),
    [
      "release",
      "create",
      "v1.2.3",
      "dist/app.tgz",
      "dist/app.tgz.sig#signature",
      "--repo",
      "acme/app",
      "--title",
      "v1.2.3",
      "--notes",
      "what changed",
      "--generate-notes",
      "--notes-from-tag",
      "--notes-start-tag",
      "v1.2.2",
      "--prerelease",
      "--latest",
      "--target",
      "master",
      "--discussion-category",
      "Announcements",
      "--verify-tag",
      "--fail-on-no-commits",
    ],
  );
  assertEquals(
    new GhReleaseCreateSettings().tag("v1").draft().notesFile("NOTES.md").argv()
      .slice(1),
    ["release", "create", "v1", "--notes-file", "NOTES.md", "--draft"],
  );
});

Deno.test("release create guards its tag, its notes, and the draft/latest pair", () => {
  assertThrows(
    () => new GhReleaseCreateSettings().title("v1").argv(),
    Error,
    "GhTasks.releaseCreate: .tag(...) is required",
  );
  assertThrows(
    () =>
      new GhReleaseCreateSettings().tag("v1").notes("a").notesFile("n.md")
        .argv(),
    Error,
    "GhTasks.releaseCreate: .notes(...) and .notesFile(...) are two sources",
  );
  // gh accepts both and publishes neither outcome the build asked for: a draft
  // is unpublished, so it cannot be the latest release.
  assertThrows(
    () => new GhReleaseCreateSettings().tag("v1").draft().latest().argv(),
    Error,
    "GhTasks.releaseCreate: a draft is not published",
  );
});

Deno.test("release list and view render their flags", () => {
  assertEquals(
    new GhReleaseListSettings().excludeDrafts().excludePreReleases().order(
      "asc",
    ).limit(5).json("tagName").argv().slice(1),
    [
      "release",
      "list",
      "--exclude-drafts",
      "--exclude-pre-releases",
      "--order",
      "asc",
      "--limit",
      "5",
      "--json",
      "tagName",
    ],
  );
  // gh shows the latest release when no tag is given.
  assertEquals(new GhReleaseViewSettings().argv().slice(1), [
    "release",
    "view",
  ]);
  assertEquals(
    new GhReleaseViewSettings().tag("v1.2.3").web().argv().slice(1),
    ["release", "view", "v1.2.3", "--web"],
  );
});

Deno.test("release list is the one read command gh gives no --web", () => {
  // Every other listing and view takes --web; `gh release list` does not, and
  // offering it would render a flag gh rejects as unknown.
  assertEquals("web" in new GhReleaseListSettings(), false);
  assertEquals("web" in new GhReleaseViewSettings(), true);
});

Deno.test("release upload needs both the release and what to attach", () => {
  assertEquals(
    new GhReleaseUploadSettings().tag("v1.2.3").files("dist/app.tgz").clobber()
      .argv().slice(1),
    ["release", "upload", "v1.2.3", "dist/app.tgz", "--clobber"],
  );
  assertThrows(
    () => new GhReleaseUploadSettings().tag("v1.2.3").argv(),
    Error,
    "GhTasks.releaseUpload: .tag(...) and .files(...) are both required",
  );
  assertThrows(
    () => new GhReleaseUploadSettings().files("dist/app.tgz").argv(),
    Error,
    "GhTasks.releaseUpload: .tag(...) and .files(...) are both required",
  );
});

Deno.test("release download renders its filters and refuses the contradictions", () => {
  assertEquals(
    new GhReleaseDownloadSettings().tag("v1.2.3").pattern("*.tgz", "*.sig")
      .dir("out").clobber().argv().slice(1),
    [
      "release",
      "download",
      "v1.2.3",
      "--pattern",
      "*.tgz",
      "--pattern",
      "*.sig",
      "--dir",
      "out",
      "--clobber",
    ],
  );
  assertEquals(
    new GhReleaseDownloadSettings().archive("tar.gz").output("-").skipExisting()
      .argv().slice(1),
    [
      "release",
      "download",
      "--archive",
      "tar.gz",
      "--output",
      "-",
      "--skip-existing",
    ],
  );
  assertThrows(
    () => new GhReleaseDownloadSettings().clobber().skipExisting().argv(),
    Error,
    "GhTasks.releaseDownload: .clobber() overwrites what exists",
  );
  // --pattern filters the assets, which the source archive is not one of.
  assertThrows(
    () =>
      new GhReleaseDownloadSettings().archive("zip").pattern("*.tgz").argv(),
    Error,
    "GhTasks.releaseDownload: .archive(...) fetches the source archive",
  );
});

Deno.test("release edit renames the tag with --tag, not the operand", () => {
  assertEquals(
    new GhReleaseEditSettings()
      .tag("v1.2.3")
      .newTag("v1.2.4")
      .title("v1.2.4")
      .notes("fixed")
      .prerelease()
      .latest()
      .target("master")
      .discussionCategory("Announcements")
      .verifyTag()
      .argv()
      .slice(1),
    [
      "release",
      "edit",
      "v1.2.3",
      "--tag",
      "v1.2.4",
      "--title",
      "v1.2.4",
      "--notes",
      "fixed",
      "--prerelease",
      "--latest",
      "--target",
      "master",
      "--discussion-category",
      "Announcements",
      "--verify-tag",
    ],
  );
  assertEquals(
    new GhReleaseEditSettings().tag("v1").draft().notesFile("-").argv().slice(
      1,
    ),
    ["release", "edit", "v1", "--notes-file", "-", "--draft"],
  );
  assertThrows(
    () => new GhReleaseEditSettings().newTag("v2").argv(),
    Error,
    "GhTasks.releaseEdit: .tag(...) is required",
  );
  assertThrows(
    () =>
      new GhReleaseEditSettings().tag("v1").notes("a").notesFile("n").argv(),
    Error,
    "GhTasks.releaseEdit: .notes(...) and .notesFile(...) are two sources",
  );
  assertThrows(
    () => new GhReleaseEditSettings().tag("v1").draft().latest().argv(),
    Error,
    "GhTasks.releaseEdit: a draft is not published",
  );
});

Deno.test("release delete makes the build mean the deletion", () => {
  assertEquals(
    new GhReleaseDeleteSettings().tag("v1.2.3").cleanupTag().yes().argv()
      .slice(1),
    ["release", "delete", "v1.2.3", "--yes", "--cleanup-tag"],
  );
  assertThrows(
    () => new GhReleaseDeleteSettings().yes().argv(),
    Error,
    "GhTasks.releaseDelete: .tag(...) is required",
  );
  // gh prompts, and a build has no one to answer.
  assertThrows(
    () => new GhReleaseDeleteSettings().tag("v1.2.3").argv(),
    Error,
    "GhTasks.releaseDelete: gh prompts before deleting",
  );
});

Deno.test("parseReleases reads gh's JSON array", () => {
  const stdout = JSON.stringify([
    {
      tagName: "v1.2.3",
      name: "v1.2.3",
      isDraft: false,
      isPrerelease: false,
      isLatest: true,
      publishedAt: "2026-08-01T10:00:00Z",
    },
  ]);
  assertEquals(parseReleases(stdout), [{
    tagName: "v1.2.3",
    name: "v1.2.3",
    isDraft: false,
    isPrerelease: false,
    isLatest: true,
    publishedAt: "2026-08-01T10:00:00Z",
  }]);
  // A draft has no publishedAt, and the entry simply omits it.
  assertEquals(parseReleases('[{"tagName":"v2","isDraft":true}]'), [{
    tagName: "v2",
    isDraft: true,
  }]);
});

Deno.test("parseReleases treats anything but an array of objects as empty", () => {
  assertEquals(parseReleases("[]"), []);
  assertEquals(parseReleases(""), []);
  assertEquals(parseReleases("no releases found"), []);
  assertEquals(parseReleases('{"tagName":"v1"}'), []);
  assertEquals(parseReleases('["v1"]'), []);
  // A field gh reports as the wrong type is not that field.
  assertEquals(parseReleases('[{"isDraft":"false"}]'), [{}]);
});

Deno.test("the pinned release field set is what the entry documents", () => {
  assertEquals(RELEASE_LIST_FIELDS.includes("tagName"), true);
  assertEquals(RELEASE_LIST_FIELDS.includes("isLatest"), true);
  assertEquals(RELEASE_LIST_FIELDS.length, 6);
});

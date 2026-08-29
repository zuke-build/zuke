// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import {
  GhRepoArchiveSettings,
  GhRepoCloneSettings,
  GhRepoCreateSettings,
  GhRepoDeleteSettings,
  GhRepoEditSettings,
  GhRepoForkSettings,
  GhRepoListSettings,
  GhRepoRenameSettings,
  GhRepoSetDefaultSettings,
  GhRepoSyncSettings,
  GhRepoViewSettings,
  REPO_LIST_FIELDS,
} from "../mod.ts";
import { parseRepositories } from "../src/repo.ts";

Deno.test("repo clone puts the git flags after the separator", () => {
  // gh takes no --depth of its own; it forwards what follows `--` to git.
  assertEquals(
    new GhRepoCloneSettings().repository("acme/app").directory("vendor/app")
      .gitArgs("--depth=1", "--single-branch").argv().slice(1),
    [
      "repo",
      "clone",
      "acme/app",
      "vendor/app",
      "--",
      "--depth=1",
      "--single-branch",
    ],
  );
  assertEquals(
    new GhRepoCloneSettings().repository("acme/app").upstreamRemoteName(
      "parent",
    )
      .argv().slice(1),
    ["repo", "clone", "acme/app", "--upstream-remote-name", "parent"],
  );
  assertEquals(
    new GhRepoCloneSettings().repository("acme/app").noUpstream().argv()
      .slice(1),
    ["repo", "clone", "acme/app", "--no-upstream"],
  );
  assertThrows(
    () => new GhRepoCloneSettings().argv(),
    Error,
    "GhTasks.repoClone: .repository(...) is required",
  );
  assertThrows(
    () =>
      new GhRepoCloneSettings().repository("a/b").noUpstream()
        .upstreamRemoteName("parent").argv(),
    Error,
    "GhTasks.repoClone: .noUpstream() adds no upstream remote",
  );
});

Deno.test("repo create insists on a name and a visibility", () => {
  assertEquals(
    new GhRepoCreateSettings()
      .name("acme/app")
      .visibility("private")
      .description("the app")
      .homepage("https://acme.test")
      .team("platform")
      .gitignore("Node")
      .license("mit")
      .addReadme()
      .disableIssues()
      .disableWiki()
      .argv()
      .slice(1),
    [
      "repo",
      "create",
      "acme/app",
      "--private",
      "--description",
      "the app",
      "--homepage",
      "https://acme.test",
      "--team",
      "platform",
      "--gitignore",
      "Node",
      "--license",
      "mit",
      "--add-readme",
      "--disable-issues",
      "--disable-wiki",
    ],
  );
  assertEquals(
    new GhRepoCreateSettings().name("app").visibility("public").source(".")
      .remote("origin").push().clone().argv().slice(1),
    [
      "repo",
      "create",
      "app",
      "--public",
      "--source",
      ".",
      "--remote",
      "origin",
      "--push",
      "--clone",
    ],
  );
  assertThrows(
    () => new GhRepoCreateSettings().visibility("public").argv(),
    Error,
    "GhTasks.repoCreate: .name(...) is required",
  );
  // gh prompts for the visibility rather than defaulting it, and a public
  // repository created by accident cannot be un-published.
  assertThrows(
    () => new GhRepoCreateSettings().name("app").argv(),
    Error,
    "GhTasks.repoCreate: .visibility(...) is required",
  );
  assertThrows(
    () =>
      new GhRepoCreateSettings().name("app").visibility("public").source(".")
        .addReadme().argv(),
    Error,
    "GhTasks.repoCreate: .addReadme() writes a new README",
  );
  assertThrows(
    () =>
      new GhRepoCreateSettings().name("app").visibility("public").template(
        "acme/tpl",
      ).source(".").argv(),
    Error,
    "GhTasks.repoCreate: .template(...) and .source(...) are two",
  );
  assertThrows(
    () =>
      new GhRepoCreateSettings().name("app").visibility("public").push().argv(),
    Error,
    "GhTasks.repoCreate: .push() pushes the local commits",
  );
});

Deno.test("repo list and view render their filters", () => {
  assertEquals(
    new GhRepoListSettings()
      .owner("acme")
      .language("TypeScript")
      .topic("build", "deno")
      .visibility("public")
      .noArchived()
      .source()
      .limit(100)
      .json("name")
      .argv()
      .slice(1),
    [
      "repo",
      "list",
      "acme",
      "--language",
      "TypeScript",
      "--topic",
      "build",
      "--topic",
      "deno",
      "--visibility",
      "public",
      "--no-archived",
      "--source",
      "--limit",
      "100",
      "--json",
      "name",
    ],
  );
  assertThrows(
    () => new GhRepoListSettings().archived().noArchived().argv(),
    Error,
    "GhTasks.repoList: .archived() keeps only archived",
  );
  assertThrows(
    () => new GhRepoListSettings().fork().source().argv(),
    Error,
    "GhTasks.repoList: .fork() keeps only forks",
  );
  assertEquals(
    new GhRepoViewSettings().repository("acme/app").branch("master").web()
      .argv().slice(1),
    ["repo", "view", "acme/app", "--branch", "master", "--web"],
  );
  assertEquals(new GhRepoViewSettings().argv().slice(1), ["repo", "view"]);
});

Deno.test("repo fork keeps its git flags to the clone", () => {
  assertEquals(
    new GhRepoForkSettings().repository("acme/app").org("mine").forkName("app2")
      .defaultBranchOnly().remote().remoteName("fork").clone().gitArgs(
        "--depth=1",
      ).argv().slice(1),
    [
      "repo",
      "fork",
      "acme/app",
      "--org",
      "mine",
      "--fork-name",
      "app2",
      "--default-branch-only",
      "--remote",
      "--remote-name",
      "fork",
      "--clone",
      "--",
      "--depth=1",
    ],
  );
  assertThrows(
    () =>
      new GhRepoForkSettings().repository("a/b").gitArgs("--depth=1").argv(),
    Error,
    "GhTasks.repoFork: the git flags after `--` are for the clone",
  );
});

Deno.test("repo sync renders its source and branch", () => {
  assertEquals(
    new GhRepoSyncSettings().destination("mine/app").source("acme/app").branch(
      "master",
    ).force().argv().slice(1),
    [
      "repo",
      "sync",
      "mine/app",
      "--source",
      "acme/app",
      "--branch",
      "master",
      "--force",
    ],
  );
  assertEquals(new GhRepoSyncSettings().argv().slice(1), ["repo", "sync"]);
});

Deno.test("repo edit renders its toggles in gh's own spelling", () => {
  // gh's booleans are tri-state: bare turns one on, `=false` turns it off.
  assertEquals(
    new GhRepoEditSettings()
      .repository("acme/app")
      .description("the app")
      .homepage("https://acme.test")
      .defaultBranch("master")
      .addTopic("build")
      .removeTopic("legacy")
      .enableIssues()
      .enableWiki(false)
      .enableAutoMerge()
      .deleteBranchOnMerge()
      .enableMergeCommit(false)
      .enableSquashMerge()
      .argv()
      .slice(1),
    [
      "repo",
      "edit",
      "acme/app",
      "--description",
      "the app",
      "--homepage",
      "https://acme.test",
      "--default-branch",
      "master",
      "--add-topic",
      "build",
      "--remove-topic",
      "legacy",
      "--enable-issues",
      "--enable-wiki=false",
      "--enable-auto-merge",
      "--delete-branch-on-merge",
      "--enable-merge-commit=false",
      "--enable-squash-merge",
    ],
  );
  assertEquals(
    new GhRepoEditSettings().visibility("private")
      .acceptVisibilityChangeConsequences().argv().slice(1),
    [
      "repo",
      "edit",
      "--visibility",
      "private",
      "--accept-visibility-change-consequences",
    ],
  );
  // Making a repository private detaches forks and drops stars; gh asks
  // before doing it, and a build cannot answer.
  assertThrows(
    () => new GhRepoEditSettings().visibility("private").argv(),
    Error,
    "GhTasks.repoEdit: gh confirms a visibility change",
  );
});

Deno.test("every repo edit toggle renders under its own flag", () => {
  // One case per toggle, so a flag mistyped in one of them cannot hide behind
  // its neighbours.
  assertEquals(
    new GhRepoEditSettings()
      .enableProjects()
      .enableDiscussions(false)
      .enableRebaseMerge(false)
      .allowForking()
      .allowUpdateBranch(false)
      .enableSecretScanning()
      .enableSecretScanningPushProtection()
      .argv()
      .slice(1),
    [
      "repo",
      "edit",
      "--enable-projects",
      "--enable-discussions=false",
      "--enable-rebase-merge=false",
      "--allow-forking",
      "--allow-update-branch=false",
      "--enable-secret-scanning",
      "--enable-secret-scanning-push-protection",
    ],
  );
});

Deno.test("repo create can start from a template, and list can keep only forks", () => {
  assertEquals(
    new GhRepoCreateSettings().name("app").visibility("internal").template(
      "acme/tpl",
    ).includeAllBranches().argv().slice(1),
    [
      "repo",
      "create",
      "app",
      "--internal",
      "--template",
      "acme/tpl",
      "--include-all-branches",
    ],
  );
  assertEquals(
    new GhRepoListSettings().archived().fork().argv().slice(1),
    ["repo", "list", "--archived", "--fork"],
  );
});

Deno.test("the destructive repo commands make the build mean them", () => {
  assertEquals(
    new GhRepoRenameSettings().newName("app2").repo("acme/app").yes().argv()
      .slice(1),
    ["repo", "rename", "app2", "--repo", "acme/app", "--yes"],
  );
  assertEquals(
    new GhRepoArchiveSettings().repository("acme/app").yes().argv().slice(1),
    ["repo", "archive", "acme/app", "--yes"],
  );
  assertEquals(
    new GhRepoArchiveSettings().repository("acme/app").unarchive().yes().argv()
      .slice(1),
    ["repo", "unarchive", "acme/app", "--yes"],
  );
  assertEquals(
    new GhRepoDeleteSettings().repository("acme/app").yes().argv().slice(1),
    ["repo", "delete", "acme/app", "--yes"],
  );
  for (
    const [needle, build] of [
      [
        "GhTasks.repoRename: gh prompts before renaming",
        () => new GhRepoRenameSettings().newName("app2").argv(),
      ],
      [
        "GhTasks.repoArchive: gh prompts before archiving",
        () => new GhRepoArchiveSettings().repository("a/b").argv(),
      ],
      [
        "GhTasks.repoDelete: gh prompts before deleting",
        () => new GhRepoDeleteSettings().repository("a/b").argv(),
      ],
      [
        "GhTasks.repoRename: .newName(...) is required",
        () => new GhRepoRenameSettings().yes().argv(),
      ],
    ] as const
  ) {
    assertThrows(build, Error, needle);
  }
  // gh ignores --yes when deleting the repository you are standing in, so a
  // build that did not name one would hang on a prompt.
  assertThrows(
    () => new GhRepoDeleteSettings().yes().argv(),
    Error,
    "GhTasks.repoDelete: .repository(...) is required",
  );
});

Deno.test("repo set-default sets, views, or forgets — one of the three", () => {
  assertEquals(
    new GhRepoSetDefaultSettings().repository("acme/app").argv().slice(1),
    ["repo", "set-default", "acme/app"],
  );
  assertEquals(
    new GhRepoSetDefaultSettings().view().argv().slice(1),
    ["repo", "set-default", "--view"],
  );
  assertEquals(
    new GhRepoSetDefaultSettings().unset().argv().slice(1),
    ["repo", "set-default", "--unset"],
  );
  assertThrows(
    () => new GhRepoSetDefaultSettings().argv(),
    Error,
    "GhTasks.repoSetDefault: name the repository with .repository(...)",
  );
  assertThrows(
    () => new GhRepoSetDefaultSettings().unset().view().argv(),
    Error,
    "GhTasks.repoSetDefault: .unset() forgets the default",
  );
  assertThrows(
    () => new GhRepoSetDefaultSettings().repository("a/b").view().argv(),
    Error,
    "GhTasks.repoSetDefault: .repository(...) sets the default",
  );
});

Deno.test("the repo group refuses a --repo flag gh does not give it", () => {
  // gh names the repository as an operand across this group, and only `rename`
  // also takes -R. Rendering --repo anywhere else would fail with gh's own
  // "unknown flag", so the settings say so first and name the operand to use.
  for (
    const [task, hint, build] of [
      [
        "repoClone",
        ".repository(...)",
        () => new GhRepoCloneSettings().repository("a/b").repo("a/b").argv(),
      ],
      [
        "repoCreate",
        ".name(...)",
        () =>
          new GhRepoCreateSettings().name("app").visibility("public").repo(
            "a/b",
          )
            .argv(),
      ],
      [
        "repoList",
        ".owner(...)",
        () => new GhRepoListSettings().repo("a/b").argv(),
      ],
      [
        "repoView",
        ".repository(...)",
        () => new GhRepoViewSettings().repo("a/b").argv(),
      ],
      [
        "repoFork",
        ".repository(...)",
        () => new GhRepoForkSettings().repo("a/b").argv(),
      ],
      [
        "repoSync",
        ".destination(...)",
        () => new GhRepoSyncSettings().repo("a/b").argv(),
      ],
      [
        "repoEdit",
        ".repository(...)",
        () => new GhRepoEditSettings().repo("a/b").argv(),
      ],
      [
        "repoArchive",
        ".repository(...)",
        () => new GhRepoArchiveSettings().yes().repo("a/b").argv(),
      ],
      [
        "repoDelete",
        ".repository(...)",
        () =>
          new GhRepoDeleteSettings().repository("a/b").yes().repo("a/b").argv(),
      ],
      [
        "repoSetDefault",
        ".repository(...)",
        () => new GhRepoSetDefaultSettings().view().repo("a/b").argv(),
      ],
    ] as const
  ) {
    assertThrows(
      build,
      Error,
      `GhTasks.${task}: gh gives this command no --repo flag`,
    );
    assertThrows(build, Error, hint);
  }
  // `rename` is the exception: gh gives it -R, and that is how a build names
  // the repository it is renaming.
  assertEquals(
    new GhRepoRenameSettings().newName("app2").repo("acme/app").yes().argv()
      .slice(1),
    ["repo", "rename", "app2", "--repo", "acme/app", "--yes"],
  );
});

Deno.test("parseRepositories reads gh's JSON array", () => {
  const stdout = JSON.stringify([
    {
      name: "zuke",
      nameWithOwner: "zuke-build/zuke",
      description: "A build system",
      isPrivate: false,
      isFork: false,
      isArchived: false,
      url: "https://github.com/zuke-build/zuke",
      updatedAt: "2026-08-29T10:00:00Z",
    },
  ]);
  assertEquals(parseRepositories(stdout), [{
    name: "zuke",
    nameWithOwner: "zuke-build/zuke",
    description: "A build system",
    isPrivate: false,
    isFork: false,
    isArchived: false,
    url: "https://github.com/zuke-build/zuke",
    updatedAt: "2026-08-29T10:00:00Z",
  }]);
});

Deno.test("parseRepositories treats anything but an array of objects as empty", () => {
  assertEquals(parseRepositories("[]"), []);
  assertEquals(parseRepositories("no repositories found"), []);
  assertEquals(parseRepositories('{"name":"zuke"}'), []);
  assertEquals(parseRepositories('[{"isPrivate":"false"}]'), [{}]);
});

Deno.test("the pinned repository field set is what the entry documents", () => {
  assertEquals(REPO_LIST_FIELDS.includes("nameWithOwner"), true);
  assertEquals(REPO_LIST_FIELDS.includes("isArchived"), true);
  assertEquals(REPO_LIST_FIELDS.length, 8);
});
